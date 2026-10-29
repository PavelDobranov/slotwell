import assert from "node:assert/strict";
import { expect, test as policyTest, type TestInfo } from "@playwright/test";

import { assertPrivateArtifactPolicy, test } from "./persisted-fixtures";

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
