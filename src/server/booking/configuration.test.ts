import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { readBookingKeys } from "@/server/booking/configuration";

const key = (byte: number) => Buffer.alloc(32, byte).toString("hex");
const rings = () => ({
  fingerprint: { currentId: "h2", keys: { h1: key(1), h2: key(2) } },
  replay: { currentId: "e2", keys: { e1: key(3), e2: key(4) } },
});
const environment = (
  origin = "http://localhost:3000",
  keys: unknown = rings(),
) => ({
  SLOTWELL_BOOKING_ORIGIN: origin,
  SLOTWELL_BOOKING_KEYS: JSON.stringify(keys),
});
function refuses(env: Record<string, string | undefined>) {
  assert.throws(
    () => readBookingKeys(env),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "booking_configuration_unavailable");
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error), []);
      return true;
    },
  );
}

test("reads owned durable key rings that survive mutation of a returned copy", () => {
  const config = readBookingKeys(environment());
  assert.equal(config.fingerprint.currentId, "h2");
  assert.deepEqual(config.fingerprint.keys.h1, Buffer.alloc(32, 1));
  assert.deepEqual(config.replay.keys.e2, Buffer.alloc(32, 4));
  const env = environment();
  const first = readBookingKeys(env);
  first.replay.keys.e2.fill(0);
  assert.deepEqual(readBookingKeys(env).replay.keys.e2, Buffer.alloc(32, 4));
});

test("refuses malformed, missing, oversized and nonobject key configuration without disclosure", () => {
  for (const value of [
    undefined,
    "",
    "private-not-json",
    "x".repeat(16_385),
    "é".repeat(8193),
    "null",
    "[]",
    "42",
  ]) {
    refuses({ ...environment(), SLOTWELL_BOOKING_KEYS: value });
  }
  for (const value of [
    {},
    [],
    null,
    { ...rings(), extra: "private" },
    { ...rings(), replay: null },
  ])
    refuses(environment(undefined, value));
});

test("requires bounded exact rings, own current IDs and strict independent 32-byte hex keys", () => {
  const badRings: unknown[] = [
    { currentId: "h1", keys: {} },
    { currentId: "missing", keys: { h1: key(1) } },
    { currentId: "toString", keys: { h1: key(1) } },
    { currentId: 1, keys: { h1: key(1) } },
    { currentId: "h1", keys: [] },
    { currentId: "h1", keys: { h1: key(1) }, extra: "private" },
    ...["", "x".repeat(65), "bad.id"].map((id) => ({
      currentId: id,
      keys: { [id]: key(1) },
    })),
    ...[
      null,
      1,
      [],
      {},
      key(1).slice(2),
      `${key(1)}00`,
      "AB".repeat(32),
      "zz".repeat(32),
    ].map((value) => ({ currentId: "h1", keys: { h1: value } })),
    {
      currentId: "h0",
      keys: Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => [`h${i}`, key(1)]),
      ),
    },
  ];
  for (const ring of badRings) {
    refuses(environment(undefined, { ...rings(), fingerprint: ring }));
    refuses(environment(undefined, { ...rings(), replay: ring }));
  }
  const reused = rings();
  reused.replay.keys.e1 = reused.fingerprint.keys.h1;
  refuses(environment(undefined, reused));
});

test("supports 16 retained keys and prototype-named IDs without inherited-key access", () => {
  const configured = rings();
  const encoded = Object.fromEntries([
    ...Array.from({ length: 13 }, (_, i) => [`h${i}`, key(1)]),
    ...["__proto__", "constructor", "toString"].map((id) => [id, key(1)]),
  ]);
  const config = readBookingKeys(
    environment(undefined, {
      ...configured,
      fingerprint: { currentId: "__proto__", keys: encoded },
    }),
  );
  assert.equal(Object.keys(config.fingerprint.keys).length, 16);
  assert.equal(Object.getPrototypeOf(config.fingerprint.keys), null);
  assert.deepEqual(config.fingerprint.keys.__proto__, Buffer.alloc(32, 1));
  assert.deepEqual(config.fingerprint.keys.constructor, Buffer.alloc(32, 1));
});

test("uses JSON.parse last-member-wins semantics in the single-parser trusted environment", () => {
  const env = environment();
  env.SLOTWELL_BOOKING_KEYS = env.SLOTWELL_BOOKING_KEYS.replace(
    '"currentId":"h2"',
    '"currentId":"missing","currentId":"h2"',
  );
  assert.equal(readBookingKeys(env).fingerprint.currentId, "h2");
});

test("import is independent of booking/database environment and opens no database", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "-e",
      `
    process.env = new Proxy(process.env, {
      get(target, name) {
        if (/^(SLOTWELL_BOOKING_|(?:TEST_)?DATABASE_URL$)/.test(String(name)))
          throw new Error("unexpected environment access");
        return target[name];
      }
    });
    require("./src/server/booking/configuration.ts");
  `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
