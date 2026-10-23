import { expect, test } from "@playwright/test";

test("the home page exposes a visible main landmark", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
});

test("the Bulgarian shell has honest demo copy and keyboard access", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      errors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3100") {
      external.push(request.url());
    }
  });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "bg");
  await expect(page).toHaveTitle("Запази час · Студио Искра");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Демо.*салон/,
  );
  await expect(
    page.getByRole("heading", { name: "Запази време за себе си" }),
  ).toBeVisible();
  await expect(page.getByText("Студио Искра — демо салон")).toBeVisible();
  await expect(
    page.getByText("Демо версия — не се създава реална резервация."),
  ).toBeVisible();
  const progress = page.getByRole("navigation", {
    name: "Стъпки на резервацията",
  });
  await expect(progress.locator('[aria-current="step"]')).toContainText(
    "Услуги",
  );
  await expect(progress.getByRole("listitem")).toHaveCount(4);
  await expect(
    page.getByRole("complementary", { name: "Твоят избор" }),
  ).toContainText("Все още няма избрани услуги.");
  await expect(page.locator("time")).toBeVisible();

  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Към резервацията" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await expect(skip).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test("the initial HTML is clock-independent and keeps the demo notice", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Подготвяме датата на салона…")).toBeVisible();
  await expect(page.locator("time")).toHaveCount(0);
  await expect(
    page.getByText("Демо версия — не се създава реална резервация."),
  ).toBeVisible();
  await context.close();
});

for (const [instant, date, label] of [
  ["2026-03-28T22:30:00Z", "2026-03-29", "29 март 2026"],
  ["2026-10-24T22:30:00Z", "2026-10-25", "25 октомври 2026"],
]) {
  test(`the mounted clock uses live Sofia dates: ${date}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      timezoneId: "America/New_York",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        errors.push(message.text());
      }
    });
    await page.clock.setFixedTime(new Date(instant));
    await page.goto("/");
    await expect(page.locator("time")).toHaveAttribute("datetime", date);
    await expect(page.locator("time")).toContainText(label);
    expect(errors).toEqual([]);
    await context.close();
  });
}

for (const width of [320, 360, 768, 1024, 1440]) {
  test(`the shell fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator("time")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await expect(
      page.getByRole("heading", { name: "Услуги", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Демо версия — не се създава реална резервация."),
    ).toBeInViewport();
    await page.screenshot({
      path: `coverage/playwright/shell-${width}.png`,
      fullPage: true,
    });
  });
}
