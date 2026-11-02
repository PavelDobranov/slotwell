import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import { build } from "esbuild";

const entry = resolve(
  "src/app/_features/demo-booking/tests/context-harness.tsx",
);
const bundle = build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "observe-demo-session",
      setup(builder) {
        builder.onResolve(
          { filter: /^@\/app\/_features\/demo-booking\/session$/ },
          (args) => {
            if (args.importer.endsWith("/demo-booking/context.tsx"))
              return { path: "session-observer", namespace: "test" };
          },
        );
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `export { createHarnessSession as createDemoSession } from ${JSON.stringify(entry)}`,
          loader: "js",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});

async function fixture(scenario: unknown, run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    let errors = 0;
    page.on("pageerror", () => errors++);
    await page.route("http://demo-context.test/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<div id="root"></div>',
      }),
    );
    await page.goto("http://demo-context.test/");
    await page.clock.install({ time: new Date("2026-06-01T05:00:00Z") });
    await page.clock.pauseAt(new Date("2026-06-01T05:00:00Z"));
    await page.addScriptTag({ content: (await bundle).outputFiles[0].text });
    await page.evaluate(
      (value) => window.demoContextHarness.mount(value),
      scenario,
    );
    await page.waitForFunction(() => window.demoContextHarness.status().ready);
    await run(page);
    assert.equal(errors, 0);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function prepare(page: Page) {
  await page.evaluate(() => window.demoContextHarness.prepare());
  await page.waitForFunction(
    () => window.demoContextHarness.status().step === "details",
  );
  await page.evaluate(() => window.demoContextHarness.review());
  await page.waitForFunction(() => window.demoContextHarness.status().review);
}

test("Strict Mode bootstraps once, consumes only the enum hook, refreshes each minute and cleans up", async () => {
  await fixture({ unexpected: "conflict" }, async (page) => {
    const initial = await page.evaluate(() =>
      window.demoContextHarness.status(),
    );
    assert.equal(initial.created, 1);
    assert.equal(initial.activeTimers, 1);
    assert.equal(initial.scenarioSeen, "normal");
    assert.equal(initial.hookRemoved, true);
    await prepare(page);
    await page.clock.fastForward(60_000);
    const refreshed = await page.evaluate(() =>
      window.demoContextHarness.status(),
    );
    assert.equal(refreshed.created, 1);
    assert.equal(refreshed.anchored, true);
    assert.equal(refreshed.review, true);
    assert.notEqual(refreshed.availabilityTime, null);
    assert.notEqual(initial.availabilityTime, null);
    assert.equal(
      Number(refreshed.availabilityTime) - Number(initial.availabilityTime),
      60_000,
    );
    await page.clock.fastForward(3 * 60 * 60_000);
    await page.waitForFunction(
      () => window.demoContextHarness.status().step === "time",
    );
    assert.equal(
      await page.evaluate(() => window.demoContextHarness.status().start),
      null,
    );
    await page.evaluate(() => window.demoContextHarness.unmount());
    const stopped = await page.evaluate(() =>
      window.demoContextHarness.status(),
    );
    assert.equal(stopped.activeTimers, 0);
    await page.clock.fastForward(120_000);
    assert.deepEqual(
      await page.evaluate(() => window.demoContextHarness.status()),
      stopped,
    );
  });
});

for (const scenario of ["normal", "retryable", "conflict"] as const) {
  test(`Strict Mode ${scenario}: same-turn confirmation locks synchronously and retains recovery/reset behavior`, async () => {
    await fixture(scenario, async (page) => {
      await prepare(page);
      await page.evaluate(() => window.demoContextHarness.confirmTwice());
      await page.waitForFunction(
        () => window.demoContextHarness.status().pending,
      );
      assert.equal(
        await page.evaluate(() => window.demoContextHarness.status().calls),
        1,
      );
      await page.clock.fastForward(60_000);
      assert.equal(
        await page.evaluate(() => window.demoContextHarness.status().step),
        "details",
      );
      await page.evaluate(() => window.demoContextHarness.release());
      await page.waitForFunction(
        () => !window.demoContextHarness.status().pending,
      );
      const result = await page.evaluate(() =>
        window.demoContextHarness.status(),
      );
      assert.equal(result.contactPreserved, true);
      assert.equal(result.confirmed, scenario === "normal");
      assert.equal(result.occupiedCount, scenario === "retryable" ? 0 : 1);
      assert.equal(result.error, scenario !== "normal");
      if (scenario === "retryable") {
        await page.evaluate(() => window.demoContextHarness.confirmTwice());
        await page.waitForFunction(
          () => window.demoContextHarness.status().pending,
        );
        assert.equal(
          await page.evaluate(() => window.demoContextHarness.status().calls),
          2,
        );
        await page.evaluate(() => window.demoContextHarness.release());
        await page.waitForFunction(
          () => window.demoContextHarness.status().confirmed,
        );
      } else if (scenario === "conflict") {
        assert.equal(result.step, "time");
        assert.equal(result.start, null);
      }
      await page.evaluate(() => window.demoContextHarness.reset());
      await page.waitForFunction(
        () => window.demoContextHarness.status().step === "services",
      );
      const reset = await page.evaluate(() =>
        window.demoContextHarness.status(),
      );
      assert.equal(reset.confirmed, false);
      assert.equal(reset.emptyContact, true);
      assert.equal(reset.serviceCount, 0);
      assert.equal(reset.occupiedCount, 1);
    });
  });
}
