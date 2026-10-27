import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGuestContact } from "@/lib/guest-contact";

const valid = {
  name: "Демо",
  phone: "0888 123 456",
  email: "demo+booking@example.com",
  note: "",
};

test("trims required contacts, preserves notes and submitted phone, without mutating input", () => {
  const draft = {
    ...valid,
    name: "  李 O’Neil-Демо  ",
    phone: " 0888 123 456 ",
    email: " Demo@example.com ",
    note: "  бележка\n ",
  };
  const original = { ...draft };
  assert.deepEqual(parseGuestContact(draft), {
    success: true,
    contact: {
      name: "李 O’Neil-Демо",
      phone: "0888 123 456",
      normalizedPhone: "+359888123456",
      email: "Demo@example.com",
      note: draft.note,
    },
  });
  assert.deepEqual(draft, original);
});

for (const [phone, phoneCountry, normalizedPhone] of [
  ["0888123456", undefined, "+359888123456"],
  ["888123456", undefined, "+359888123456"],
  ["02 123 4567", "BG", "+35921234567"],
  ["020 7946 0958", "GB", "+442079460958"],
  ["+44 20 7946 0958", "BG", "+442079460958"],
  ["0049 (30) 123456", "BG", "+4930123456"],
  ["+359 888 123 456", "GB", "+359888123456"],
  ["00359 888 123 456", "GB", "+359888123456"],
  ["+800 1234 5678", "BG", "+80012345678"],
] as const) {
  test(`normalizes ${phone} with country ${phoneCountry ?? "default"}`, () => {
    const result = parseGuestContact({ ...valid, phone, phoneCountry });
    assert.equal(result.success, true);
    if (result.success)
      assert.equal(result.contact.normalizedPhone, normalizedPhone);
  });
}

test("omitted notes default to empty without requiring multipart names", () => {
  const result = parseGuestContact({
    name: "Иван",
    phone: valid.phone,
    email: valid.email,
  });
  assert.equal(result.success, true);
  if (result.success) assert.equal(result.contact.note, "");
});

for (const input of [
  null,
  undefined,
  [],
  42,
  "contact",
  {},
  { name: false, phone: 359888123456, email: [] },
]) {
  test(`rejects malformed contact shape ${JSON.stringify(input)}`, () => {
    assert.deepEqual(parseGuestContact(input), {
      success: false,
      errors: {
        name: "Въведете име.",
        phone: "Въведете телефонен номер.",
        email: "Въведете имейл адрес.",
      },
    });
  });
}

for (const note of [null, 12, {}, []]) {
  test(`rejects non-string supplied note ${JSON.stringify(note)}`, () => {
    assert.deepEqual(parseGuestContact({ ...valid, note }), {
      success: false,
      errors: { note: "Въведете бележка като текст." },
    });
  });
}

for (const phoneCountry of ["", "bg", "XX", "USA", "__proto__", "constructor", null, 12, [], {}]) {
  test(`rejects unsupported country ${JSON.stringify(phoneCountry)} without silent fallback`, () => {
    const result = parseGuestContact({ ...valid, phoneCountry });
    assert.deepEqual(result, {
      success: false,
      errors: { phoneCountry: "Изберете валидна държава за телефона." },
    });
  });
}

for (const email of [
  "demo",
  "demo@",
  "@example.com",
  "demo@example",
  "demo name@example.com",
  "demo@@example.com",
  ".demo@example.com",
  "demo..name@example.com",
  "demo@example..com",
  "demo@-example.com",
  "demo@example.com.",
]) {
  test(`rejects malformed email ${email}`, () => {
    const result = parseGuestContact({ ...valid, email });
    assert.deepEqual(result, {
      success: false,
      errors: { email: "Въведи валиден имейл, например ivan@example.com." },
    });
  });
}

test("uses the configured default country when no country was submitted", () => {
  const result = parseGuestContact({ ...valid, phone: "020 7946 0958" }, "GB");
  assert.equal(result.success, true);
  if (result.success)
    assert.equal(result.contact.normalizedPhone, "+442079460958");
});

for (const phone of [
  "123",
  "0000000000",
  "+0123456789",
  "++359888123456",
  "Call +359888123456",
  "0888callme",
  "+359888123456 ext 1",
  "+359888123456;ext=1",
  "+359888123456#1",
  "+1234567890123456",
]) {
  test(`rejects invalid or partial input ${phone}`, () => {
    const result = parseGuestContact({ ...valid, phone });
    assert.equal(result.success, false);
    if (!result.success)
      assert.match(result.errors.phone ?? "", /валиден телефонен номер/);
    assert.equal(JSON.stringify(result).includes(phone), false);
  });
}

for (const [field, limit, boundary] of [
  ["name", 100, "😀".repeat(50)],
  ["phone", 32, `+359${" ".repeat(19)}888123456`],
  [
    "email",
    254,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  ],
  ["note", 1000, " н".repeat(500)],
] as const) {
  test(`accepts exactly ${limit} UTF-16 units and rejects one beyond for ${field}`, () => {
    assert.equal(boundary.length, limit);
    assert.equal(
      parseGuestContact({ ...valid, [field]: boundary }).success,
      true,
    );
    const draft = { ...valid, [field]: `${boundary}x` };
    const result = parseGuestContact(draft);
    assert.equal(result.success, false);
    if (!result.success)
      assert.match(result.errors[field] ?? "", new RegExp(`${limit}`));
    assert.equal(draft[field].length, limit + 1);
  });
}
