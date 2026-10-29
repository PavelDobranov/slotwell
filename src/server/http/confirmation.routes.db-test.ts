import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Hono } from "hono";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  clients,
  services,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { registerConfirmationRoutes } from "@/server/http/confirmation.routes";

const origin = "http://localhost:3000";
const id = "11111111-1111-4111-8111-111111111111";
const token = "ab".repeat(32);
const input = { appointmentId: id, viewToken: token };
const start = Date.parse("2026-06-01T00:00:00Z");
const expiry = start + 30 * 60_000 + 168 * 3_600_000;
const path = "/api/confirmations/read";
function testApp(clock = () => start) {
  const app = new Hono<{
    Bindings: { db?: Pick<NodePgDatabase, "select"> };
  }>().basePath("/api");
  registerConfirmationRoutes(app, { configuration: () => ({ origin }), clock });
  return app;
}
async function fixture(db: NodePgDatabase) {
  await seedCatalog(db);
  await db.insert(clients).values({ id, normalizedPhone: "+359888123456" });
  await db.insert(appointments).values({
    id,
    clientId: id,
    staffId: "mimi",
    contactName: "Private name",
    contactPhone: "+359888123456",
    contactEmail: "private@example.test",
    notes: "Private note",
    staffName: "Booked staff",
    businessAddress: "Booked address",
    bookingTimeZone: "Asia/Tokyo",
    startsAt: new Date(start).toISOString(),
    serviceEndsAt: new Date(start + 30 * 60_000).toISOString(),
    occupiedEndsAt: new Date(start + 45 * 60_000).toISOString(),
    createdAt: new Date(start - 86_400_000).toISOString(),
    confirmationExpiresAt: new Date(expiry).toISOString(),
  });
  const [service] = await db.select().from(services).limit(1);
  await db.insert(appointmentServices).values({
    appointmentId: id,
    position: 0,
    serviceId: service.id,
    name: "Booked service",
    priceCents: null,
    currency: "BGN",
    durationMinutes: 30,
    cleanupMinutes: 15,
  });
  await db.insert(appointmentAccess).values({
    appointmentId: id,
    tokenHash: createHash("sha256")
      .update(Buffer.from(token, "hex"))
      .digest("hex"),
  });
}
function request(
  app: ReturnType<typeof testApp>,
  db: Pick<NodePgDatabase, "select"> | undefined,
  body: unknown = input,
  headers: Record<string, string> = {},
) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
    { db },
  );
}
function privacy(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("set-cookie"), null);
}
async function failure(response: Response, status: number, code: string) {
  privacy(response);
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: { code } });
}

test("confirmation POST returns the exact minimal booked snapshot without token or contact data", async () => {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    await fixture(db);
    const response = await request(
      testApp(() => expiry - 1),
      independentDb,
    );
    privacy(response);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "confirmed",
      startsAt: new Date(start).toISOString(),
      serviceEndsAt: new Date(start + 30 * 60_000).toISOString(),
      bookingTimeZone: "Asia/Tokyo",
      staffName: "Booked staff",
      businessAddress: "Booked address",
      confirmationExpiresAt: new Date(expiry).toISOString(),
      services: [
        {
          name: "Booked service",
          priceCents: null,
          currency: "BGN",
          durationMinutes: 30,
        },
      ],
    });
    for (const now of [expiry, expiry + 1])
      await failure(
        await request(
          testApp(() => now),
          db,
        ),
        404,
        "confirmation_unavailable",
      );
    await failure(
      await request(testApp(), db, { ...input, viewToken: "cd".repeat(32) }),
      404,
      "confirmation_unavailable",
    );
    assert.equal((await db.select().from(appointments)).length, 1);
  });
});

test("confirmation validates origin, media, exact fields and primitives before database I/O", async () => {
  let reads = 0;
  const db = {
    select: () => {
      reads++;
      throw new Error("must not read");
    },
  } as unknown as NodePgDatabase;
  const app = testApp();
  for (const headers of Array.of<Record<string, string>>(
    { origin: "" },
    { origin: "null" },
    { origin: "http://foreign.test" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ))
    await failure(
      await request(app, db, input, headers),
      403,
      "origin_forbidden",
    );
  for (const headers of Array.of<Record<string, string>>(
    { "content-type": "text/plain" },
    { "content-type": "application/json; charset=latin1" },
    { "content-encoding": "gzip" },
  ))
    await failure(
      await request(app, db, input, headers),
      415,
      "unsupported_media_type",
    );
  for (const body of [
    null,
    [],
    {},
    { ...input, contact: "private" },
    { appointmentId: id },
    { ...input, viewToken: token.toUpperCase() },
    { ...input, appointmentId: 1 },
    { ...input, viewToken: { token } },
  ])
    await failure(await request(app, db, body), 400, "invalid_confirmation");
  await failure(
    await app.request(
      `${path}?viewToken=not-a-credential`,
      {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      { db },
    ),
    400,
    "invalid_confirmation",
  );
  await failure(
    await app.request(
      path,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      { db },
    ),
    403,
    "origin_forbidden",
  );
  assert.equal(reads, 0);
});

test("confirmation enforces actual UTF-8 bytes including streamed bodies and lying lengths", async () => {
  const app = testApp();
  for (const body of [
    "{",
    new Uint8Array([0xff]),
    "",
    JSON.stringify({ ...input, extra: "я".repeat(600) }),
  ]) {
    const response = await app.request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "content-length": "1",
      },
      body,
    });
    await failure(
      response,
      typeof body === "string" && Buffer.byteLength(body) > 1024 ? 413 : 400,
      typeof body === "string" && Buffer.byteLength(body) > 1024
        ? "request_too_large"
        : "invalid_confirmation",
    );
  }
  const text = JSON.stringify(input);
  const padded = text.padEnd(1024, " ");
  // Exactly the limit parses successfully, then fails only because no DB is bound.
  await failure(
    await app.request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json; charset=UTF-8",
        "content-encoding": "identity",
        "sec-fetch-site": "same-origin",
        "content-length": "9999",
      },
      body: padded,
    }),
    503,
    "confirmation_temporarily_unavailable",
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from(padded));
      controller.enqueue(Buffer.from(" "));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "content-length": "1",
    },
    body: stream,
    duplex: "half",
  } as RequestInit);
  await failure(await app.request(streamed), 413, "request_too_large");
  assert.equal(cancelled, true);
});

test("configuration, database and clock failures are private and cookies never grant access", async () => {
  const app = new Hono<{
    Bindings: { db?: Pick<NodePgDatabase, "select"> };
  }>().basePath("/api");
  registerConfirmationRoutes(app, {
    configuration: () => {
      throw new Error("private configuration");
    },
  });
  await failure(
    await request(app, undefined),
    503,
    "confirmation_temporarily_unavailable",
  );
  await failure(
    await request(testApp(), undefined, input, {
      cookie: "viewToken=not-authorization",
    }),
    503,
    "confirmation_temporarily_unavailable",
  );
  await failure(
    await request(
      testApp(),
      undefined,
      {},
      { cookie: "viewToken=not-authorization" },
    ),
    400,
    "invalid_confirmation",
  );
  const db = {
    select: () => {
      throw new Error("private SQL credential");
    },
  } as unknown as NodePgDatabase;
  await failure(
    await request(testApp(), db),
    503,
    "confirmation_temporarily_unavailable",
  );
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    await failure(
      await request(
        testApp(() => NaN),
        db,
      ),
      503,
      "confirmation_temporarily_unavailable",
    );
    await failure(
      await request(
        testApp(),
        db,
        { ...input, viewToken: "cd".repeat(32) },
        { cookie: `viewToken=${token}` },
      ),
      404,
      "confirmation_unavailable",
    );
  });
});

test("every unsupported Hono method has private 405 with Allow and HEAD has no body", async () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"]) {
    const response = await testApp().request(path, { method });
    privacy(response);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else
      assert.deepEqual(await response.json(), {
        error: { code: "method_not_allowed" },
      });
  }
});

test("dedicated Next adapter explicitly dispatches every supported method and hides failed DB setup", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--eval",
      `
    const route = require('./src/app/api/confirmations/read/route.ts');
    (async () => {
      const results = [];
      for (const method of ['GET','HEAD','OPTIONS','PUT','PATCH','DELETE','POST']) {
        if (typeof route[method] !== 'function') throw new Error('Explicit method export required');
        const response = await route[method](new Request('http://localhost:3000${path}', {
          method, headers: { origin: '${origin}', 'content-type': 'application/json' },
          ...(method === 'POST' ? { body: JSON.stringify(${JSON.stringify(input)}) } : {})
        }));
        results.push({ method, status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
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
    "Next adapter subprocess succeeds; captured diagnostics withheld",
  );
  const results = JSON.parse(child.stdout) as {
    method: string;
    status: number;
    headers: Record<string, string>;
    body: string;
  }[];
  assert.equal(results.length, 7);
  for (const result of results) {
    const response = new Response(result.body || null, {
      status: result.status,
      headers: result.headers,
    });
    privacy(response);
    assert.equal(result.status, result.method === "POST" ? 503 : 405);
    if (result.method === "HEAD") assert.equal(result.body, "");
    else
      assert.deepEqual(JSON.parse(result.body), {
        error: {
          code:
            result.method === "POST"
              ? "confirmation_temporarily_unavailable"
              : "method_not_allowed",
        },
      });
    if (result.method !== "POST") assert.equal(result.headers.allow, "POST");
  }
});

test("Hono CLI verifies mounted confirmation access and privacy on an owned private schema without replay keys", async () => {
  await withTestDatabase({}, async ({ db }) => {
    await fixture(db);
    const schema = (
      await db.execute<{ name: string }>(sql`select current_schema() as name`)
    ).rows[0].name;
    assert.match(schema, /^slotwell_test_[a-f0-9]{32}$/);
    const directory = mkdtempSync(join(process.cwd(), ".confirmation-cli-"));
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
        Date.now = () => ${start};
        const wrapper = new Hono();
        wrapper.all('*', async c => {
          const response = await app.fetch(c.req.raw, { db });
          const h = response.headers;
          if (h.get('cache-control') !== 'no-store' || h.get('referrer-policy') !== 'no-referrer' || h.get('x-content-type-options') !== 'nosniff' || h.get('x-robots-tag') !== 'noindex, nofollow, noarchive' || h.has('set-cookie') || h.has('access-control-allow-origin')) return c.body(null, 599);
          return response;
        });
        export default wrapper;
      `,
      );
      const steps = [
        {
          method: "POST",
          path,
          headers: { origin },
          body: input,
          expect: {
            status: 200,
            body: {
              status: "confirmed",
              staffName: "Booked staff",
              businessAddress: "Booked address",
              services: [
                {
                  name: "Booked service",
                  priceCents: null,
                  currency: "BGN",
                  durationMinutes: 30,
                },
              ],
            },
          },
        },
        {
          method: "POST",
          path,
          headers: { origin },
          body: { ...input, viewToken: "cd".repeat(32) },
          expect: {
            status: 404,
            body: { error: { code: "confirmation_unavailable" } },
          },
        },
        { method: "GET", path, expect: { status: 405 } },
        { method: "OPTIONS", path, expect: { status: 405 } },
      ];
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
          env: {
            ...process.env,
            SLOTWELL_BOOKING_ORIGIN: origin,
            SLOTWELL_BOOKING_KEYS: "",
            NODE_OPTIONS:
              "--import=data:text/javascript,import{createRequire}from'node:module';globalThis.require=createRequire(process.cwd()+'/package.json')",
          },
          input: steps.map((step) => JSON.stringify(step)).join("\n"),
          encoding: "utf8",
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      assert.equal(
        child.status,
        0,
        "Hono CLI succeeds; captured private output withheld",
      );
      const result = JSON.parse(child.stdout);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.summary, { total: 4, passed: 4, failed: 0 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
