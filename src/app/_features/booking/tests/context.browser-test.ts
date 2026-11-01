import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { build } from "esbuild";

// Reuse the esbuild installed with the existing tsx test runner. Development
// React deliberately enables Strict Mode effect replay; Next journeys use the
// production build separately. No test route or dependency injection in the app.
const entry = resolve("src/app/_features/booking/tests/context-harness.tsx");
const bundle = build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "instrument-provider-binding",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^@\/app\/_features\/booking\/submission\/persisted-submission$/,
          },
          (args) => {
            if (args.importer.endsWith("/booking/context.tsx"))
              return { path: "binding-observer", namespace: "test" };
          },
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `export { createHarnessSubmission as createPersistedSubmission } from ${JSON.stringify(entry)}`,
          loader: "js",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});

async function fixture(
  run: (page: import("@playwright/test").Page) => Promise<void>,
) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    let errors = 0;
    page.on("pageerror", () => errors++);
    await page.route("http://booking-context.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      }),
    );
    await page.goto("http://booking-context.test/");
    await page.addScriptTag({ content: (await bundle).outputFiles[0].text });
    await run(page);
    assert.equal(errors, 0, "no runtime errors");
  } finally {
    await context.close();
    await browser.close();
  }
}

test("Strict Mode recreates the binding, unsubscribes the replayed instance and ignores late discovery", async () => {
  await fixture(async (page) => {
    await page.evaluate(() => window.bookingHarness.mount("discovery"));
    await page.waitForFunction(() => window.bookingHarness.status().ready);
    const ready = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(ready.created, 2);
    assert.equal(ready.disposed, 1);
    assert.equal(ready.subscriptions, 2);
    assert.equal(ready.unsubscribed, 1);
    assert.equal(ready.cacheOwned, true);
    assert.equal(ready.allocations, 0);
    await page.evaluate(() => window.bookingHarness.release());
    await page.waitForFunction(
      () => window.bookingHarness.status().settled === 1,
    );
    assert.equal(
      await page.evaluate(() => window.bookingHarness.status().ready),
      true,
    );
    await page.evaluate(() => window.bookingHarness.unmount());
    const stopped = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(stopped.disposed, 2);
    assert.equal(stopped.unsubscribed, 2);
    assert.equal(stopped.disposedEmpty, true);
  });
});

test("same-turn confirmation is single-flight; allocation after provider unmount cannot associate or network", async () => {
  await fixture(async (page) => {
    await page.evaluate(() => window.bookingHarness.mount("allocation"));
    await page.waitForFunction(() => window.bookingHarness.status().ready);
    await page.evaluate(() => window.bookingHarness.prepareReview());
    await page.waitForFunction(() => window.bookingHarness.status().canConfirm);
    await page.evaluate(() => window.bookingHarness.confirmTwice());
    await page.waitForFunction(() => window.bookingHarness.status().busy);
    const pending = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(pending.allocations, 1);
    assert.equal(pending.locked, true);
    assert.equal(pending.resolutions, 0);
    await page.evaluate(() => window.bookingHarness.unmount());
    await page.evaluate(() => {
      window.bookingHarness.release();
      window.bookingHarness.confirmTwice();
    });
    await page.waitForFunction(
      () => window.bookingHarness.status().settled === 1,
    );
    const stopped = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(stopped.writes, 0);
    assert.equal(stopped.resolutions, 0);
    assert.equal(stopped.submissions, 0);
    assert.equal(stopped.allocations, 1);
    assert.equal(stopped.disposedEmpty, true);
    assert.equal(stopped.renders, pending.renders);
  });
});

test("late committed submission after provider unmount neither publishes nor navigates", async () => {
  await fixture(async (page) => {
    await page.evaluate(() => window.bookingHarness.mount("submission"));
    await page.waitForFunction(() => window.bookingHarness.status().ready);
    await page.evaluate(() => window.bookingHarness.prepareReview());
    await page.waitForFunction(() => window.bookingHarness.status().canConfirm);
    await page.evaluate(() => window.bookingHarness.confirmTwice());
    await page.waitForFunction(
      () => window.bookingHarness.status().submissions === 1,
    );
    const pending = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(pending.allocations, 1);
    assert.equal(pending.writes, 1);
    await page.evaluate(() => window.bookingHarness.unmount());
    await page.evaluate(() => window.bookingHarness.release());
    await page.waitForFunction(
      () => window.bookingHarness.status().settled === 2,
    );
    const stopped = await page.evaluate(() => window.bookingHarness.status());
    assert.equal(stopped.submissions, 1);
    assert.equal(stopped.disposedEmpty, true);
    assert.equal(stopped.renders, pending.renders);
    assert.equal(new URL(page.url()).pathname === "/", true);
  });
});
