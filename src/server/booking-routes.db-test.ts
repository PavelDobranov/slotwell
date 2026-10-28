import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono } from "hono";

import {
  appointments,
  bookingOperations,
  businessHours,
  businessSettings,
  services,
  staffSchedules,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { BookingError } from "@/server/book-appointment";
import {
  type BookingDatabase,
  registerBookingRoutes,
} from "@/server/booking-routes";

const NOW = Date.parse("2026-05-31T22:00:00Z");
const origin = "http://localhost:3000";
const configuration = () => ({
  origin,
  secureCookies: false,
  keys: {
    fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
    replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
  },
});
function testApp() {
  const app = new Hono<{ Bindings: { db?: BookingDatabase } }>().basePath(
    "/api",
  );
  registerBookingRoutes(app, { configuration, clock: () => NOW });
  return app;
}
async function fixture(db: NodePgDatabase) {
  await seedCatalog(db);
  await db.update(businessSettings).set({ timeZone: "Asia/Tokyo" });
  await db.delete(businessHours);
  await db.insert(businessHours).values({
    businessId: 1,
    weekday: 1,
    windowIndex: 0,
    opensAt: "09:00",
    closesAt: "12:00",
  });
  await db.insert(staffSchedules).values({
    staffId: "mimi",
    weekday: 1,
    windowIndex: 0,
    opensAt: "09:00",
    closesAt: "12:00",
  });
  await db
    .update(services)
    .set({ durationMinutes: 30, cleanupMinutes: 15 })
    .where(eq(services.id, "cut_w"));
  const [service] = await db
    .select({
      id: services.id,
      name: services.name,
      priceCents: services.priceCents,
      currency: services.currency,
      durationMinutes: services.durationMinutes,
      cleanupMinutes: services.cleanupMinutes,
    })
    .from(services)
    .where(eq(services.id, "cut_w"));
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    credential: "a".repeat(64),
    booking: {
      staffId: "mimi",
      serviceIds: ["cut_w"],
      startsAt: "2026-06-01T09:00:00+09:00",
      reviewedServices: [service],
      contact: {
        name: "Guest",
        phone: "0888 123 456",
        email: "guest@example.test",
        note: "Private note",
      },
    },
  };
}
function post(
  app: ReturnType<typeof testApp>,
  db: BookingDatabase,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    "/api/bookings",
    {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { db },
  );
}
function privateResponse(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("POST registers a retained pair, creates once and replays the exact private receipt", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    const input = await fixture(db);
    const app = testApp();
    const first = await post(app, db, input);
    assert.equal(first.status, 200);
    privateResponse(first);
    const receipt = await first.json();
    assert.deepEqual(Object.keys(receipt).sort(), [
      "appointmentId",
      "confirmationExpiresAt",
      "viewToken",
    ]);
    assert.ok(/^[a-f0-9]{64}$/.test(receipt.viewToken));
    const retry = await post(app, independentDb, input);
    assert.equal(retry.status, 200);
    assert.ok(JSON.stringify(await retry.json()) === JSON.stringify(receipt));
    assert.equal((await db.select().from(appointments)).length, 1);
    assert.equal((await db.select().from(bookingOperations)).length, 1);
    const changed = structuredClone(input);
    changed.booking.contact.note = "Changed agreement";
    const conflict = await post(app, db, changed);
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      error: { code: "payload_conflict" },
    });
  });
});

test("POST rejects untrusted fields before registration and never echoes contact or credentials", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    for (const body of [
      null,
      [],
      { ...input, clientId: "internal" },
      { ...input, booking: { ...input.booking, total: 1 } },
      { ...input, credential: "bad" },
      {
        ...input,
        booking: { ...input.booking, serviceIds: Array(21).fill("cut_w") },
      },
      {
        ...input,
        booking: {
          ...input.booking,
          contact: { ...input.booking.contact, clientId: "internal" },
        },
      },
    ]) {
      const response = await post(testApp(), db, body);
      assert.equal(response.status, 400);
      privateResponse(response);
      assert.deepEqual(await response.json(), {
        error: { code: "invalid_booking" },
      });
    }
    assert.equal((await db.select().from(bookingOperations)).length, 0);
  });
});

for (const scenario of [
  "deactivated",
  "stale",
  "contact",
  "overlap",
] as const) {
  test(`POST handles ${scenario} without partial booking or disclosure`, async () => {
    await withTestDatabase({}, async ({ db }) => {
      const input = await fixture(db);
      const app = testApp();
      if (scenario === "deactivated")
        await db
          .update(services)
          .set({ isActive: false })
          .where(eq(services.id, "cut_w"));
      if (scenario === "stale")
        await db
          .update(services)
          .set({ priceCents: 9999 })
          .where(eq(services.id, "cut_w"));
      if (scenario === "contact") input.booking.contact.email = "not-an-email";
      if (scenario === "overlap") {
        assert.equal((await post(app, db, input)).status, 200);
        input.operationId = "22222222-2222-4222-8222-222222222222";
        input.credential = "b".repeat(64);
      }
      const response = await post(app, db, input);
      assert.equal(response.status, scenario === "contact" ? 400 : 409);
      privateResponse(response);
      const codes = {
        deactivated: "selection_unavailable",
        stale: "review_required",
        contact: "invalid_contact",
        overlap: "availability_conflict",
      };
      assert.deepEqual(await response.json(), {
        error: { code: codes[scenario] },
      });
      assert.equal(
        (await db.select().from(appointments)).length,
        scenario === "overlap" ? 1 : 0,
      );
    });
  });
}

test("POST enforces origin, media, actual byte limit and malformed JSON before database writes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const app = testApp();
    const forbiddenHeaders: Record<string, string>[] = [
      { origin: "http://evil.test" },
      { origin: "null" },
      { origin: "" },
      { "sec-fetch-site": "same-site" },
    ];
    for (const headers of forbiddenHeaders) {
      const response = await post(app, db, input, headers);
      assert.equal(response.status, 403);
      privateResponse(response);
      assert.deepEqual(await response.json(), {
        error: { code: "origin_forbidden" },
      });
    }
    const wrongMedia: Record<string, string>[] = [
      { "content-type": "text/plain" },
      { "content-encoding": "gzip" },
    ];
    for (const headers of wrongMedia) {
      const response = await post(app, db, input, headers);
      assert.equal(response.status, 415);
      privateResponse(response);
    }
    for (const [body, status] of [
      ["{", 400],
      [" ".repeat(32769), 413],
    ] as const) {
      const response = await app.request(
        "/api/bookings",
        {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "content-length": "1",
          },
          body,
        },
        { db },
      );
      assert.equal(response.status, status);
      privateResponse(response);
      assert.deepEqual(await response.json(), {
        error: {
          code: status === 413 ? "request_too_large" : "invalid_booking",
        },
      });
    }
    const query = await app.request(
      "/api/bookings?credential=forbidden",
      { method: "POST", headers: { origin }, body: JSON.stringify(input) },
      { db },
    );
    assert.equal(query.status, 400);
    assert.equal((await db.select().from(bookingOperations)).length, 0);
  });
});

test("POST redacts database/configuration failures and marks busy/unknown outcomes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    for (const failure of [
      new Error("private driver detail"),
      new BookingError("booking_busy"),
    ]) {
      const broken: BookingDatabase = {
        transaction: async () => {
          throw failure;
        },
      };
      const response = await post(testApp(), broken, input);
      assert.equal(response.status, 503);
      privateResponse(response);
      assert.deepEqual(await response.json(), {
        error: {
          code:
            failure instanceof BookingError
              ? "booking_busy"
              : "recovery_unavailable",
          outcome: "unknown",
        },
      });
    }
    const app = new Hono<{ Bindings: { db?: BookingDatabase } }>().basePath(
      "/api",
    );
    registerBookingRoutes(app, {
      configuration: () => {
        throw new Error("private key detail");
      },
    });
    const response = await post(app, db, input);
    assert.equal(response.status, 503);
    privateResponse(response);
    assert.deepEqual(await response.json(), {
      error: { code: "recovery_unavailable", outcome: "unknown" },
    });
    // A real database statement failure is likewise generic, not just a fake driver exception.
    const failing: BookingDatabase = {
      transaction: (action) =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select 1 / 0`);
          return action(tx);
        }),
    };
    assert.deepEqual(await (await post(testApp(), failing, input)).json(), {
      error: { code: "recovery_unavailable", outcome: "unknown" },
    });
  });
});

test("lost submit acknowledgement is unknown and same-pair retry recovers exactly one booking", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    let transactions = 0;
    const uncertain: BookingDatabase = {
      transaction: async (action) => {
        const result = await db.transaction(action);
        if (++transactions === 2)
          throw new Error("lost submit acknowledgement");
        return result;
      },
    };
    const response = await post(testApp(), uncertain, input);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: { code: "recovery_unavailable", outcome: "unknown" },
    });
    assert.equal((await db.select().from(appointments)).length, 1);
    const retries = await Promise.all([
      post(testApp(), db, input),
      post(testApp(), db, input),
    ]);
    assert.ok(retries.every((r) => r.status === 200));
    assert.ok(
      JSON.stringify(await retries[0].json()) ===
        JSON.stringify(await retries[1].json()),
    );
    const unauthorized = await post(testApp(), db, {
      ...input,
      credential: "f".repeat(64),
    });
    assert.equal(unauthorized.status, 409);
    assert.deepEqual(await unauthorized.json(), {
      error: { code: "operation_unavailable" },
    });
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("thin Next POST adapter keeps database-initialization failure inside private generic Hono semantics", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    const imported = await import('./src/app/api/[[...route]]/route.ts');
    const { POST } = imported.default ?? imported;
    const response = await POST(new Request('http://localhost:3000/api/bookings', { method: 'POST' }));
    process.stdout.write(JSON.stringify({ status: response.status, cache: response.headers.get('cache-control'), body: await response.json() }));
  `,
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: "invalid",
        SLOTWELL_BOOKING_ORIGIN: "",
        SLOTWELL_BOOKING_KEYS: "",
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(
    child.status,
    0,
    "adapter must not expose initialization exception; child output withheld",
  );
  assert.deepEqual(JSON.parse(child.stdout), {
    status: 503,
    cache: "no-store",
    body: { error: { code: "recovery_unavailable", outcome: "unknown" } },
  });
});

test("Hono CLI batch proves actual app POST and replay on the owned private PostgreSQL schema", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const input = await fixture(db);
    const schemaResult = await db.execute<{ name: string }>(
      sql`select current_schema() as name`,
    );
    const schema = schemaResult.rows[0].name;
    assert.ok(/^slotwell_test_[a-f0-9]{32}$/.test(schema));
    const directory = mkdtempSync(join(process.cwd(), ".booking-cli-"));
    try {
      const wrapper = join(directory, "app.ts");
      writeFileSync(
        wrapper,
        `
        import { Hono } from 'hono';
        import pg from 'pg';
        import { drizzle } from 'drizzle-orm/node-postgres';
        import app from '@/server/app';
        import { validateDatabaseUrl } from '@/db/open';
        const url = validateDatabaseUrl(process.env.TEST_DATABASE_URL);
        if (new URL(url).username !== 'slotwell_test') throw new Error('Test database required');
        const pool = new pg.Pool({ connectionString: url, options: '-c search_path=${schema}', max: 1, allowExitOnIdle: true });
        pool.on('error', () => {});
        const db = drizzle({ client: pool, logger: false, paramsInErrors: false });
        Date.now = () => ${NOW};
        const wrapper = new Hono();
        wrapper.all('*', c => app.fetch(c.req.raw, { db }));
        export default wrapper;
      `,
      );
      const first = {
        method: "POST",
        path: "/api/bookings",
        headers: { origin },
        body: input,
        expect: { status: 200 },
        save: {
          id: ".appointmentId",
          expiry: ".confirmationExpiresAt",
          token: ".viewToken",
        },
      };
      const replay = {
        ...first,
        save: undefined,
        expect: {
          status: 200,
          body: {
            appointmentId: "{{id}}",
            confirmationExpiresAt: "{{expiry}}",
            viewToken: "{{token}}",
          },
        },
      };
      const environment = {
        ...process.env,
        SLOTWELL_BOOKING_ORIGIN: origin,
        SLOTWELL_BOOKING_KEYS: JSON.stringify({
          fingerprint: { currentId: "h1", keys: { h1: "01".repeat(32) } },
          replay: { currentId: "e1", keys: { e1: "02".repeat(32) } },
        }),
        // The installed CLI bundles CommonJS pg into a data URL. Supply Node's real require
        // for its built-in-module imports; no source/dependency changes or dev server.
        NODE_OPTIONS:
          "--import=data:text/javascript,import{createRequire}from'node:module';globalThis.require=createRequire(process.cwd()+'/package.json')",
      };
      const child = spawnSync(
        process.execPath,
        [
          "node_modules/@hono/cli/dist/cli.js",
          "batch",
          "-",
          wrapper,
          "--compact",
        ],
        {
          env: environment,
          input: [first, replay].map((step) => JSON.stringify(step)).join("\n"),
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      // Never print captured bodies, credentials, receipt tokens or driver errors on failure.
      assert.equal(
        child.status,
        0,
        "Hono CLI exits successfully; captured output withheld",
      );
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.summary, { total: 2, passed: 2, failed: 0 });
      assert.equal((await db.select().from(appointments)).length, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
