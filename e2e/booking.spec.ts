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

test("keyboard service selection updates totals, navigation and focus without a route screen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const next = page.getByRole("button", { name: "Продължи" });
  await expect(next).toBeDisabled();
  const haircut = page.getByRole("checkbox", { name: /Подстригване/ });
  await haircut.focus();
  await page.keyboard.press("Space");
  await expect(haircut).toBeChecked();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  const summary = page.getByRole("complementary", { name: "Твоят избор" });
  await expect(summary).toContainText("50 мин");
  await expect(summary).toContainText(/35,00\s*€/);
  await page.screenshot({
    path: "coverage/playwright/services-selected.png",
    fullPage: true,
  });
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("radio", { name: "Първо специалист" }),
  ).toBeChecked();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(page.locator('[aria-current="step"]')).toContainText(
    "Дата и час",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "coverage/playwright/route-choice.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(
    page.getByRole("heading", { name: "Услуги", exact: true }),
  ).toBeFocused();
  await expect(haircut).toBeChecked();
  await next.click();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await expect(
    page.getByRole("heading", { name: "Услуги", exact: true }),
  ).toBeFocused();
  await haircut.uncheck();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).uncheck();
  await expect(next).toBeDisabled();
  await page.reload();
  await expect(haircut).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("specialist choices require explicit selection and match every service", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const specialists = page.getByRole("group", { name: "Избери специалист" });
  await expect(specialists.getByRole("radio")).toHaveCount(1);
  const ivan = specialists.getByRole("radio", { name: /Иван/ });
  await expect(ivan).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
  await ivan.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await page.getByRole("checkbox", { name: /Боядисване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByText(
      "Няма специалист за тази комбинация от услуги. Промени услугите, за да продължиш.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
});

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
