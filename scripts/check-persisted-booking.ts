import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { chromium, type Page } from "@playwright/test";
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  bookingOperations,
} from "@/db/schema";
import { seedCatalog, seedSchedules } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { readBookingKeys } from "@/server/booking";
import type { CatalogDatabase } from "@/server/catalog";
import { registerAvailabilityRoutes } from "@/server/http/availability.routes";
import { registerBookingRoutes } from "@/server/http/booking.routes";
import { registerBookingIntentRoutes } from "@/server/http/booking-intents.routes";
import { registerCatalogRoutes } from "@/server/http/catalog.routes";
import { registerConfirmationRoutes } from "@/server/http/confirmation.routes";

// Run after the production build: npx tsx scripts/check-persisted-booking.ts.
// This is browser -> in-process real HTTP adapters -> held private-schema DB,
// NOT production-process DB fixture ownership (#76). Never record private artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
let server: ChildProcess | undefined;
let origin = "";
let stage = 0; // Non-sensitive progress code only; never expose caught errors.
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function stop() {
  const child = server;
  server = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
async function boot() {
  // Refuse occupied explicit ports; default to an OS-selected free loopback port.
  const requested = Number(process.env.SLOTWELL_CHECK_PORT ?? "0");
  assert.ok(
    Number.isInteger(requested) && requested >= 0 && requested <= 65535,
  );
  const reservation = createServer();
  reservation.listen(requested, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  origin = `http://127.0.0.1:${port}`;
  let ready = false;
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      // Even a missed browser interception must not reach the application DB.
      env: {
        ...process.env,
        DATABASE_URL: "disabled",
        TEST_DATABASE_URL: "",
        SLOTWELL_BOOKING_KEYS: "",
        DEBUG: "",
        PWDEBUG: "",
      },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  server.on("error", () => {});
  server.stdout?.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("Ready in")) ready = true;
  });
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error("server_unavailable");
    // Do not mistake somebody else's socket in the release/bind race for ours.
    if (
      ready &&
      (await fetch(`${origin}/book`, { signal: AbortSignal.timeout(2000) })).ok
    )
      return;
    await delay(100);
  }
  throw new Error("server_unavailable");
}
async function review(page: Page) {
  stage = 40;
  await page.goto(`${origin}/book`);
  await page.getByRole("checkbox", { name: /Дамско подстригване/ }).check();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  stage = 41;
  await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
  stage = 42;
  // Weekly rolling seed guarantees an opening within this seven-day window.
  for (let day = 0; day < 7; day++) {
    const date = page
      .getByRole("radiogroup", { name: "Дати", exact: true })
      .getByRole("radio")
      .nth(day);
    await date.check();
    await page
      .getByRole("button", { name: "Обнови часовете", exact: true })
      .waitFor();
    // Loading disables this control; wait without returning any private DOM.
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        (button) =>
          button.textContent?.trim() === "Обнови часовете" && !button.disabled,
      ),
    );
    const times = page.getByRole("radio", {
      name: /^\d{2}:\d{2}–\d{2}:\d{2}$/,
    });
    if (await times.count()) {
      await times.first().check();
      break;
    }
  }
  stage = 43;
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Synthetic guest");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("0888123456");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("synthetic@example.test");
  stage = 44;
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await page.getByRole("heading", { name: "Проверете и потвърдете" }).waitFor();
}
async function confirmed(page: Page) {
  await page
    .getByRole("heading", { name: "Резервацията е потвърдена" })
    .waitFor();
  assert.equal(new URL(page.url()).pathname, "/confirmation");
}
async function retainedCount(page: Page) {
  // Only a count leaves the browser; credentials never do.
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("slotwell-booking-intents", 1);
        open.onerror = () => reject(new Error("storage_unavailable"));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction("intents", "readonly");
          const request = tx.objectStore("intents").count();
          tx.oncomplete = () => {
            db.close();
            resolve(request.result);
          };
          tx.onabort = () => {
            db.close();
            reject(new Error("storage_unavailable"));
          };
        };
      }),
  );
}
async function check() {
  await withTestDatabase({}, async ({ db, independentDb, now }) => {
    stage = 1;
    await seedCatalog(db);
    await seedSchedules(db, { anchor: now });
    const keys = readBookingKeys({
      SLOTWELL_BOOKING_KEYS: JSON.stringify({
        fingerprint: {
          currentId: "h1",
          keys: { h1: randomBytes(32).toString("hex") },
        },
        replay: {
          currentId: "e1",
          keys: { e1: randomBytes(32).toString("hex") },
        },
      }),
    });
    stage = 2;
    await boot();
    stage = 3;
    const browser = await chromium.launch({
      env: { ...process.env, DEBUG: "", PWDEBUG: "" },
    });
    let failed = false;
    let submissions = 0;
    let confirmations = 0;
    let queue = Promise.resolve();
    const configuration = () => ({ origin, keys });
    // Held pg clients are not pools: serialize whole adapter invocations, not SQL.
    function dispatch(request: Request) {
      const result = queue.then(async () => {
        const app = new Hono<{
          Bindings: { db?: typeof independentDb };
        }>().basePath("/api");
        app.onError(() => new Response(null, { status: 503 }));
        const reads = new Hono<{ Bindings: { db?: CatalogDatabase } }>();
        registerCatalogRoutes(reads);
        registerAvailabilityRoutes(reads); // Existing adapter owns Date.now(); seed rolls with real time.
        app.route("/", reads);
        registerBookingRoutes(app, { configuration, clock: () => now });
        registerBookingIntentRoutes(app, { configuration, clock: () => now });
        registerConfirmationRoutes(app, { configuration, clock: () => now });
        return app.request(request, undefined, { db: independentDb });
      });
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    }
    type Mode = "normal" | "lost" | "delayed";
    async function context(mode: Mode) {
      const context = await browser.newContext({
        serviceWorkers: "block",
        timezoneId: "Europe/Sofia",
      });
      context.setDefaultTimeout(15000);
      const held = signal();
      const arrived = signal();
      const finished = signal();
      let originalPair = "";
      let pairMatches = true;
      let resolves = 0;
      let lateRejected = false;
      await context.route("**/*", async (route) => {
        const browserRequest = route.request();
        const url = new URL(browserRequest.url());
        if (
          url.origin === origin &&
          url.pathname !== "/api" &&
          !url.pathname.startsWith("/api/")
        )
          return route.continue();
        // No external network, no unknown API fallback (including other origins).
        const known = [
          "/api/catalog",
          "/api/staff",
          "/api/availability",
          "/api/bookings",
          "/api/booking-intents/resolve",
          "/api/booking-intents/clear",
          "/api/confirmations/read",
        ];
        if (url.origin !== origin || !known.includes(url.pathname)) {
          failed = true;
          await route.abort("blockedbyclient");
          return;
        }
        try {
          const headers = await browserRequest.allHeaders();
          const body = browserRequest.postDataBuffer();
          if (browserRequest.method() === "POST") {
            assert.equal(headers.origin, origin);
            // Chromium interception may omit Fetch Metadata; the HTTP contract
            // permits absence. Forward actual headers, never manufacture it.
            assert.ok(
              [undefined, "same-origin"].includes(headers["sec-fetch-site"]),
            );
            assert.equal(headers.referer, undefined);
            assert.equal(headers.cookie, undefined);
            assert.equal(url.search, "");
          }
          if (url.pathname === "/api/booking-intents/resolve") {
            const pair = body?.toString() ?? "";
            if (++resolves === 1) originalPair = pair;
            else pairMatches &&= pair === originalPair;
          }
          const isSubmission = url.pathname === "/api/bookings";
          if (isSubmission) {
            submissions++;
            if (mode === "delayed") {
              arrived.resolve();
              await held.promise;
            }
          }
          const response = await dispatch(
            new Request(url, {
              method: browserRequest.method(),
              headers,
              body: body === null ? undefined : new Uint8Array(body),
            }),
          );
          if (browserRequest.method() === "POST") {
            assert.equal(response.headers.get("cache-control"), "no-store");
            assert.equal(
              response.headers.get("referrer-policy"),
              "no-referrer",
            );
            assert.equal(
              response.headers.get("x-content-type-options"),
              "nosniff",
            );
          }
          if (isSubmission && mode === "delayed") {
            lateRejected =
              response.status === 409 &&
              (await response.clone().json()).error.code ===
                "operation_unavailable";
          } else assert.equal(response.status, 200);
          if (url.pathname === "/api/confirmations/read") confirmations++;
          if (isSubmission && mode === "lost")
            return await route.abort("failed");
          await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text(),
          });
          if (isSubmission && mode === "delayed") finished.resolve();
        } catch {
          failed = true;
          finished.resolve();
          await route.abort("failed").catch(() => {});
        }
      });
      return {
        context,
        held,
        arrived,
        finished,
        samePair: () => pairMatches && resolves >= 2,
        rejected: () => lateRejected,
      };
    }
    async function counts(expected: number) {
      await queue;
      for (const table of [
        appointments,
        appointmentServices,
        appointmentAccess,
      ]) {
        const [result] = await db.select({ total: count() }).from(table);
        assert.equal(result.total, expected);
      }
    }
    try {
      stage = 4;
      const normal = await context("normal");
      try {
        const page = await normal.context.newPage();
        await review(page);
        stage = 5;
        await page
          .getByRole("button", { name: "Потвърди резервацията", exact: true })
          .click({ clickCount: 2 });
        await confirmed(page);
        await page.reload();
        await confirmed(page);
        await counts(1);
        assert.equal(submissions, 1);
        assert.ok(confirmations >= 2);
      } finally {
        await normal.context.close();
      }

      stage = 6;
      const lost = await context("lost");
      try {
        const page = await lost.context.newPage();
        await review(page);
        await page
          .getByRole("button", { name: "Потвърди резервацията", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Резултатът още не е известен" })
          .waitFor();
        await counts(2);
        await page.reload();
        await confirmed(page);
        await counts(2);
        assert.equal(submissions, 2);
        assert.equal(lost.samePair(), true);
        assert.equal(await retainedCount(page), 1);
      } finally {
        await lost.context.close();
      }

      stage = 7;
      const delayed = await context("delayed");
      try {
        const first = await delayed.context.newPage();
        await review(first);
        await first
          .getByRole("button", { name: "Потвърди резервацията", exact: true })
          .click();
        await Promise.race([
          delayed.arrived.promise,
          delay(15000).then(() => {
            throw new Error("submission_timeout");
          }),
        ]);
        const second = await delayed.context.newPage(); // Independent tab: no opener/session hint copy.
        await second.goto(`${origin}/book`);
        await second
          .getByRole("button", { name: "Възстанови опит 1", exact: true })
          .click();
        await second
          .getByRole("heading", {
            name: "Този запазен опит е само за възстановяване",
          })
          .waitFor();
        await second.reload();
        await second
          .getByRole("heading", {
            name: "Този запазен опит е само за възстановяване",
          })
          .waitFor();
        assert.equal(
          await second
            .getByRole("checkbox", { name: /Дамско подстригване/ })
            .isDisabled(),
          true,
        );
        assert.equal(submissions, 3);
        assert.equal(delayed.samePair(), true);
        await second
          .getByRole("button", { name: "Изчисти този опит", exact: true })
          .click();
        await second
          .getByRole("button", { name: "Изчисти този опит", exact: true })
          .waitFor({ state: "hidden" });
        assert.equal(await retainedCount(second), 0);
        delayed.held.resolve();
        await Promise.race([
          delayed.finished.promise,
          delay(15000).then(() => {
            throw new Error("submission_timeout");
          }),
        ]);
        assert.equal(delayed.rejected(), true);
        await counts(2);
        assert.equal(await retainedCount(first), 0);
        await first.reload();
        assert.equal(await retainedCount(first), 0);
        const [fences] = await db
          .select({ total: count() })
          .from(bookingOperations)
          .where(eq(bookingOperations.state, "abandoned"));
        assert.equal(fences.total, 1);
        const [operations] = await db
          .select({ total: count() })
          .from(bookingOperations);
        assert.equal(operations.total, 3);
      } finally {
        delayed.held.resolve();
        await delayed.context.close();
      }
      assert.equal(failed, false);
      console.log(
        "Persisted booking private DB/browser check passed (submit/reload, lost-response recovery, two-tab recovery-only/fence).",
      );
    } finally {
      await browser.close();
      await queue;
      await stop();
    }
  });
}
check().catch(async () => {
  await stop();
  console.error(
    `Persisted booking private DB/browser check failed (stage ${stage}); details redacted.`,
  );
  process.exitCode = 1;
});
