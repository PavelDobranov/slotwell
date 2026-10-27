import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import pg from "pg";

import { openPostgresDatabase, validateDatabaseUrl } from "@/db/open";

const appUrl =
  "postgresql://slotwell_app:fictional-secret@127.0.0.1:55432/slotwell_dev";
const testUrl =
  "postgres://slotwell_test:fictional-secret@127.0.0.1:55432/slotwell_test";

const invalidUrls = [
  undefined,
  "",
  " ",
  "local.db",
  "file:local.db",
  "sqlite://local.db",
  "host=127.0.0.1 port=55432 user=slotwell_app password=fictional-secret dbname=slotwell_dev",
  "postgresql:///slotwell_dev",
  "postgresql://127.0.0.1:55432/slotwell_dev",
  appUrl.replace("slotwell_app:", ":"),
  appUrl.replace(":fictional-secret", ""),
  appUrl.replace("fictional-secret", ""),
  appUrl.replace("127.0.0.1", ""),
  appUrl.replace(":55432", ""),
  appUrl.replace("/slotwell_dev", ""),
  appUrl.replace("/slotwell_dev", "/"),
  appUrl.replace("slotwell_app", "slotwell_admin"),
  appUrl.replace("slotwell_app", "postgres"),
  appUrl.replace("slotwell_app", "slotwell_test"),
  testUrl.replace("/slotwell_test", "/slotwell_dev"),
  appUrl.replace("/slotwell_dev", "/postgres"),
  appUrl.replace("/slotwell_dev", "/arbitrary"),
  appUrl.replace("127.0.0.1", "localhost"),
  appUrl.replace("127.0.0.1", "remote.example"),
  appUrl.replace("127.0.0.1", "[::1]"),
  appUrl.replace("55432", "5432"),
  appUrl.replace("postgresql:", "https:"),
  ` ${appUrl}`,
  `${appUrl}\n`,
  appUrl.replace("fictional-secret", "fictional\nsecret"),
  appUrl.replace("fictional-secret", "%zz"),
  appUrl.replace("fictional-secret", "%FF"),
  appUrl.replace("fictional-secret", "%00"),
  appUrl.replace("fictional-secret", "%0a"),
  `${appUrl}?`,
  `${appUrl}?host=remote.example`,
  `${appUrl}?user=slotwell_admin`,
  `${appUrl}?password=override`,
  `${appUrl}?port=5432`,
  `${appUrl}?dbname=postgres`,
  `${appUrl}?options=-csearch_path%3Dpublic`,
  `${appUrl}?sslcert=/fictional-secret`,
  `${appUrl}#`,
  `${appUrl}#fictional-secret`,
];

test("cold import and construction need no environment, credential loader or network", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
        import assert from 'node:assert/strict';
        import net from 'node:net';
        import pg from 'pg';
        net.Socket.prototype.connect = () => { throw new Error('Network forbidden'); };
        let pools = 0;
        const Pool = pg.Pool;
        pg.Pool = class extends Pool {
          constructor(options) { super(options); pools++; }
        };
        const module = await import('./src/db/open.ts');
        const factory = module.default ?? module;
        assert.equal(pools, 0);
        assert.equal(process.env.DATABASE_URL, undefined);
        assert.equal(process.env.TEST_DATABASE_URL, undefined);
        assert.equal(process.env.DB_FILE_NAME, undefined);
        const handle = factory.openPostgresDatabase(${JSON.stringify(appUrl)});
        assert.equal(pools, 1);
        assert.equal(handle.pool.totalCount, 0);
        await handle.close();
        assert.equal(process.env.DATABASE_URL, undefined);
      `,
    ],
    { env: { NODE_ENV: "test" }, encoding: "utf8", timeout: 10000 },
  );
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
});

test("factory rejects invalid URLs before constructing a pool", (t) => {
  const construct = t.mock.method(pg, "Pool", () => {
    assert.fail("Pool must not be constructed for an invalid URL");
  });
  for (const url of invalidUrls) {
    assert.throws(() => openPostgresDatabase(url as string), {
      message: "Invalid database URL",
    });
  }
  assert.equal(construct.mock.callCount(), 0);
});

test("each handle owns a separate lazy pool with bounded timeouts and real idempotent shutdown", async () => {
  const first = openPostgresDatabase(appUrl);
  const second = openPostgresDatabase(testUrl);
  try {
    assert.notEqual(first.pool, second.pool);
    assert.notEqual(first.db, second.db);
    assert.equal(first.db.$client, first.pool);
    assert.equal(second.db.$client, second.pool);
    for (const { pool } of [first, second]) {
      assert.ok(pool instanceof pg.Pool);
      assert.equal(pool.options.max, 5);
      assert.equal(pool.options.connectionTimeoutMillis, 5000);
      assert.equal(pool.options.idleTimeoutMillis, 10000);
      assert.equal(pool.totalCount, 0);
      assert.equal(pool.waitingCount, 0);
    }
    const closing = first.close();
    assert.equal(first.close(), closing);
    await closing;
    assert.equal(first.pool.ended, true);
    assert.equal(second.pool.ended, false);
    assert.equal(first.close(), closing);
    await first.close();
    await assert.rejects(first.pool.connect(), /after calling end/);
    assert.equal(second.pool.totalCount, 0);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test("close awaits pool shutdown and caches its pending promise", async (t) => {
  const handle = openPostgresDatabase(appUrl);
  let finish: () => void = () => assert.fail("Shutdown did not start");
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const end = t.mock.method(handle.pool, "end", () => pending);
  let settled = false;
  const closing = handle.close();
  void closing.then(() => {
    settled = true;
  });
  assert.equal(handle.close(), closing);
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(end.mock.callCount(), 1);
  finish();
  await closing;
  assert.equal(settled, true);
  assert.equal(handle.close(), closing);
  assert.equal(end.mock.callCount(), 1);
  end.mock.restore();
  await handle.pool.end();
});

for (const synchronous of [false, true]) {
  test(`close caches a redacted ${synchronous ? "synchronous" : "asynchronous"} shutdown failure`, async (t) => {
    const handle = openPostgresDatabase(appUrl);
    const raw = new Error(`fictional-secret ${appUrl} SELECT private_value`);
    const end = t.mock.method(handle.pool, "end", () => {
      if (synchronous) throw raw;
      return Promise.reject(raw);
    });
    const closing = handle.close();
    assert.equal(handle.close(), closing);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(handle.close(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Database shutdown failed");
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(
          String(error.stack),
          /fictional-secret|SELECT|postgresql:/,
        );
        return true;
      });
    }
    assert.equal(end.mock.callCount(), 1);
    assert.equal(handle.close(), closing);
    end.mock.restore();
    await handle.pool.end();
  });
}

test("idle errors emit only a fixed diagnostic, never raw errors or connection config", async (t) => {
  const handle = openPostgresDatabase(appUrl);
  const diagnostics = t.mock.method(console, "error", () => {});
  try {
    const error = Object.assign(new Error(`fictional-secret ${appUrl}`), {
      cause: new Error("SELECT private_value"),
    });
    assert.equal(handle.pool.emit("error", error), true);
    assert.equal(diagnostics.mock.callCount(), 1);
    assert.deepEqual(diagnostics.mock.calls[0].arguments, [
      "database_pool_idle_error",
    ]);
  } finally {
    await handle.close();
  }
});

test("Drizzle does not log queries or include parameters in its message; internal SQL/cause remain private", async (t) => {
  const handle = openPostgresDatabase(appUrl);
  const raw = Object.assign(new Error("fictional-driver-secret"), {
    code: "40001",
  });
  t.mock.method(handle.pool, "query", async () => {
    throw raw;
  });
  const log = t.mock.method(console, "log", () => {});
  const errorLog = t.mock.method(console, "error", () => {});
  try {
    await assert.rejects(
      handle.db.execute(
        sql`select ${"fictional-param-secret"} as fictional_sql_sentinel`,
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /fictional_sql_sentinel/);
        assert.doesNotMatch(error.message, /fictional-param-secret/);
        assert.equal(error.cause, raw);
        assert.equal(raw.code, "40001");
        return true;
      },
    );
    assert.equal(log.mock.callCount(), 0);
    assert.equal(errorLog.mock.callCount(), 0);
  } finally {
    await handle.close();
  }
});

test("URL validation returns explicit matching local role/database URLs unchanged", () => {
  for (const url of [
    appUrl,
    testUrl,
    appUrl.replace("fictional-secret", "encoded%40p%3Ass%2F%25word"),
  ]) {
    assert.equal(validateDatabaseUrl(url), url);
  }
});

test("URL validation rejects implicit defaults, non-Postgres, admin, wrong targets and overrides with one redacted error", () => {
  for (const url of invalidUrls) {
    assert.throws(
      () => validateDatabaseUrl(url),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Invalid database URL");
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(
          String(error.stack),
          /fictional-secret|remote\.example/,
        );
        return true;
      },
    );
  }
});
