import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono } from "hono";

import {
  appointmentAccess,
  appointments,
  bookingOperations,
  businessHours,
  businessSettings,
  services,
  staffSchedules,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import mountedApp from "@/server/app";
import { submitBooking } from "@/server/booking";
import { registerBookingIntentRoutes } from "@/server/http/booking-intents.routes";

const NOW = Date.parse("2026-05-31T22:00:00Z");
const origin = "http://localhost:3000";
const pair = {
  operationId: "11111111-1111-4111-8111-111111111111",
  credential: "a".repeat(64),
};
const keys = () => ({
  fingerprint: { currentId: "h1", keys: { h1: Buffer.alloc(32, 1) } },
  replay: { currentId: "e1", keys: { e1: Buffer.alloc(32, 2) } },
});
function testApp(configuration = () => ({ origin, keys: keys() })) {
  const app = new Hono<{ Bindings: { db?: NodePgDatabase } }>().basePath(
    "/api",
  );
  registerBookingIntentRoutes(app, { configuration, clock: () => NOW });
  return app;
}
function request(
  app: ReturnType<typeof testApp>,
  db: NodePgDatabase | undefined,
  action = "resolve",
  body: unknown = pair,
) {
  return app.request(
    `/api/booking-intents/${action}`,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    { db },
  );
}
function privacy(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(response.headers.has("access-control-allow-origin"), false);
}
async function failure(response: Response, status: number, code: string) {
  privacy(response);
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), {
    error: { code, ...(status === 503 ? { outcome: "unknown" } : {}) },
  });
}

test("lifecycle transport registers/resolves retained pairs then durably fences explicit clearing", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const app = testApp();
    for (let i = 0; i < 2; i++) {
      const response = await request(app, db);
      privacy(response);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        state: "pending",
        submitBefore: new Date(NOW + 86_400_000).toISOString(),
      });
    }
    const original = await db.select().from(bookingOperations);
    for (const action of ["resolve", "clear"]) {
      await failure(
        await request(app, db, action, { ...pair, credential: "b".repeat(64) }),
        409,
        "operation_unavailable",
      );
    }
    assert.deepEqual(await db.select().from(bookingOperations), original);
    for (let i = 0; i < 2; i++) {
      const response = await request(app, db, "clear");
      privacy(response);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { state: "fenced" });
    }
    await failure(await request(app, db), 409, "operation_unavailable");
    assert.deepEqual(
      await db.select().from(bookingOperations),
      original.map((row) => ({ ...row, state: "abandoned" })),
    );
  });
});

test("committed lifecycle transport returns only the original receipt or a clear classification", async () => {
  await withTestDatabase({}, async ({ db }) => {
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
    const [service] = await db
      .select()
      .from(services)
      .where(eq(services.id, "cut_w"));
    const receipt = await submitBooking(
      db,
      {
        authorization: pair,
        input: {
          staffId: "mimi",
          serviceIds: [service.id],
          startsAt: "2026-06-01T09:00:00+09:00",
          reviewedServices: [service],
          contact: {
            name: "Guest",
            phone: "0888 123 456",
            email: "guest@example.test",
            note: "Private note",
          },
        },
      },
      { keys: keys(), clock: () => NOW },
    );
    const history = async () => ({
      operations: await db.select().from(bookingOperations),
      appointments: await db.select().from(appointments),
      access: await db.select().from(appointmentAccess),
    });
    const original = await history();
    const response = await request(testApp(), db);
    privacy(response);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "committed", receipt });
    const clear = await request(testApp(), db, "clear");
    privacy(clear);
    assert.equal(clear.status, 200);
    assert.deepEqual(await clear.json(), { state: "committed" });
    assert.deepEqual(await history(), original);
  });
});

test("clear transport seals an unregistered pair without creating pending work", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const response = await request(testApp(), db, "clear");
    privacy(response);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { state: "fenced" });
    const rows = await db.select().from(bookingOperations);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "abandoned");
    await failure(await request(testApp(), db), 409, "operation_unavailable");
    assert.deepEqual(await db.select().from(bookingOperations), rows);
  });
});

test("boundary rejections preserve privacy and cannot register or fence", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const app = testApp();
    for (const action of ["resolve", "clear"]) {
      const url = `/api/booking-intents/${action}`;
      const send = (
        body: BodyInit | null,
        headers: Record<string, string>,
        suffix = "",
      ) => app.request(url + suffix, { method: "POST", headers, body }, { db });
      const valid = { origin, "content-type": "application/json" };
      for (const headers of [
        { "content-type": "application/json" },
        { ...valid, origin: "null" },
        { ...valid, origin: "https://foreign.test" },
        { ...valid, "sec-fetch-site": "same-site" },
      ])
        await failure(
          await send("malformed", headers),
          403,
          "origin_forbidden",
        );
      await failure(
        await send(JSON.stringify(pair), valid, "?extra=1"),
        400,
        "invalid_booking",
      );
      for (const headers of [
        { origin },
        { ...valid, "content-type": "text/plain" },
        { ...valid, "content-type": "application/json; charset=latin1" },
        { ...valid, "content-encoding": "gzip" },
      ])
        await failure(
          await send(JSON.stringify(pair), headers),
          415,
          "unsupported_media_type",
        );
      for (const body of [
        null,
        "{",
        "null",
        "[]",
        "{}",
        ...[
          { ...pair, extra: "private" },
          { ...pair, credential: [pair.credential] },
          { ...pair, operationId: 1 },
          { ...pair, credential: "A".repeat(64) },
          { ...pair, operationId: "not-a-uuid" },
        ].map((value) => JSON.stringify(value)),
      ]) {
        await failure(await send(body, valid), 400, "invalid_booking");
      }
      const invalidUtf8 = new Uint8Array([0x7b, 0xff, 0x7d]);
      await failure(await send(invalidUtf8, valid), 400, "invalid_booking");
      await failure(
        await send(" ".repeat(1025), { ...valid, "content-length": "1" }),
        413,
        "request_too_large",
      );
    }
    assert.deepEqual(await db.select().from(bookingOperations), []);
  });
});

test("exact byte limit, absent length and stream overflow use actual body bytes", async () => {
  await withTestDatabase({}, async ({ db }) => {
    const raw = JSON.stringify(pair);
    const app = testApp();
    const response = await app.request(
      "/api/booking-intents/resolve",
      {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json; charset=UTF-8",
          "sec-fetch-site": "same-origin",
          "content-encoding": "identity",
        },
        body: raw.padEnd(1024),
      },
      { db },
    );
    privacy(response);
    assert.equal(response.status, 200);
    for (const action of ["resolve", "clear"]) {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(raw.padEnd(1024)));
          controller.enqueue(new Uint8Array([32]));
        },
        cancel() {
          cancelled = true;
        },
      });
      const streamed = new Request(
        `http://localhost/api/booking-intents/${action}`,
        {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: stream,
          duplex: "half",
        } as RequestInit,
      );
      await failure(
        await app.request(streamed, undefined, { db }),
        413,
        "request_too_large",
      );
      assert.equal(cancelled, true);
    }
    const rows = await db.select().from(bookingOperations);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "pending");
  });
});

test("configuration precedes origin and body, and unavailable setup stays unknown", async () => {
  const broken = testApp(() => {
    throw new Error("private configuration");
  });
  for (const action of ["resolve", "clear"]) {
    await failure(
      await broken.request(`/api/booking-intents/${action}`, {
        method: "POST",
      }),
      503,
      "recovery_unavailable",
    );
    await failure(
      await request(testApp(), undefined, action),
      503,
      "recovery_unavailable",
    );
    await failure(
      await request(testApp(), undefined, action, {}),
      400,
      "invalid_booking",
    );
  }
});

test("mounted app handles both lifecycle actions and Next dispatches all seven methods privately", async () => {
  for (const action of ["resolve", "clear"]) {
    const response = await mountedApp.request(`/api/booking-intents/${action}`);
    privacy(response);
    assert.equal(response.status, 405);
  }
  const child = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--eval",
      `
      const route = require('./src/app/api/booking-intents/[action]/route.ts');
      (async () => {
        const results = [];
        for (const action of ['resolve','clear']) {
          for (const method of ['GET','HEAD','OPTIONS','PUT','PATCH','DELETE','POST']) {
            if (typeof route[method] !== 'function') throw new Error('Explicit export required');
            const response = await route[method](new Request('http://localhost:3000/api/booking-intents/' + action, {
              method, headers: { origin: '${origin}', 'content-type': 'application/json' },
              ...(method === 'POST' ? { body: JSON.stringify(${JSON.stringify(pair)}) } : {})
            }));
            results.push({ method, status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
          }
        }
        process.stdout.write(JSON.stringify(results));
      })().catch(() => process.exit(1));
    `,
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        DATABASE_URL: "",
        SLOTWELL_BOOKING_ORIGIN: origin,
        SLOTWELL_BOOKING_KEYS: "",
      },
    },
  );
  assert.equal(
    child.status,
    0,
    "Next dispatch subprocess succeeds; private diagnostics withheld",
  );
  const results = JSON.parse(child.stdout) as {
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
  }[];
  assert.equal(results.length, 14);
  for (const result of results) {
    privacy(
      new Response(result.body || null, {
        status: result.status,
        headers: result.headers,
      }),
    );
    assert.equal(result.status, result.method === "POST" ? 503 : 405);
    if (result.method === "HEAD") assert.equal(result.body, "");
    else
      assert.deepEqual(JSON.parse(result.body), {
        error:
          result.method === "POST"
            ? { code: "recovery_unavailable", outcome: "unknown" }
            : { code: "method_not_allowed" },
      });
  }
});

test("installed Hono CLI checks both mounted lifecycle endpoints without secret-bearing artifacts", () => {
  const steps = [
    {
      method: "GET",
      path: "/api/booking-intents/resolve",
      expect: { status: 405 },
    },
    {
      method: "OPTIONS",
      path: "/api/booking-intents/clear",
      expect: { status: 405 },
    },
    {
      method: "POST",
      path: "/api/booking-intents/resolve",
      body: pair,
      expect: { status: 403, body: { error: { code: "origin_forbidden" } } },
    },
    {
      method: "POST",
      path: "/api/booking-intents/clear",
      headers: { origin },
      body: {},
      expect: { status: 400, body: { error: { code: "invalid_booking" } } },
    },
    {
      method: "POST",
      path: "/api/booking-intents/resolve",
      headers: { origin },
      body: pair,
      expect: {
        status: 503,
        body: { error: { code: "recovery_unavailable", outcome: "unknown" } },
      },
    },
    {
      method: "POST",
      path: "/api/booking-intents/clear",
      headers: { origin },
      body: pair,
      expect: {
        status: 503,
        body: { error: { code: "recovery_unavailable", outcome: "unknown" } },
      },
    },
  ];
  const result = spawnSync("npx", ["hono", "batch", "-", "src/server/app.ts"], {
    encoding: "utf8",
    timeout: 30000,
    input: steps.map((step) => JSON.stringify(step)).join("\n"),
    env: {
      ...process.env,
      NODE_OPTIONS:
        "--import=data:text/javascript,import{createRequire}from'node:module';globalThis.require=createRequire(process.cwd()+'/package.json')",
      SLOTWELL_BOOKING_ORIGIN: origin,
      SLOTWELL_BOOKING_KEYS: JSON.stringify({
        fingerprint: { currentId: "h1", keys: { h1: "01".repeat(32) } },
        replay: { currentId: "e1", keys: { e1: "02".repeat(32) } },
      }),
    },
  });
  assert.equal(
    result.status,
    0,
    "CLI batch succeeds; captured request/response diagnostics withheld",
  );
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data.summary.failed, 0);
  assert.equal(output.data.summary.passed, steps.length);
});

test("unsupported lifecycle methods have private 405 and never need configuration", async () => {
  const app = testApp(() => {
    throw new Error("private configuration");
  });
  for (const action of ["resolve", "clear"]) {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
      const response = await app.request(`/api/booking-intents/${action}`, {
        method,
      });
      privacy(response);
      assert.equal(response.status, 405);
      assert.equal(response.headers.get("allow"), "POST");
      if (method === "HEAD") assert.equal(await response.text(), "");
      else
        assert.deepEqual(await response.json(), {
          error: { code: "method_not_allowed" },
        });
    }
  }
});
