import assert from "node:assert/strict";
import test from "node:test";

import {
  type BookingAgreement,
  BookingApiError,
  requestBookingIntentFence,
  resolveRetainedBookingIntent,
  submitBookingIntent,
} from "@/app/_features/booking/submission/submission-api";

// Synthetic only; assertions never print request/receipt material.
const pair = {
  operationId: "11111111-1111-4111-8111-111111111111",
  credential: "ab".repeat(32),
};
const receipt = {
  appointmentId: "22222222-2222-4222-8222-222222222222",
  confirmationExpiresAt: "2026-11-01T12:00:00.000Z",
  viewToken: "cd".repeat(32),
};
function agreement(): BookingAgreement {
  return {
    staffId: "mimi",
    serviceIds: ["color", "cut"],
    startsAt: "2026-10-25T12:00:00+02:00",
    reviewedServices: [
      {
        id: "color",
        name: "Цвят",
        priceCents: null,
        currency: "USD",
        durationMinutes: 60,
        cleanupMinutes: 0,
      },
      {
        id: "cut",
        name: "Коса",
        priceCents: 2800,
        currency: "EUR",
        durationMinutes: 45,
        cleanupMinutes: 10,
      },
    ],
    contact: {
      name: " Аня ",
      phone: "+1 202 555 0100",
      email: "A@example.test",
      note: "  note\n",
      phoneCountry: "US",
    },
  };
}
const calls = [
  {
    path: "/api/bookings",
    call: (signal?: AbortSignal) =>
      submitBookingIntent(pair, agreement(), signal),
    body: () => ({ ...pair, booking: agreement() }),
    success: receipt,
  },
  {
    path: "/api/booking-intents/resolve",
    call: (signal?: AbortSignal) => resolveRetainedBookingIntent(pair, signal),
    body: () => pair,
    success: { state: "pending", submitBefore: "2026-10-25T12:00:00.000Z" },
  },
  {
    path: "/api/booking-intents/clear",
    call: (signal?: AbortSignal) => requestBookingIntentFence(pair, signal),
    body: () => pair,
    success: { state: "fenced" },
  },
];
for (const endpoint of calls) {
  test(`${endpoint.path} sends one private same-origin POST with an unchanged pair on manual retry`, async (t) => {
    let count = 0;
    const controller = new AbortController();
    t.mock.method(
      globalThis,
      "fetch",
      async (path: string, init: RequestInit) => {
        count++;
        assert.equal(path, endpoint.path);
        assert.equal(init.method, "POST");
        assert.equal(init.credentials, "omit");
        assert.equal(init.cache, "no-store");
        assert.equal(init.mode, "same-origin");
        assert.equal(init.redirect, "error");
        assert.equal(init.referrerPolicy, "no-referrer");
        assert.equal(init.signal, controller.signal);
        assert.deepEqual(init.headers, {
          accept: "application/json",
          "content-type": "application/json",
        });
        assert.ok(
          JSON.stringify(JSON.parse(String(init.body))) ===
            JSON.stringify(endpoint.body()),
          "exact allowlisted request",
        );
        return Response.json(endpoint.success);
      },
    );
    for (let i = 0; i < 2; i++)
      assert.ok(
        JSON.stringify(await endpoint.call(controller.signal)) ===
          JSON.stringify(endpoint.success),
        "validated success",
      );
    assert.equal(count, 2);
  });
}

test("resolution recovers the receipt; committed clear never masquerades as fenced", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ state: "committed", receipt }),
  );
  assert.ok(
    JSON.stringify(await resolveRetainedBookingIntent(pair)) ===
      JSON.stringify({ state: "committed", receipt }),
  );
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ state: "committed" }),
  );
  assert.deepEqual(await requestBookingIntentFence(pair), {
    state: "committed",
  });
});

function isFailure(
  code: string,
  outcome: "unknown" | "rejected",
  status: number,
) {
  return (error: unknown) => {
    assert.ok(error instanceof BookingApiError);
    assert.equal(error.code, code);
    assert.equal(error.outcome, outcome);
    assert.equal(error.status, status);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.deepEqual(Object.keys(error).sort(), [
      "code",
      "name",
      "outcome",
      "status",
    ]);
    return true;
  };
}

const commonRejections: [number, string][] = [
  [400, "invalid_booking"],
  [403, "origin_forbidden"],
  [413, "request_too_large"],
  [415, "unsupported_media_type"],
  [409, "operation_unavailable"],
];
const submitRejections: [number, string][] = [
  [400, "invalid_contact"],
  [409, "review_required"],
  [409, "selection_unavailable"],
  [409, "availability_conflict"],
  [409, "payload_conflict"],
];
for (const [index, endpoint] of calls.entries()) {
  test(`${endpoint.path} accepts only documented endpoint/status/error combinations`, async (t) => {
    const allowed = [
      ...commonRejections,
      ...(index === 0
        ? submitRejections
        : [[405, "method_not_allowed"] as [number, string]]),
    ];
    for (const [status, code] of allowed) {
      t.mock.method(globalThis, "fetch", async () =>
        Response.json({ error: { code } }, { status }),
      );
      await assert.rejects(
        endpoint.call(),
        isFailure(code, "rejected", status),
      );
    }
    for (const code of ["recovery_unavailable", "booking_busy"]) {
      t.mock.method(globalThis, "fetch", async () =>
        Response.json({ error: { code, outcome: "unknown" } }, { status: 503 }),
      );
      await assert.rejects(
        endpoint.call(),
        isFailure(
          index === 0 || code !== "booking_busy" ? code : "unknown_outcome",
          "unknown",
          503,
        ),
      );
    }
    const invalid = [
      { status: 400, body: { error: { code: "operation_unavailable" } } },
      { status: 409, body: { error: { code: "invalid_booking" } } },
      { status: 503, body: { error: { code: "recovery_unavailable" } } },
      {
        status: 503,
        body: { error: { code: "booking_busy", outcome: "failed" } },
      },
      {
        status: 409,
        body: { error: { code: "operation_unavailable", detail: "private" } },
      },
      {
        status: 400,
        body: { error: { code: "invalid_booking" }, private: "raw" },
      },
      { status: 500, body: { error: { code: "raw database detail" } } },
      { status: 201, body: endpoint.success },
      {
        status: 202,
        body: { error: { code: "recovery_unavailable", outcome: "unknown" } },
      },
      ...(index === 0
        ? [{ status: 405, body: { error: { code: "method_not_allowed" } } }]
        : submitRejections.map(([status, code]) => ({
            status,
            body: { error: { code } },
          }))),
    ];
    for (const { status, body } of invalid) {
      t.mock.method(globalThis, "fetch", async () =>
        Response.json(body, { status }),
      );
      await assert.rejects(
        endpoint.call(),
        isFailure("unknown_outcome", "unknown", status),
      );
    }
  });
}

for (const endpoint of calls) {
  test(`${endpoint.path} rejects malformed, oversized and wrong-endpoint successes as unknown`, async (t) => {
    const invalidBodies = [
      null,
      [],
      {},
      { ...endpoint.success, private: "raw" },
      { state: "fenced", receipt },
      { state: "committed", submitBefore: receipt.confirmationExpiresAt },
    ];
    for (const body of invalidBodies) {
      t.mock.method(globalThis, "fetch", async () => Response.json(body));
      await assert.rejects(
        endpoint.call(),
        isFailure("unknown_outcome", "unknown", 200),
      );
    }
    const invalidResponses = [
      () =>
        new Response("{", { headers: { "content-type": "application/json" } }),
      () =>
        new Response(JSON.stringify(endpoint.success), {
          headers: { "content-type": "text/html" },
        }),
      () =>
        new Response(new Uint8Array([0xff]), {
          headers: { "content-type": "application/json" },
        }),
      () =>
        new Response(" ".repeat(4097), {
          headers: {
            "content-type": "application/json",
            "content-length": "2",
          },
        }),
      () => new Response(null, { status: 204 }),
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("private stream failure"));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ];
    for (const response of invalidResponses) {
      const value = response();
      t.mock.method(globalThis, "fetch", async () => value);
      const status = value.status;
      await assert.rejects(
        endpoint.call(),
        isFailure("unknown_outcome", "unknown", status),
      );
    }
  });
}

test("receipt and pending timestamps/credentials must match the server primitive contract", async (t) => {
  const badReceipts = [
    { ...receipt, appointmentId: "not-a-uuid" },
    { ...receipt, viewToken: "CD".repeat(32) },
    { ...receipt, viewToken: "a".repeat(63) },
    { ...receipt, confirmationExpiresAt: "2026-11-01T12:00:00Z" },
    { ...receipt, confirmationExpiresAt: "2026-02-30T12:00:00.000Z" },
    { ...receipt, confirmationExpiresAt: "2026-11-01T12:00:00.000+01:00" },
  ];
  for (const bad of badReceipts) {
    t.mock.method(globalThis, "fetch", async () => Response.json(bad));
    await assert.rejects(
      submitBookingIntent(pair, agreement()),
      isFailure("unknown_outcome", "unknown", 200),
    );
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ state: "committed", receipt: bad }),
    );
    await assert.rejects(
      resolveRetainedBookingIntent(pair),
      isFailure("unknown_outcome", "unknown", 200),
    );
  }
  for (const submitBefore of [null, "invalid", "2026-11-01T12:00:00Z"]) {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ state: "pending", submitBefore }),
    );
    await assert.rejects(
      resolveRetainedBookingIntent(pair),
      isFailure("unknown_outcome", "unknown", 200),
    );
  }
});

test("submission snapshots only allowed fields before awaiting without normalization", async (t) => {
  const ownedPair = { ...pair, private: "pair extra" };
  const input = { ...agreement(), private: "booking extra" };
  const expected = JSON.stringify({ ...pair, booking: agreement() });
  Object.assign(input.contact, { clientId: "profile extra" });
  Object.assign(input.reviewedServices[0], { isActive: true });
  let sent: unknown;
  let finish: ((value: Response) => void) | undefined;
  t.mock.method(globalThis, "fetch", (_path: string, init: RequestInit) => {
    sent = init.body;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  });
  const result = submitBookingIntent(ownedPair, input);
  ownedPair.credential = "ef".repeat(32);
  input.serviceIds = ["replaced"];
  input.reviewedServices = [];
  input.contact.note = "changed";
  assert.ok(
    sent === expected,
    "serialized agreement excludes extras and preserves exact original fields",
  );
  assert.ok(finish);
  finish(Response.json(receipt));
  await result;
});

test("omitted optional fields stay omitted, never filled from current configuration", async (t) => {
  const input = agreement();
  delete input.contact.note;
  delete input.contact.phoneCountry;
  t.mock.method(
    globalThis,
    "fetch",
    async (_path: string, init: RequestInit) => {
      const contact = JSON.parse(String(init.body)).booking.contact;
      assert.deepEqual(Object.keys(contact).sort(), ["email", "name", "phone"]);
      return Response.json(receipt);
    },
  );
  await submitBookingIntent(pair, input);
});

test("actual UTF8 byte limit handles split multibyte characters and rejects oversized bodies", async (t) => {
  const body = JSON.stringify(receipt);
  const exact = new TextEncoder().encode(body + " ".repeat(4096 - body.length));
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(exact, {
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
  );
  await submitBookingIntent(pair, agreement());
  let cancelled = false;
  const oversized = new TextEncoder().encode(body + "ж".repeat(2100));
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(oversized);
          },
          cancel() {
            cancelled = true;
          },
        }),
        {
          headers: {
            "content-type": "application/json",
            "content-length": "1",
          },
        },
      ),
  );
  await assert.rejects(
    submitBookingIntent(pair, agreement()),
    isFailure("unknown_outcome", "unknown", 200),
  );
  assert.ok(cancelled, "oversized response reader cancelled");

  // A non-ASCII string is invalid receipt data, but must decode across chunks before shape rejection.
  const bytes = new TextEncoder().encode('"ж"');
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 2));
            controller.enqueue(bytes.slice(2));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    submitBookingIntent(pair, agreement()),
    isFailure("unknown_outcome", "unknown", 200),
  );
});

test("malformed UTF8 cancels an unfinished response without retaining raw errors", async (t) => {
  let cancelled = false;
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([0xff]));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  await assert.rejects(
    submitBookingIntent(pair, agreement()),
    isFailure("unknown_outcome", "unknown", 200),
  );
  assert.ok(cancelled, "invalid response body cancelled");
});

test("abort and redirect failures remain unknown on all endpoints", async (t) => {
  for (const endpoint of calls) {
    for (const reason of [
      new DOMException("private abort", "AbortError"),
      new TypeError("private redirect"),
    ]) {
      t.mock.method(globalThis, "fetch", async () => {
        throw reason;
      });
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        endpoint.call(controller.signal),
        isFailure("unknown_outcome", "unknown", 0),
      );
    }
  }
});

test("serialization failures are redacted and never reach fetch", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    return Response.json(receipt);
  });
  const input = agreement();
  Object.defineProperty(input.contact, "name", {
    get() {
      throw new Error("private getter");
    },
  });
  await assert.rejects(
    submitBookingIntent(pair, input),
    isFailure("unknown_outcome", "unknown", 0),
  );
  await assert.rejects(
    resolveRetainedBookingIntent(null as never),
    isFailure("unknown_outcome", "unknown", 0),
  );
  await assert.rejects(
    requestBookingIntentFence(null as never),
    isFailure("unknown_outcome", "unknown", 0),
  );
  assert.equal(count, 0);
});

test("network failure is redacted unknown, never auto-retried", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () => {
    count++;
    throw new Error("private raw failure");
  });
  await assert.rejects(
    submitBookingIntent(pair, agreement()),
    isFailure("unknown_outcome", "unknown", 0),
  );
  assert.equal(count, 1);
});
