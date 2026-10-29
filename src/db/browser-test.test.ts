import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { openBrowserTestDatabase } from "@/db/browser-test";

const url =
  "postgres://slotwell_test:fictional-secret@127.0.0.1:55432/slotwell_test";
const schema = {
  name: `slotwell_test_${"a".repeat(32)}`,
  oid: 123,
  owner: "slotwell_test",
  nonce: `slotwell-test:${"b".repeat(64)}`,
};
const env = {
  SLOTWELL_BROWSER_TEST: "private-schema-v1",
  SLOTWELL_BROWSER_SCHEMA: JSON.stringify(schema),
  DATABASE_URL: url,
};

test("browser attachment rejects partial, malformed and non-test selection before pool construction", () => {
  for (const invalid of [
    {},
    { ...env, SLOTWELL_BROWSER_TEST: undefined },
    { ...env, SLOTWELL_BROWSER_TEST: "" },
    { ...env, SLOTWELL_BROWSER_TEST: "true" },
    { ...env, SLOTWELL_BROWSER_SCHEMA: undefined },
    { ...env, SLOTWELL_BROWSER_SCHEMA: "null" },
    { ...env, SLOTWELL_BROWSER_SCHEMA: "{" },
    { ...env, DATABASE_URL: undefined },
    { ...env, DATABASE_URL: url.replace("slotwell_test", "slotwell_app") },
    { ...env, DATABASE_URL: `${url}?options=bad` },
    ...[
      { ...schema, name: "public" },
      { ...schema, name: `${schema.name}; DROP SCHEMA public` },
      { ...schema, oid: 0 },
      { ...schema, oid: "123" },
      { ...schema, oid: 1.5 },
      { ...schema, owner: "slotwell_app" },
      { ...schema, nonce: "" },
      { ...schema, nonce: `${schema.nonce}'` },
      { ...schema, extra: true },
    ].map((value) => ({
      ...env,
      SLOTWELL_BROWSER_SCHEMA: JSON.stringify(value),
    })),
  ]) {
    assert.throws(
      () => openBrowserTestDatabase(invalid),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          "Browser test database configuration refused",
        );
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("browser pool construction is lazy and closure is idempotent", async () => {
  const handle = openBrowserTestDatabase(env);
  assert.equal(handle.pool.totalCount, 0);
  const closing = handle.close();
  assert.equal(handle.close(), closing);
  await closing;
  assert.equal(handle.pool.ended, true);
});

test("application entry refuses stray browser descriptors rather than falling back to developer data", () => {
  const child = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import assert from 'node:assert/strict';
     import { getDatabase } from './src/db/index.ts';
     assert.throws(() => getDatabase(), { message: 'Browser test database configuration refused' });`,
    ],
    {
      env: {
        NODE_ENV: "test",
        SLOTWELL_BROWSER_SCHEMA: JSON.stringify(schema),
        DATABASE_URL:
          "postgres://slotwell_app:fictional-secret@127.0.0.1:55432/slotwell_dev",
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "");
});
