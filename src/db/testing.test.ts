import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import { afterEach, beforeEach, mock, test } from "node:test";
import dotenv from "dotenv";
import pg from "pg";

import { withTestDatabase } from "@/db/testing";

const url =
  "postgresql://slotwell_test:fictional-secret@127.0.0.1:55432/slotwell_test";
const originalPool = pg.Pool;
const originalEnv = process.env;
const pools: FakePool[] = [];
let fail = "";
let failHits = 0;
let envOptions: dotenv.DotenvConfigOptions | undefined;
let identity = {
  database: "slotwell_test",
  role: "slotwell_test",
  owner: "slotwell_test",
  comment: "slotwell-m1:test:slotwell_test",
};
let schema:
  | { name: string; oid: number; owner: string; nonce: string }
  | undefined;
const commands: string[] = [];

class FakeClient extends EventEmitter {
  released = false;
  destroyed = false;
  ended = false;
  async end() {
    this.ended = true;
    if (fail === "clientEnd") {
      failHits++;
      throw new Error("secret client close");
    }
  }
  async query(input: string | { text: string }, values: unknown[] = []) {
    const text = typeof input === "string" ? input : input.text;
    commands.push(text);
    if (fail && text.includes(fail)) {
      failHits++;
      throw new Error("secret driver SQL");
    }
    if (text.includes("current_database()")) return { rows: [identity] };
    if (text.startsWith("CREATE SCHEMA ") && !text.includes("IF NOT EXISTS")) {
      schema = {
        name: text.split('"')[1],
        oid: 42,
        owner: "slotwell_test",
        nonce: "",
      };
    }
    if (text.startsWith("COMMENT ON SCHEMA") && schema)
      schema.nonce = text.split("'")[1];
    if (text.includes("FROM pg_catalog.pg_namespace"))
      return { rows: schema ? [{ ...schema }] : [] };
    if (text.startsWith("DROP SCHEMA")) schema = undefined;
    void values;
    return { rows: [], rowCount: 0 };
  }
  release(destroy: boolean) {
    this.released = true;
    this.destroyed = destroy;
    if (fail === "release") {
      failHits++;
      throw new Error("secret release");
    }
  }
}
class FakePool {
  client = new FakeClient();
  ended = false;
  constructor() {
    pools.push(this);
  }
  on() {
    return this;
  }
  async connect() {
    if (fail === `connect${pools.indexOf(this)}`) {
      failHits++;
      throw new Error("secret connect");
    }
    return this.client;
  }
  async end() {
    this.ended = true;
    if (fail === "end") {
      failHits++;
      throw new Error("secret close");
    }
  }
}

beforeEach(() => {
  process.env = {
    NODE_ENV: "test",
    TEST_DATABASE_URL: url,
    DATABASE_URL: "unusable",
  };
  pools.length = 0;
  commands.length = 0;
  schema = undefined;
  fail = "";
  failHits = 0;
  identity = {
    database: "slotwell_test",
    role: "slotwell_test",
    owner: "slotwell_test",
    comment: "slotwell-m1:test:slotwell_test",
  };
  pg.Pool = FakePool as unknown as typeof pg.Pool;
  mock.method(dotenv, "config", (options: dotenv.DotenvConfigOptions) => {
    envOptions = options;
    return { parsed: {} };
  });
  mock.method(net.Socket.prototype, "connect", () => {
    throw new Error("Network forbidden");
  });
});
afterEach(() => {
  pg.Pool = originalPool;
  process.env = originalEnv;
  mock.restoreAll();
});

function closed() {
  assert.ok(pools.every((pool) => pool.ended));
  assert.ok(
    pools.every(
      (pool, index) =>
        fail === `connect${index}` ||
        (pool.client.released && pool.client.destroyed && pool.client.ended),
    ),
  );
}
function migrationSql(content: string) {
  const read = fs.readFileSync;
  mock.method(
    fs,
    "readFileSync",
    (path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (String(path).endsWith("migration.sql")) return Buffer.from(content);
      return Reflect.apply(read, fs, [path, ...args]);
    },
  );
}

test("import reads no environment file, opens no resources and performs no network I/O", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import net from 'node:net';
    import dotenv from 'dotenv';
    import pg from 'pg';
    dotenv.config = () => { throw new Error('Environment loading forbidden'); };
    pg.Pool = class { constructor() { throw new Error('Pool forbidden'); } };
    net.Socket.prototype.connect = () => { throw new Error('Network forbidden'); };
    const read = fs.readFileSync;
    fs.readFileSync = (path, ...args) => {
      assert.ok(!String(path).includes('.env'));
      return read(path, ...args);
    };
    const imported = await import('./src/db/testing.ts');
    assert.equal(typeof (imported.default ?? imported).withTestDatabase, 'function');
  `,
    ],
    { env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
});

test("loads only explicit root env quietly on invocation, before target validation", async () => {
  delete process.env.TEST_DATABASE_URL;
  await assert.rejects(
    withTestDatabase({}, async () => assert.fail()),
    { message: "Invalid database URL" },
  );
  assert.equal(pools.length, 0);
  assert.equal(
    envOptions?.path,
    new URL("../../.env.local", import.meta.url).pathname,
  );
  assert.equal(envOptions?.quiet, true);
  assert.equal(envOptions?.override, false);
  assert.equal(envOptions?.debug, false);
});

test("rejects unsafe and application URLs without creating resources or reading credential files", async () => {
  for (const value of [
    "",
    "bad",
    url
      .replace("slotwell_test:", "slotwell_app:")
      .replace("/slotwell_test", "/slotwell_dev"),
    url.replace("55432", "5432"),
    url.replace("127.0.0.1", "remote.example"),
    `${url}?options=-csearch_path=public`,
    `${url}#secret`,
  ]) {
    process.env.TEST_DATABASE_URL = value;
    await assert.rejects(withTestDatabase({}, async () => assert.fail()));
  }
  assert.equal(pools.length, 0);
});

test("rejects invalid clocks before opening resources", async () => {
  for (const now of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      withTestDatabase({ now }, async () => assert.fail()),
      { message: "Invalid test clock" },
    );
  }
  assert.equal(pools.length, 0);
});

for (const field of ["database", "role", "owner", "comment"] as const) {
  test(`refuses wrong database ${field} before mutation and closes all acquired resources`, async () => {
    identity[field] = "wrong";
    await assert.rejects(
      withTestDatabase({}, async () => assert.fail()),
      { message: "Test database setup failed" },
    );
    assert.ok(!commands.some((text) => text.startsWith("CREATE")));
    assert.equal(pools.length, 1);
    closed();
  });
}

test("holds two different clients, returns callback result and fixed clock, drops only fresh owned schema", async () => {
  let repeat!: () => Promise<void>;
  const result = await withTestDatabase(
    { now: 123 },
    async ({ db, independentDb, now, migrate }) => {
      assert.notEqual(db, independentDb);
      assert.equal(now, 123);
      assert.equal(pools.length, 2);
      assert.ok(pools.every((pool) => !pool.client.released));
      assert.match(schema?.name ?? "", /^slotwell_test_[a-f0-9]{32}$/);
      await migrate();
      repeat = migrate;
      return "result";
    },
  );
  assert.equal(result, "result");
  assert.equal(schema, undefined);
  assert.equal(
    commands.filter((text) => text.startsWith("DROP SCHEMA")).length,
    1,
  );
  assert.equal(
    commands.filter((text) => text.startsWith("ROLLBACK")).length,
    2,
  );
  await assert.rejects(repeat(), { message: "Test database is closed" });
  closed();
});

for (const stage of [
  "connect0",
  "connect1",
  "CREATE SCHEMA",
  "COMMENT ON SCHEMA",
  "COMMIT",
  "SET search_path",
  "CREATE TABLE",
]) {
  test(`setup failure at ${stage} closes every resource and never adopts a schema`, async () => {
    fail = stage;
    await assert.rejects(
      withTestDatabase({}, async () => assert.fail()),
      { message: "Test database setup failed" },
    );
    assert.ok(failHits > 0);
    assert.ok(pools.length > 0);
    closed();
    if (["CREATE SCHEMA", "COMMENT ON SCHEMA"].includes(stage))
      assert.ok(!commands.some((text) => text.startsWith("DROP SCHEMA")));
  });
}

test("preflights the whole migration set before executing any migration statement", async () => {
  migrationSql(
    'CREATE TABLE "ok" ("id" integer);--> statement-breakpoint CREATE TABLE public.escape (id integer);',
  );
  await assert.rejects(
    withTestDatabase({}, async () => assert.fail()),
    { message: "Test database setup failed" },
  );
  assert.equal(pools.length, 0);
  assert.ok(!commands.some((text) => text.includes('CREATE TABLE "ok"')));
});

// Source-shaped fixtures, NOT generated #81 artifacts. rc.5's PostgreSQL
// createForeignKeyConvertor$1 emits this separate statement (bin.cjs:90335).
const generatorFk =
  'ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_business_settings_id_fk" FOREIGN KEY ("business_id") REFERENCES "business_settings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;';
const minuteCheck =
  'CREATE TABLE "business_hours" ("opens_at" time(0) NOT NULL, "closes_at" time(0) NOT NULL, CONSTRAINT "opens_at_minute" CHECK (EXTRACT(SECOND FROM "opens_at") = 0), CONSTRAINT "closes_at_minute" CHECK (extract(second from "closes_at") = 0));';
const inlineFk =
  'CREATE TABLE "staff_services" ("staff_id" text NOT NULL, "service_id" text NOT NULL, FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE RESTRICT);';

for (const statement of [
  generatorFk,
  generatorFk
    .replaceAll('"business_id"', '"business_id","weekday"')
    .replace('("id")', '("id","weekday")'),
  inlineFk,
  'CREATE TABLE "hours" ("business_id" smallint REFERENCES "business_settings"("id") ON DELETE RESTRICT ON UPDATE RESTRICT);',
  minuteCheck,
  `${minuteCheck}--> statement-breakpoint ${generatorFk}`,
]) {
  test(`accepts bounded catalog fixture unchanged: ${statement}`, async () => {
    migrationSql(statement);
    let called = false;
    await withTestDatabase({}, async () => {
      called = true;
    });
    assert.equal(called, true);
    for (const part of statement.split("--> statement-breakpoint"))
      assert.ok(commands.some((command) => command.trim() === part.trim()));
    closed();
  });
}

for (const statement of [
  ...["CASCADE", "NO ACTION", "SET NULL", "SET DEFAULT"].flatMap((action) => [
    generatorFk.replace("DELETE RESTRICT", `DELETE ${action}`),
    generatorFk.replace("UPDATE RESTRICT", `UPDATE ${action}`),
    inlineFk.replace("DELETE RESTRICT", `DELETE ${action}`),
    inlineFk.replace("UPDATE RESTRICT", `UPDATE ${action}`),
  ]),
  generatorFk.replace('"business_hours"', '"public"."business_hours"'),
  generatorFk.replace('"business_settings"', '"public"."business_settings"'),
  generatorFk.replace('"business_id"', '"business_id"."other"'),
  generatorFk.replace('"business_hours"', "business_hours"),
  inlineFk.replace("RESTRICT);", "RESTRICT DEFERRABLE INITIALLY DEFERRED);"),
  inlineFk.replace('FOREIGN KEY ("staff_id")', "FOREIGN KEY (staff_id)"),
  inlineFk.replace("RESTRICT);", "RESTRICT NOT VALID);"),
  inlineFk.replace("RESTRICT);", "RESTRICT MATCH FULL);"),
  generatorFk.replace(" ON UPDATE RESTRICT", ""),
  generatorFk.replace(" ON DELETE RESTRICT", ""),
  generatorFk.replace(";", " DEFERRABLE;"),
  generatorFk.replace(";", " NOT VALID;"),
  generatorFk.replace(";", " MATCH FULL;"),
  generatorFk.replace(";", ', ADD COLUMN "escape" text;'),
  generatorFk.replace("FOREIGN KEY", "FOREIGN KEY /* hidden */"),
  generatorFk.replace('"business_id"', '"business\\id"'),
  generatorFk.replace('"business_id"', '"business""id"'),
  `${generatorFk} DELETE FROM "staff";`,
  `${generatorFk} UPDATE "staff" SET "name" = 'unsafe';`,
  `${generatorFk} ALTER TABLE "staff" DROP COLUMN "name";`,
  'ALTER TABLE "staff" ADD COLUMN "escape" text;',
  'ALTER TABLE "staff" DROP CONSTRAINT "fk";',
  'ALTER TABLE "staff" RENAME TO "escape";',
  'ALTER TABLE "staff" VALIDATE CONSTRAINT "fk";',
  'UPDATE "staff" SET "name" = \'unsafe\';',
  'DELETE FROM "staff";',
  minuteCheck.replace('SECOND FROM "opens_at"', "SECOND FROM public.opens_at"),
  minuteCheck.replace('SECOND FROM "opens_at"', "SECOND FROM evil()"),
  minuteCheck.replace("EXTRACT(", "pg_catalog.EXTRACT("),
  minuteCheck.replace("EXTRACT(", '"EXTRACT"('),
  minuteCheck.replace('SECOND FROM "opens_at"', 'EPOCH FROM "opens_at"'),
  minuteCheck.replace(
    'SECOND FROM "opens_at"',
    'SECOND /* hidden */ FROM "opens_at"',
  ),
  minuteCheck.replace(
    'SECOND FROM "opens_at"',
    'SECOND FROM "opens_at" + evil()',
  ),
  `${minuteCheck} DELETE FROM "staff";`,
  `${inlineFk} UPDATE "staff" SET "name" = 'unsafe';`,
  // A valid first statement must not execute if a later one is unsupported.
  `${generatorFk}--> statement-breakpoint ALTER TABLE "staff" DROP COLUMN "name";`,
  `${minuteCheck}--> statement-breakpoint ${generatorFk.replace("DELETE RESTRICT", "DELETE CASCADE")}`,
]) {
  test(`refuses unsupported catalog fixture before any resources: ${statement}`, async () => {
    migrationSql(statement);
    await assert.rejects(
      withTestDatabase({}, async () => assert.fail()),
      {
        message: "Test database setup failed",
      },
    );
    assert.equal(pools.length, 0);
    assert.deepEqual(commands, []);
  });
}

for (const statement of [
  'CREATE TABLE "public"."escape" (id integer);',
  'CREATE TABLE "escape" (id integer REFERENCES "public"."shared"(id));',
  'CREATE TABLE "escape" (id integer); SET search_path TO public;',
  'CREATE TABLE "escape" (id text DEFAULT evil());',
  'CREATE TABLE "escape" (id text DEFAULT "evil"());',
  'CREATE TABLE "escape" (id text DEFAULT $$escaping$$);',
  'CREATE TABLE "escape" (id integer) INHERITS (shared);',
  "DO $$ BEGIN END $$;",
  'CREATE TABLE "escape" (id integer); /* comment */',
]) {
  test(`refuses unsupported escaping migration form: ${statement}`, async () => {
    migrationSql(statement);
    await assert.rejects(
      withTestDatabase({}, async () => assert.fail()),
      { message: "Test database setup failed" },
    );
    assert.equal(pools.length, 0);
  });
}

for (const stage of [
  "",
  "ROLLBACK",
  "release",
  "clientEnd",
  "end",
  "DROP SCHEMA",
]) {
  test(`preserves callback failure object when cleanup fails at ${stage || "none"}`, async () => {
    const original = new Error("callback original");
    const diagnostics: string[] = [];
    mock.method(console, "error", (message: string) =>
      diagnostics.push(message),
    );
    await assert.rejects(
      withTestDatabase({}, async () => {
        fail = stage;
        throw original;
      }),
      (error) => error === original,
    );
    closed();
    if (stage) assert.ok(failHits > 0);
    assert.deepEqual(
      diagnostics,
      stage ? ["test_database_cleanup_failed"] : [],
    );
  });
}

test("held client error events are handled with fixed diagnostics rather than crashing or leaking driver details", async () => {
  const diagnostics: string[] = [];
  mock.method(console, "error", (message: string) => diagnostics.push(message));
  await assert.rejects(
    withTestDatabase({}, async () => {
      for (const pool of pools)
        pool.client.emit("error", new Error("secret driver error"));
    }),
    { message: "Test database cleanup failed" },
  );
  assert.deepEqual(diagnostics, [
    "test_database_client_error",
    "test_database_client_error",
  ]);
  closed();
});

test("synchronous rollback failures still attempt every rollback, release and pool close", async () => {
  const original = new Error("original");
  const diagnostics: string[] = [];
  mock.method(console, "error", (message: string) => diagnostics.push(message));
  let attempts = 0;
  await assert.rejects(
    withTestDatabase({}, async () => {
      for (const pool of pools)
        pool.client.query = () => {
          attempts++;
          throw new Error("secret rollback");
        };
      throw original;
    }),
    (error) => error === original,
  );
  assert.equal(attempts, 2);
  assert.deepEqual(diagnostics, ["test_database_cleanup_failed"]);
  closed();
});

for (const stage of [
  "ROLLBACK",
  "release",
  "clientEnd",
  "end",
  "DROP SCHEMA",
]) {
  test(`cleanup-only ${stage} failure rejects safely and closes all resources`, async () => {
    await assert.rejects(
      withTestDatabase({}, async () => {
        fail = stage;
      }),
      { message: "Test database cleanup failed" },
    );
    closed();
  });
}

for (const field of ["name", "oid", "owner", "nonce"] as const) {
  test(`refuses cleanup after retained schema ${field} changes`, async () => {
    await assert.rejects(
      withTestDatabase({}, async () => {
        assert.ok(schema);
        Object.assign(schema, { [field]: field === "oid" ? 99 : "tampered" });
      }),
      { message: "Test database cleanup failed" },
    );
    assert.ok(!commands.some((text) => text.startsWith("DROP SCHEMA")));
    closed();
  });
}

test("revalidates database identity at cleanup and reports fixed diagnostic only", async () => {
  await assert.rejects(
    withTestDatabase({}, async () => {
      identity.comment = "changed";
    }),
    { message: "Test database cleanup failed" },
  );
  assert.ok(!commands.some((text) => text.startsWith("DROP SCHEMA")));
  closed();
});
