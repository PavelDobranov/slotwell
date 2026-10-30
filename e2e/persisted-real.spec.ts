import assert from "node:assert/strict";
import { expect, test as policyTest, type TestInfo } from "@playwright/test";

import {
  assertPrivateArtifactPolicy,
  confirmPersistedBooking,
  enterPersistedDetails,
  expectPersistedConfirmation,
  fillPersistedContact,
  reviewPersistedBooking,
  test,
} from "./persisted-fixtures";

policyTest(
  "private artifact policy rejects capture overrides before any private navigation",
  async ({ browserName }, info) => {
    assert.equal(browserName, "chromium");
    const origin = "http://127.0.0.1:3100";
    assertPrivateArtifactPolicy(info, origin);
    const unsafeSettings: Partial<TestInfo["project"]["use"]>[] = [
      { trace: "on" },
      { screenshot: "on" },
      { video: "on" },
      { serviceWorkers: "allow" },
      { reuseContext: true },
      { storageState: { cookies: [], origins: [] } },
      { connectOptions: { wsEndpoint: "ws://127.0.0.1:1" } },
      { contextOptions: { recordVideo: { dir: "never-created" } } },
      { contextOptions: { recordHar: { path: "never-created.har" } } },
    ];
    for (const settings of unsafeSettings) {
      assert.throws(
        () =>
          assertPrivateArtifactPolicy(
            {
              ...info,
              project: {
                ...info.project,
                use: { ...info.project.use, ...settings },
              },
            },
            origin,
          ),
        { message: "Private browser artifact policy refused" },
      );
    }
    assert.throws(
      () =>
        assertPrivateArtifactPolicy(
          { ...info, config: { ...info.config, reporter: [["html", {}]] } },
          origin,
        ),
      { message: "Private browser artifact policy refused" },
    );
  },
);

test("real PostgreSQL booking renders a private confirmation after reload", async ({
  page,
  persisted,
  submit,
  openConfirmation,
  reloadConfirmation,
}) => {
  await page.goto("/book");
  const submission = await persisted.booking();
  const result = await submit(submission);
  // Never print whole receipts, request bodies, fragments or credentials.
  assert.equal(result.status, 200);
  assert.equal(result.receipt !== null, true);
  if (!result.receipt) throw new Error("Expected private receipt");
  await openConfirmation(result.receipt);
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  await reloadConfirmation();
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  assert.equal(await page.getByText("browser@example.test").count(), 0);
});

test("real booking keeps contacts and receipts out of storage, URLs, referrers and console", async ({
  page,
  context,
  persisted,
}) => {
  let leaked = false;
  let consoleMessages = 0;
  const sensitive = [
    "Fictional Journey Guest",
    "0888123456",
    "journey@example.test",
    "Fictional note",
    "viewToken=",
    "credential=",
  ];
  page.on("console", () => consoleMessages++);
  page.on("pageerror", () => consoleMessages++);
  context.on("request", (request) => {
    const metadata = `${request.url()} ${JSON.stringify(request.headers())}`;
    leaked ||=
      /[a-f0-9]{64}/.test(metadata) ||
      sensitive.some(
        (value) =>
          metadata.includes(value) ||
          metadata.includes(encodeURIComponent(value)),
      );
  });
  await enterPersistedDetails(page, persisted);
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await confirmPersistedBooking(page).click();
  await expectPersistedConfirmation(page);
  // Inspect only this disposable fictional profile; return booleans, never pairs.
  const storageSafe = await page.evaluate(async (forbidden) => {
    const viewToken = new URLSearchParams(location.hash.slice(1)).get(
      "viewToken",
    );
    if (!viewToken) return false;
    const values = [
      ...Object.values(localStorage),
      ...Object.values(sessionStorage),
    ];
    const databases = await indexedDB.databases();
    if (
      databases.length !== 1 ||
      databases[0].name !== "slotwell-booking-intents"
    )
      return false;
    const records = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open("slotwell-booking-intents", 1);
      open.onerror = () =>
        reject(new Error("Private storage inspection failed"));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("intents", "readonly");
        const read = tx.objectStore("intents").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(read.result);
        };
        tx.onabort = () => {
          db.close();
          reject(new Error("Private storage inspection failed"));
        };
      };
    });
    return (
      localStorage.length === 0 &&
      sessionStorage.length === 1 &&
      values.every((value) => /^[a-f0-9-]{36}$/.test(value)) &&
      records.length === 1 &&
      records.every((record) => {
        if (!record || typeof record !== "object") return false;
        const row = record as Record<string, unknown>;
        return (
          Object.keys(row).sort().join(",") === "credential,operationId" &&
          typeof row.operationId === "string" &&
          /^[a-f0-9-]{36}$/.test(row.operationId) &&
          typeof row.credential === "string" &&
          /^[a-f0-9]{64}$/.test(row.credential) &&
          row.credential !== viewToken &&
          values[0] === row.operationId &&
          !forbidden.some((value) => JSON.stringify(row).includes(value))
        );
      })
    );
  }, sensitive);
  assert.equal(storageSafe, true);
  assert.equal(leaked, false);
  assert.equal(consoleMessages, 0);
  // Fulfil the known Maps destination locally: no third-party network or artifacts.
  let externalRequests = 0;
  let referrerAbsent = false;
  await context.route("https://www.google.com/maps/dir/**", async (route) => {
    externalRequests++;
    referrerAbsent = route.request().headers().referer === undefined;
    const destination = new URL(route.request().url());
    leaked ||=
      destination.searchParams.size !== 2 ||
      destination.searchParams.get("api") !== "1" ||
      destination.searchParams.get("destination") !== "ул. „Шипка“ 18, София";
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "Map stub",
    });
  });
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Упътване до салона" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(externalRequests, 1);
  assert.equal(referrerAbsent, true);
  assert.equal(leaked, false);
  await popup.close();
});

test("real occupied conflict and expired confirmation use isolated fictional scenarios", async ({
  page,
  persisted,
  submit,
  openConfirmation,
}) => {
  await page.goto("/book");
  const submission = await persisted.booking();
  await persisted.occupy(submission);
  const competing = await persisted.booking();
  competing.input.startsAt = submission.input.startsAt;
  const conflict = await submit(competing);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "availability_conflict");
  const expired = await persisted.expiredConfirmation();
  await openConfirmation(expired);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Линкът е невалиден или е изтекъл.",
  );
});
