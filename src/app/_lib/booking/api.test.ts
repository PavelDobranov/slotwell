import assert from "node:assert/strict";
import test from "node:test";

import { CatalogApiError, fetchAvailability } from "@/app/_lib/booking/api";

const query = {
  staffId: "a & b",
  serviceIds: ["cut", "color"],
  from: "2026-10-25",
  to: "2026-10-31",
};

test("availability serializes the approved query and preserves authoritative slots and empty days", async (t) => {
  const response = {
    timeZone: "Asia/Tokyo",
    serverNow: "2026-10-24T23:00:00Z",
    from: query.from,
    to: query.to,
    days: [
      {
        date: query.from,
        slots: [{ start: "2026-10-25T00:15:00Z", end: "2026-10-25T00:52:00Z" }],
      },
      { date: query.to, slots: [] },
    ],
  };
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (path: string, init: RequestInit) => {
      const url = new URL(path, "http://localhost");
      assert.equal(url.pathname, "/api/availability");
      assert.deepEqual([...url.searchParams.keys()].sort(), [
        "from",
        "service",
        "service",
        "staff",
        "to",
      ]);
      assert.equal(url.searchParams.get("staff"), query.staffId);
      assert.deepEqual(url.searchParams.getAll("service"), query.serviceIds);
      assert.equal(url.searchParams.get("from"), query.from);
      assert.equal(url.searchParams.get("to"), query.to);
      assert.equal(init.signal, controller.signal);
      return Response.json(response);
    },
  );
  assert.deepEqual(await fetchAvailability(query, controller.signal), response);
});

test("availability preserves stable server errors without raw details", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { code: "date_range_too_large", max: 7 }, detail: "private" },
      { status: 400 },
    ),
  );
  await assert.rejects(
    fetchAvailability(query),
    (error: unknown) =>
      error instanceof CatalogApiError &&
      error.code === "date_range_too_large" &&
      error.max === 7 &&
      error.status === 400 &&
      !error.message.includes("private"),
  );
});

test("availability distinguishes network failures from cancellation", async (t) => {
  const failure = new Error("offline");
  t.mock.method(globalThis, "fetch", async () => {
    throw failure;
  });
  await assert.rejects(
    fetchAvailability(query),
    (error: unknown) =>
      error instanceof CatalogApiError && error.code === "network",
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchAvailability(query, controller.signal),
    (error: unknown) => error === failure,
  );
});
