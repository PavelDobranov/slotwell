import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { readBookingTransport } from "@/server/http/booking-configuration";

function refuses(env: Record<string, string | undefined>) {
  assert.throws(
    () => readBookingTransport(env),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "booking_configuration_unavailable");
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error), []);
      return true;
    },
  );
}

test("reads explicitly configured loopback and HTTPS origins with the derived cookie policy", () => {
  for (const origin of [
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://[::1]:3000",
    "https://booking.example",
    "https://booking.example:8443",
  ]) {
    const transport = readBookingTransport({ SLOTWELL_BOOKING_ORIGIN: origin });
    assert.equal(transport.origin, origin);
    assert.equal(transport.secureCookies, origin.startsWith("https:"));
  }
});

test("refuses missing and noncanonical origins and non-loopback plaintext HTTP", () => {
  for (const origin of [
    "",
    "http://example.com",
    "http://localhost.evil",
    "http://127.0.0.2",
    "http://2130706433",
    "http://127.1",
    "http://localhost/",
    "http://localhost/path",
    "https://booking.example?secret=private",
    "https://booking.example#private",
    "https://booking.example?",
    "https://booking.example#",
    "https://BOOKING.EXAMPLE",
    "https://guest:private@booking.example",
    "HTTPS://booking.example",
    "https://booking.example:443",
    " https://booking.example",
    "ftp://localhost",
    "null",
  ])
    refuses({ SLOTWELL_BOOKING_ORIGIN: origin });
  refuses({});
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
    require("./src/server/http/booking-configuration.ts");
  `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
