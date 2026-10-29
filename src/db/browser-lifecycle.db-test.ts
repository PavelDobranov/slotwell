import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";

import { withTestDatabase } from "@/db/testing";
import { readConfirmation } from "@/server/booking";
import { withPersistedBrowserServer } from "../../scripts/e2e-db";

const mode = "private-schema-v1";

test("browser lifecycle refuses missing explicit selection without database setup", async () => {
  const previous = process.env.SLOTWELL_BROWSER_TEST;
  delete process.env.SLOTWELL_BROWSER_TEST;
  try {
    await assert.rejects(
      withPersistedBrowserServer(async () => undefined),
      {
        message: "Explicit browser test environment required",
      },
    );
  } finally {
    if (previous === undefined) delete process.env.SLOTWELL_BROWSER_TEST;
    else process.env.SLOTWELL_BROWSER_TEST = previous;
  }
});

test("fictional scenarios support occupied conflicts and expired access without editing history", async () => {
  process.env.SLOTWELL_BROWSER_TEST = mode;
  try {
    await withPersistedBrowserServer(async (server) => {
      const submission = await server.booking();
      const competitor = await server.booking();
      const receipt = await server.occupy(submission);
      assert.equal(
        (await readConfirmation(server.db, receipt)).status,
        "confirmed",
      );
      await assert.rejects(
        server.occupy(competitor),
        (error: unknown) =>
          error instanceof Error && error.message === "availability_conflict",
      );
      const expired = await server.expiredConfirmation();
      await assert.rejects(
        readConfirmation(server.db, expired),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "confirmation_unavailable",
      );
      const [history] = await server.db.execute(
        sql`SELECT count(*)::integer AS count FROM appointments`,
        "objects",
      );
      assert.equal(history.count, 2);
    });
  } finally {
    delete process.env.SLOTWELL_BROWSER_TEST;
  }
});

test("production browser server starts/stops twice and cleans after callback/startup failure", async () => {
  process.env.SLOTWELL_BROWSER_TEST = mode;
  try {
    await withTestDatabase({}, async ({ db: observer }) => {
      const names: string[] = [];
      for (let cycle = 0; cycle < 2; cycle++) {
        let origin = "";
        await withPersistedBrowserServer(async (server) => {
          names.push(server.schemaName);
          origin = server.origin;
          const response = await fetch(`${origin}/api/catalog`);
          assert.equal(response.status, 200);
          const catalog = await response.json();
          assert.equal(catalog.business.name, server.marker);
          const booking = await server.booking();
          assert.ok(Date.parse(booking.input.startsAt) > server.anchor);
        });
        await assert.rejects(fetch(`${origin}/api/catalog`));
        assert.equal(
          (
            await observer.execute(
              sql`SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${names[cycle]}`,
              "objects",
            )
          ).length,
          0,
        );
      }
      assert.notEqual(names[0], names[1]);
      let failedSchema = "";
      await assert.rejects(
        withPersistedBrowserServer(async (server) => {
          failedSchema = server.schemaName;
          throw new Error("fictional private callback detail");
        }),
        { message: "Browser database lifecycle failed" },
      );
      assert.equal(
        (
          await observer.execute(
            sql`SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${failedSchema}`,
            "objects",
          )
        ).length,
        0,
      );
      let startupSchema = "";
      await assert.rejects(
        withPersistedBrowserServer(
          async () => assert.fail("must not become ready"),
          {
            readyTimeoutMs: 1,
            onOwned: (name) => {
              startupSchema = name;
            },
          },
        ),
        { message: "Browser database lifecycle failed" },
      );
      assert.match(startupSchema, /^slotwell_test_[a-f0-9]{32}$/);
      assert.equal(
        (
          await observer.execute(
            sql`SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${startupSchema}`,
            "objects",
          )
        ).length,
        0,
      );
    });
  } finally {
    delete process.env.SLOTWELL_BROWSER_TEST;
  }
});
