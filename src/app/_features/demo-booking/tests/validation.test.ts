import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContactDraft } from "@/app/_features/demo-booking/context";
import { validateContact } from "@/app/_features/demo-booking/validation";

const valid: ContactDraft = {
  name: "Демо Посетител",
  phone: "0888 123 456",
  email: "demo@example.com",
  note: "",
};

test("requires trimmed name, phone and email with Bulgarian errors", () => {
  const errors = validateContact({
    name: "  ",
    phone: "\t",
    email: "",
    note: "",
  });
  assert.deepEqual(errors, {
    name: "Въведете име.",
    phone: "Въведете телефонен номер.",
    email: "Въведете имейл адрес.",
  });
});

test("checks trimmed required values without modifying the original draft", () => {
  const draft = {
    ...valid,
    name: "  Демо  ",
    phone: " 0888 123 456 ",
    email: " demo@example.com ",
  };
  const original = { ...draft };
  assert.deepEqual(validateContact(draft), {});
  assert.deepEqual(draft, original);
});

for (const phone of [
  "0888123456",
  "888123456",
  "02 123 4567",
  "+359 888 123 456",
  "00359 (888) 123-456",
  "+44 20 7946 0958",
  "0049 30 123456",
]) {
  test(`accepts plausible domestic or international phone: ${phone}`, () => {
    assert.equal(validateContact({ ...valid, phone }).phone, undefined);
  });
}

for (const phone of [
  "123",
  "0000000000",
  "+0123456789",
  "0888callme",
  "++359888123456",
  "+1234567890123456",
]) {
  test(`rejects implausible phone: ${phone}`, () => {
    assert.equal(
      validateContact({ ...valid, phone }).phone,
      "Въведете валиден телефонен номер за избраната държава или с международен код (+ или 00), без вътрешен номер.",
    );
  });
}

for (const email of [
  "demo",
  "demo@",
  "@example.com",
  "demo@example",
  "demo name@example.com",
  "demo@@example.com",
]) {
  test(`rejects malformed email: ${email}`, () => {
    assert.equal(
      validateContact({ ...valid, email }).email,
      "Въведи валиден имейл, например ivan@example.com.",
    );
  });
}

test("uses the selected country without mutating the draft or requiring it for international input", () => {
  const draft = { ...valid, phone: "020 7946 0958", phoneCountry: "GB" };
  assert.deepEqual(validateContact(draft), {});
  assert.deepEqual(validateContact({ ...draft, phone: "+359888123456" }), {});
  assert.ok(validateContact({ ...draft, phoneCountry: "BG" }).phone);
  assert.ok(validateContact({ ...draft, phoneCountry: "XX" }).phoneCountry);
  assert.equal(draft.phone, "020 7946 0958");
});

test("accepts plus-addressed email and names without a restrictive alphabet", () => {
  assert.deepEqual(
    validateContact({
      ...valid,
      name: "O’Neil-Демо",
      email: "demo+salon@example.com",
    }),
    {},
  );
});

for (const [field, limit, boundary] of [
  ["name", 100, "Д".repeat(100)],
  ["phone", 32, `+359${" ".repeat(19)}888123456`],
  [
    "email",
    254,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  ],
  ["note", 1000, "н".repeat(1000)],
] as const) {
  test(`enforces ${field} limit ${limit} without truncating`, () => {
    assert.equal(boundary.length, limit);
    assert.equal(
      validateContact({ ...valid, [field]: boundary })[field],
      undefined,
    );
    const draft = { ...valid, [field]: `${boundary}x` };
    assert.match(validateContact(draft)[field] ?? "", new RegExp(`${limit}`));
    assert.equal(draft[field].length, limit + 1);
  });
}
