import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { chromium } from "@playwright/test";
import { Hono } from "hono";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  clients,
} from "@/db/schema";
import { seedCatalog } from "@/db/seed";
import { withTestDatabase } from "@/db/testing";
import { registerConfirmationRoutes } from "@/server/http/confirmation.routes";

// Run after `npm run build`. No browser traces/screenshots, request logs or
// private-link output. Only the existing harness can create/drop its own schema.
const origin = "http://127.0.0.1:3101";
const id = "11111111-1111-4111-8111-111111111111";
const token = "ab".repeat(32); // Synthetic credential for this isolated fixture only.
const start = Date.parse("2030-06-01T23:30:00Z");
const end = start + 30 * 60_000;
const expiry = end + 168 * 3_600_000;
let server: ChildProcess | undefined;
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  server = undefined;
}
async function boot() {
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3101",
    ],
    { stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Confirmation test server exited");
    try {
      if ((await fetch(`${origin}/confirmation`)).ok) return;
    } catch {
      /* Wait for the production server's listening socket. */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Confirmation test server not ready");
}

async function check() {
  await withTestDatabase({}, async ({ db, independentDb }) => {
    await seedCatalog(db);
    await db.insert(clients).values({ id, normalizedPhone: "+359888123456" });
    await db.insert(appointments).values({
      id,
      clientId: id,
      staffId: "mimi",
      contactName: "Private fixture",
      contactPhone: "+359888123456",
      contactEmail: "private@example.test",
      notes: "Private fixture notes",
      staffName: "Запазен специалист",
      businessAddress: "Запазен адрес 12",
      bookingTimeZone: "Asia/Tokyo",
      startsAt: new Date(start).toISOString(),
      serviceEndsAt: new Date(end).toISOString(),
      occupiedEndsAt: new Date(end + 15 * 60_000).toISOString(),
      createdAt: new Date(start - 86_400_000).toISOString(),
      confirmationExpiresAt: new Date(expiry).toISOString(),
    });
    await db.insert(appointmentServices).values({
      appointmentId: id,
      position: 0,
      serviceId: "cut_w",
      name: "Запазена услуга",
      priceCents: null,
      currency: "BGN",
      durationMinutes: 30,
      cleanupMinutes: 15,
    });
    await db.insert(appointmentAccess).values({
      appointmentId: id,
      tokenHash: createHash("sha256")
        .update(Buffer.from(token, "hex"))
        .digest("hex"),
    });
    let now = start;
    const browser = await chromium.launch();
    try {
      await boot();
      const context = await browser.newContext({
        timezoneId: "America/Los_Angeles",
        viewport: { width: 320, height: 900 },
      });
      const page = await context.newPage();
      // Bind this browser request to the harness's private DB, never the app DB.
      // Reconstruct the HTTP application on every read to avoid in-memory state.
      await page.route("**/api/confirmations/read", async (route) => {
        const app = new Hono<{
          Bindings: { db?: typeof independentDb };
        }>().basePath("/api");
        registerConfirmationRoutes(app, {
          configuration: () => ({ origin }),
          clock: () => now,
        });
        const response = await app.request(
          `${origin}/api/confirmations/read`,
          {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
              "sec-fetch-site": "same-origin",
            },
            body: route.request().postData(),
          },
          { db: independentDb },
        );
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
      });
      const link = `${origin}/confirmation#${new URLSearchParams({ appointmentId: id, viewToken: token })}`;
      async function confirmed() {
        await page
          .getByRole("heading", { name: "Резервацията е потвърдена" })
          .waitFor();
        assert.equal(
          await page.getByText("08:30 – 09:00", { exact: true }).isVisible(),
          true,
        );
        assert.equal(
          await page
            .getByText("Запазен специалист", { exact: true })
            .isVisible(),
          true,
        );
        assert.equal(
          await page
            .getByText("private@example.test", { exact: false })
            .count(),
          0,
        );
      }
      await page.goto(link);
      await confirmed();
      await page.reload();
      await confirmed();
      await stop();
      await boot();
      await page.reload();
      await confirmed();
      now = expiry; // Equality is expired, with stored history left intact.
      await page.reload();
      await page
        .getByText("Линкът е невалиден или е изтекъл.", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("Запазен специалист", { exact: true }).count(),
        0,
      );
      assert.equal((await db.select().from(appointments)).length, 1);
      await page.goto(
        `${origin}/confirmation#${new URLSearchParams({ appointmentId: id, viewToken: "cd".repeat(32) })}`,
      );
      await page
        .getByText("Линкът е невалиден или е изтекъл.", { exact: true })
        .waitFor();
      console.log(
        "Private confirmation DB/browser check passed (reload, Next restart, invalid/expiry, business zone).",
      );
    } finally {
      await browser.close();
      await stop();
    }
  });
}

check().catch(async () => {
  await stop();
  console.error(
    "Private confirmation DB/browser check failed; details redacted.",
  );
  process.exitCode = 1;
});
