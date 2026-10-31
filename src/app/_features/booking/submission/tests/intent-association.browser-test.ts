import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { type Browser, type BrowserContext, chromium } from "@playwright/test";
import ts from "typescript";

// Synthetic public locators only; isolated contexts, no traces/screenshots.
let browser: Browser;
let source: string;
before(async () => {
  source = ts.transpileModule(
    readFileSync(
      "src/app/_features/booking/submission/intent-association.ts",
      "utf8",
    ),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    },
  ).outputText;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

async function isolated(check: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext();
  let pageErrors = 0;
  context.on("page", (page) => {
    page.on("pageerror", () => pageErrors++);
  });
  try {
    await context.addInitScript("globalThis.__name = (fn) => fn;");
    await context.route("http://localhost/**", (route) =>
      route.fulfill({
        contentType: route.request().url().endsWith("module.js")
          ? "text/javascript"
          : "text/html",
        body: route.request().url().endsWith("module.js")
          ? source
          : "<!doctype html><title>Tab association test</title>",
      }),
    );
    await check(context);
    assert.equal(pageErrors, 0, "no uncaught browser exceptions");
  } finally {
    await context.close();
  }
}

async function newPage(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto("http://localhost/");
  return page;
}

test("a raw locator survives reload without adding private or draft state", async () => {
  await isolated(async (context) => {
    const page = await newPage(context);
    assert.equal(
      await page.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        const association = createIntentAssociation();
        if (association.read() !== null) return false;
        association.write("abcdefab-1111-4111-8111-111111111111", null);
        const key = sessionStorage.key(0);
        return (
          sessionStorage.length === 1 &&
          key !== null &&
          sessionStorage.getItem(key) === association.read()
        );
      }),
      true,
    );
    await page.reload();
    assert.equal(
      await page.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        return (
          createIntentAssociation().read() ===
            "abcdefab-1111-4111-8111-111111111111" &&
          sessionStorage.length === 1
        );
      }),
      true,
    );
  });
});

test("an opener copies the locator, but subsequent pointer changes remain tab-local", async () => {
  await isolated(async (context) => {
    const opener = await newPage(context);
    await opener.evaluate(async () => {
      const { createIntentAssociation } = await import(String("/module.js"));
      createIntentAssociation().write(
        "abcdefab-1111-4111-8111-111111111111",
        null,
      );
    });
    const [copied] = await Promise.all([
      opener.waitForEvent("popup"),
      opener.evaluate(() => {
        window.open("/", "_blank");
      }),
    ]);
    await copied.waitForLoadState();
    assert.equal(
      await copied.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        const association = createIntentAssociation();
        if (association.read() !== "abcdefab-1111-4111-8111-111111111111")
          return false;
        association.write(
          "22222222-2222-4222-8222-222222222222",
          "abcdefab-1111-4111-8111-111111111111",
        );
        association.remove("22222222-2222-4222-8222-222222222222");
        return association.read() === null;
      }),
      true,
    );
    assert.equal(
      await opener.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        return (
          createIntentAssociation().read() ===
          "abcdefab-1111-4111-8111-111111111111"
        );
      }),
      true,
    );
  });
});

test("independent same-origin tabs do not inherit or overwrite each other's association", async () => {
  await isolated(async (context) => {
    const first = await newPage(context);
    await first.evaluate(async () => {
      const { createIntentAssociation } = await import(String("/module.js"));
      createIntentAssociation().write(
        "abcdefab-1111-4111-8111-111111111111",
        null,
      );
    });
    const second = await newPage(context);
    assert.equal(
      await second.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        const association = createIntentAssociation();
        if (association.read() !== null) return false;
        association.write("22222222-2222-4222-8222-222222222222", null);
        return association.read() === "22222222-2222-4222-8222-222222222222";
      }),
      true,
    );
    assert.equal(
      await first.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        return (
          createIntentAssociation().read() ===
          "abcdefab-1111-4111-8111-111111111111"
        );
      }),
      true,
    );
  });
});

test("stale writes and malformed session values are refused without repair", async () => {
  await isolated(async (context) => {
    const page = await newPage(context);
    assert.equal(
      await page.evaluate(async () => {
        const { createIntentAssociation } = await import(String("/module.js"));
        const association = createIntentAssociation();
        association.write("abcdefab-1111-4111-8111-111111111111", null);
        let refused = 0;
        try {
          association.write("22222222-2222-4222-8222-222222222222", null);
        } catch (error) {
          if ((error as Error).message === "intent_association_unavailable")
            refused++;
        }
        try {
          association.remove("22222222-2222-4222-8222-222222222222");
        } catch (error) {
          if ((error as Error).message === "intent_association_unavailable")
            refused++;
        }
        const unchanged =
          association.read() === "abcdefab-1111-4111-8111-111111111111";
        const key = sessionStorage.key(0);
        if (key === null) return false;
        sessionStorage.setItem(key, "malformed");
        try {
          association.read();
        } catch (error) {
          if ((error as Error).message === "intent_association_unavailable")
            refused++;
        }
        return (
          refused === 3 &&
          unchanged &&
          sessionStorage.getItem(key) === "malformed"
        );
      }),
      true,
    );
  });
});
