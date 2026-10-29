import assert from "node:assert/strict";
import test from "node:test";

import { createIntentAssociation } from "@/app/_lib/booking/intent-association";

const first = "abcdefab-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const unavailable = (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.equal(error.message, "intent_association_unavailable");
  assert.equal(error.cause, undefined);
  assert.deepEqual(Object.keys(error), []);
  return true;
};
function fixture() {
  const values = new Map<string, string>();
  let key = "";
  let accesses = 0;
  const storage = {
    getItem(name: string) {
      key = name;
      return values.get(name) ?? null;
    },
    setItem(name: string, value: string) {
      key = name;
      values.set(name, value);
    },
    removeItem(name: string) {
      key = name;
      values.delete(name);
    },
  };
  const association = createIntentAssociation(() => {
    accesses++;
    return storage;
  });
  return {
    association,
    values,
    storage,
    key: () => key,
    accesses: () => accesses,
  };
}

test("construction is lazy and missing association reads as null", () => {
  const f = fixture();
  assert.equal(f.accesses(), 0);
  assert.equal(f.association.read(), null);
  assert.equal(f.accesses(), 1);
  assert.equal(f.values.size, 0);
});

test("writes only raw locator strings and preserves unrelated session entries", () => {
  const f = fixture();
  f.values.set("unrelated", "untouched");
  f.association.write(first, null);
  assert.equal(f.association.read(), first);
  assert.equal(f.values.get(f.key()), first);
  assert.equal(f.values.size, 2);
  f.association.write(first, first);
  f.association.write(second, first);
  assert.equal(f.association.read(), second);
  f.association.remove(second);
  assert.equal(f.association.read(), null);
  assert.equal(f.values.size, 1);
  assert.equal(f.values.get("unrelated"), "untouched");
  f.association.remove(second);
  assert.equal(f.values.size, 1, "absent removal is idempotent");
});

test("stale expected values cannot overwrite or remove the current locator", () => {
  const f = fixture();
  f.association.write(first, null);
  for (const command of [
    () => f.association.write(second, null),
    () => f.association.write(second, second),
    () => f.association.write(first, null),
    () => f.association.remove(second),
  ]) {
    assert.throws(command, unavailable);
    assert.equal(f.association.read(), first);
  }
});

test("malformed existing values fail closed without repair", () => {
  const f = fixture();
  f.association.read();
  for (const malformed of [
    "",
    " ",
    "null",
    "{}",
    first.toUpperCase(),
    `${first} `,
    "f".repeat(64),
  ]) {
    f.values.set(f.key(), malformed);
    for (const command of [
      () => f.association.read(),
      () => f.association.write(second, null),
      () => f.association.remove(first),
    ]) {
      assert.throws(command, unavailable);
      assert.equal(f.values.get(f.key()), malformed);
    }
  }
  f.values.set(f.key(), "ABCDEFAB-1111-4111-8111-111111111111");
  assert.throws(() => f.association.read(), unavailable);
});

test("runtime nonprimitive or malformed inputs are refused before storage access", () => {
  const f = fixture();
  const bad: unknown[] = [
    undefined,
    null,
    1,
    {},
    [],
    new String(first),
    "",
    `${first}\n`,
    "ABCDEFAB-1111-4111-8111-111111111111",
  ];
  for (const value of bad) {
    assert.throws(
      () => f.association.write(value as string, null),
      unavailable,
    );
    assert.throws(() => f.association.remove(value as string), unavailable);
    if (value !== null)
      assert.throws(
        () => f.association.write(first, value as string),
        unavailable,
      );
  }
  assert.equal(f.accesses(), 0);
  assert.equal(f.values.size, 0);
});

test("all storage access failures are redacted and never trigger fallback or repair", () => {
  const secretError = new Error("private storage failure");
  const getterFailure = createIntentAssociation(() => {
    throw secretError;
  });
  for (const command of [
    () => getterFailure.read(),
    () => getterFailure.write(first, null),
    () => getterFailure.remove(first),
  ])
    assert.throws(command, unavailable);
  for (const method of ["getItem", "setItem", "removeItem"] as const) {
    const f = fixture();
    if (method === "removeItem") f.association.write(first, null);
    f.storage[method] = () => {
      throw secretError;
    };
    const command =
      method === "getItem"
        ? () => f.association.read()
        : method === "setItem"
          ? () => f.association.write(first, null)
          : () => f.association.remove(first);
    assert.throws(command, unavailable);
    assert.equal(f.values.size, method === "removeItem" ? 1 : 0);
  }
});

test("the default browser getter is safe to construct outside a browser and fails closed on use", () => {
  const association = createIntentAssociation();
  assert.throws(() => association.read(), unavailable);
  assert.throws(() => association.write(first, null), unavailable);
  assert.throws(() => association.remove(first), unavailable);
});
