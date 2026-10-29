import { expect, test } from "@playwright/test";

// Private links must never be retained in traces, videos or screenshots.
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  timezoneId: "America/Los_Angeles",
});

test("private entry has privacy headers and rejects missing credentials without a read", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/confirmations/read", async (route) => {
    reads++;
    await route.abort();
  });
  const response = await page.goto("/confirmation");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toBe(
    "noindex, nofollow, noarchive",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow.*noarchive/,
  );
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Потвърждение на резервация" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Линкът е невалиден или е изтекъл.",
  );
  expect(reads).toBe(0);
});
