import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { businessSettings } from "@/db/schema";
import { seedCatalog, seedSchedules } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { readAvailability } from "@/server/availability";
import {
  type BookingReceipt,
  type BookingSubmission,
  readBookingKeys,
  submitBooking,
} from "@/server/booking";
import { readCatalog } from "@/server/catalog";
import { addCalendarDays, businessDate } from "@/shared/booking-time";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}

/** Owns schema + production server until callback settles. Never returns credentials in errors. */
export async function withPersistedBrowserServer<T>(
  run: (server: PersistedBrowserServer) => Promise<T>,
  options: {
    readyTimeoutMs?: number;
    anchor?: number;
    onOwned?: (schemaName: string) => void;
  } = {},
): Promise<T> {
  if (process.env.SLOTWELL_BROWSER_TEST !== "private-schema-v1") {
    throw new Error("Explicit browser test environment required");
  }
  const readyTimeoutMs = options.readyTimeoutMs ?? 30000;
  if (
    !Number.isSafeInteger(readyTimeoutMs) ||
    readyTimeoutMs < 1 ||
    readyTimeoutMs > 60000
  ) {
    throw new Error("Invalid browser readiness timeout");
  }
  let stopped = true;
  try {
    return await withTestDatabase(
      { now: options.anchor, canCleanup: () => stopped },
      async ({ db, now: anchor }) => {
        await seedCatalog(db);
        await seedSchedules(db, { anchor });
        const marker = `Fictional browser fixture ${randomUUID()}`;
        await db
          .update(businessSettings)
          .set({ name: marker })
          .where(eq(businessSettings.id, 1));
        const [schema] = await db.execute(
          sql`SELECT nspname AS name, oid,
        pg_catalog.pg_get_userbyid(nspowner) AS owner,
        pg_catalog.obj_description(oid, 'pg_namespace') AS nonce
        FROM pg_catalog.pg_namespace WHERE nspname = current_schema()`,
          "objects",
        );
        options.onOwned?.(String(schema.name));
        const ring = () => ({
          currentId: "browser",
          keys: { browser: randomBytes(32).toString("hex") },
        });
        const encodedKeys = JSON.stringify({
          fingerprint: ring(),
          replay: ring(),
        });
        const keys = readBookingKeys({ SLOTWELL_BOOKING_KEYS: encodedKeys });
        const origin = `http://127.0.0.1:${await freePort()}`;
        stopped = false;
        const child = spawn(
          process.execPath,
          [
            resolve("node_modules/next/dist/bin/next"),
            "start",
            "--hostname",
            "127.0.0.1",
            "--port",
            new URL(origin).port,
          ],
          {
            stdio: "ignore",
            env: {
              ...process.env,
              NODE_ENV: "production",
              NODE_OPTIONS: "",
              PGOPTIONS: "",
              NEXT_TELEMETRY_DISABLED: "1",
              DATABASE_URL: process.env.TEST_DATABASE_URL,
              TEST_DATABASE_URL: "",
              SLOTWELL_BROWSER_TEST: "private-schema-v1",
              SLOTWELL_BROWSER_SCHEMA: JSON.stringify(schema),
              SLOTWELL_BOOKING_KEYS: encodedKeys,
              SLOTWELL_BOOKING_ORIGIN: origin,
            },
          },
        );
        let exited = false;
        const closed = new Promise<void>((accept) => {
          child.once("error", () => {
            if (!child.pid) {
              exited = true;
              stopped = true;
              accept();
            }
          });
          child.once("close", () => {
            exited = true;
            stopped = true;
            accept();
          });
        });
        const stopOnExit = () => {
          if (!stopped) child.kill("SIGKILL");
        };
        process.once("exit", stopOnExit);
        try {
          const deadline = Date.now() + readyTimeoutMs;
          let ready = false;
          while (!exited && Date.now() < deadline) {
            try {
              const response = await fetch(`${origin}/api/catalog`, {
                signal: AbortSignal.timeout(Math.min(1000, readyTimeoutMs)),
              });
              const catalog = await response.json();
              ready = response.ok && catalog.business?.name === marker;
            } catch {
              /* Child may still be binding; never retain raw network errors. */
            }
            if (ready) break;
            await delay(50);
          }
          if (!ready || exited) throw new Error();
          return await run({
            origin,
            marker,
            schemaName: String(schema.name),
            anchor,
            db,
            keys,
            booking: () => fixtureBooking(db, anchor),
            occupy: (submission) => submitBooking(db, submission, { keys }),
            expiredConfirmation: async () => {
              const historicalNow = anchor - 30 * 24 * 60 * 60 * 1000;
              return submitBooking(
                db,
                await fixtureBooking(db, historicalNow),
                { keys, clock: () => historicalNow },
              );
            },
          });
        } finally {
          if (!stopped) {
            child.kill("SIGTERM");
            await Promise.race([
              closed,
              delay(5000, undefined, { ref: false }),
            ]);
          }
          if (!stopped) {
            child.kill("SIGKILL");
            await Promise.race([
              closed,
              delay(5000, undefined, { ref: false }),
            ]);
          }
          if (stopped) process.removeListener("exit", stopOnExit);
          // canCleanup refuses DROP and fails the owner if closure is unconfirmed.
        }
      },
    );
  } catch {
    throw new Error("Browser database lifecycle failed");
  }
}

type TestDatabase = NodePgDatabase;
export type PersistedBrowserServer = {
  origin: string;
  marker: string;
  schemaName: string;
  anchor: number;
  db: TestDatabase;
  keys: ReturnType<typeof readBookingKeys>;
  booking: () => Promise<BookingSubmission>;
  occupy: (submission: BookingSubmission) => Promise<BookingReceipt>;
  expiredConfirmation: () => Promise<BookingReceipt>;
};

async function fixtureBooking(
  db: TestDatabase,
  anchor: number,
): Promise<BookingSubmission> {
  const catalog = await readCatalog(db);
  const from = addCalendarDays(
    businessDate(anchor, catalog.business.timeZone),
    1,
  );
  const availability = await readAvailability(
    db,
    {
      staffId: "pavel",
      serviceIds: ["cut_m"],
      from,
      to: addCalendarDays(from, 6),
    },
    anchor,
  );
  const start = availability.days.flatMap((day) => day.slots)[0]?.start;
  const service = catalog.services.find((service) => service.id === "cut_m");
  if (!start || !service)
    throw new Error("Fictional browser scenario unavailable");
  return {
    authorization: {
      operationId: randomUUID(),
      credential: randomBytes(32).toString("hex"),
    },
    input: {
      staffId: "pavel",
      serviceIds: [service.id],
      startsAt: start,
      reviewedServices: [service],
      contact: {
        name: "Fictional Browser Guest",
        phone: "+359888123456",
        email: "browser@example.test",
        notes: "",
        phoneCountry: "BG",
      },
    },
  };
}
