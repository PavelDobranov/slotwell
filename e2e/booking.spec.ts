import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

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

test("specialist-first date recovery, horizon, edits and keyboard times reach details", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const date = page.getByLabel("Дата на посещението");
  await expect(date.locator("option")).toHaveCount(61);
  await expect(date.locator("option").last()).toHaveAttribute(
    "value",
    "2026-07-31",
  );
  await date.selectOption("2026-07-31");
  await expect(
    page.getByRole("radio", { name: "09:00", exact: true }),
  ).toBeVisible();
  await date.selectOption("2026-06-09"); // Salon-wide exception after next Monday.
  await expect(
    page.getByText("Няма свободни часове за тази дата."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
  await page.getByRole("button", { name: "Следваща свободна дата" }).click();
  await expect(date).toHaveValue("2026-06-10");
  const start = page.getByRole("radio", { name: "09:00", exact: true });
  await start.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("complementary")).toContainText("09:00–09:30");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(start).toBeChecked();
  await date.selectOption("2026-06-11");
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
  await expect(page.locator("section output").first()).toContainText(
    "Датата е променена",
  );
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("radio", { name: "09:00", exact: true }),
  ).toBeChecked();
  await date.selectOption("2026-06-10"); // Ivan is off Wednesdays.
  await expect(
    page.getByText("Няма свободни часове за тази дата."),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "coverage/playwright/time-empty.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Следваща свободна дата" }).click();
  await expect(date).toHaveValue("2026-06-11");
  await page.screenshot({
    path: "coverage/playwright/time-recovered.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("date survives back navigation and a specialist change that clears its start", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const date = page.getByLabel("Дата на посещението");
  await date.selectOption("2026-06-10");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(date).toHaveValue("2026-06-10");
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(date).toHaveValue("2026-06-10");
  await expect(
    page.getByText("Няма свободни часове за тази дата."),
  ).toBeVisible();
});

test("selection and navigation revalidate the clock instead of retaining page-open lead time", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z")); // 08:00 Sofia.
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await page.clock.setFixedTime(new Date("2026-06-01T05:30:00Z"));
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: "09:00", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("section output").first()).toContainText(
    "час е премахнат",
  );
});

test("empty dates at the horizon offer service edits without inventing a later slot", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-03T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const date = page.getByLabel("Дата на посещението");
  await date.selectOption("2026-08-01"); // Ivan is off Saturday; horizon ends Sunday.
  await page.getByRole("button", { name: "Следваща свободна дата" }).click();
  await expect(page.getByText(/Няма по-късна свободна дата/)).toBeVisible();
  await expect(date).toHaveValue("2026-08-01");
  await expect(
    page.getByRole("button", { name: "Следваща свободна дата" }),
  ).toHaveCount(0);
  await date.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(date).toHaveValue("2026-08-02");
  await expect(page.getByText(/Няма по-късна свободна дата/)).toBeVisible();
  await page.getByRole("button", { name: "Промени избора на услуги" }).click();
  await expect(
    page.getByRole("heading", { name: "Услуги", exact: true }),
  ).toBeFocused();
});

test("time-first deduplicates shared starts, requires explicit staff, and switches paths without restarting", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  const next = page.getByRole("button", { name: "Продължи" });
  await next.click();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
  const start = page.getByRole("radio", { name: "15:00", exact: true });
  await expect(start).toHaveCount(1);
  await expect(start).not.toBeChecked();
  await expect(next).toBeDisabled();
  await start.focus();
  await page.keyboard.press("Space");
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  const specialists = page.getByRole("group", { name: "Избери специалист" });
  await expect(specialists.getByRole("radio")).toHaveCount(2);
  await expect(next).toBeDisabled();
  await specialists.getByRole("radio", { name: /Мила/ }).check();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("Мила");
  await expect(summary).toContainText("15:00–15:30");
  await page.getByRole("radio", { name: "Първо специалист" }).check();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await expect(specialists.getByRole("radio", { name: /Мила/ })).toBeChecked();
  await next.click();
  await expect(start).toBeChecked();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(start).toBeChecked();
  // The service ends at 10:00, but Mila's cleanup would overlap her occupancy.
  await page.getByLabel("Дата на посещението").selectOption("2026-06-08");
  await page.getByRole("radio", { name: "09:30", exact: true }).check();
  await next.click();
  await expect(specialists.getByRole("radio")).toHaveCount(1);
  await expect(specialists.getByRole("radio", { name: /Мила/ })).toHaveCount(0);
  await expect(next).toBeDisabled();
  await specialists.getByRole("radio", { name: /Иван/ }).check();
  // Wednesday has only Mila; changing time must clear retained Ivan, not the time.
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByLabel("Дата на посещението").selectOption("2026-06-10");
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await next.click();
  await expect(specialists.getByRole("radio")).toHaveCount(1);
  await expect(
    specialists.getByRole("radio", { name: /Мила/ }),
  ).not.toBeChecked();
  await expect(next).toBeDisabled();
  await expect(summary).toContainText("09:00–09:30");
  await expect(summary).not.toContainText("Иван");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page.screenshot({
    path: "coverage/playwright/time-first-single-staff.png",
    fullPage: true,
  });
  await specialists.getByRole("radio", { name: /Мила/ }).focus();
  await page.keyboard.press("Space");
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});

test("time-first filters competencies and rejects a start that becomes stale on the staff step", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Боядисване/ }).check();
  const next = page.getByRole("button", { name: "Продължи" });
  await next.click();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
  await page.getByRole("radio", { name: "10:00", exact: true }).check();
  await next.click();
  const specialists = page.getByRole("group", { name: "Избери специалист" });
  await expect(specialists.getByRole("radio")).toHaveCount(1);
  const elena = specialists.getByRole("radio", { name: /Елена/ });
  await expect(elena).not.toBeChecked();
  await expect(next).toBeDisabled();
  await elena.check();
  await page.clock.setFixedTime(new Date("2026-06-01T06:30:00Z"));
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("radio", { name: "10:00", exact: true }),
  ).toHaveCount(0);
  await expect(next).toBeDisabled();
  await expect(page.locator("section output").first()).toContainText(
    "час е премахнат",
  );
  // Valid staff survives the stale start; replacing the time can still complete the route.
  await page.getByRole("radio", { name: "11:00", exact: true }).check();
  await next.click();
  await expect(elena).toBeChecked();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
});

test("time-first clock refresh returns expired candidates to time selection without losing focus", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-06-01T05:00:00Z") });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  const next = page.getByRole("button", { name: "Продължи" });
  await next.click();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
  // :15 remains valid until the clock passes 08:15 Sofia.
  await page.getByRole("radio", { name: "09:15", exact: true }).check();
  await next.click();
  await page.getByRole("radio", { name: /Мила/ }).focus();
  await page.clock.fastForward(16 * 60_000);
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(page.locator("section output").first()).toContainText(
    "час е премахнат",
  );
  await expect(next).toBeDisabled();
});

for (const path of ["staff-first", "time-first"] as const) {
  test(`${path} restores focus when a time option expires without a step change`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-06-01T05:00:00Z") });
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    const next = page.getByRole("button", { name: "Продължи" });
    await next.click();
    if (path === "time-first") {
      await page.getByRole("radio", { name: "Първо дата и час" }).check();
    } else {
      await page.getByRole("radio", { name: /Мила/ }).check();
      await next.click();
    }
    const start = page.getByRole("radio", { name: "09:15", exact: true });
    await start.focus();
    await page.keyboard.press("Space");
    await page.clock.fastForward(16 * 60_000);
    await expect(start).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Дата и час", exact: true }),
    ).toBeFocused();
    await expect(next).toBeDisabled();
    // A further refresh must not steal focus from a still-present control.
    const date = page.getByLabel("Дата на посещението");
    await date.focus();
    await page.clock.fastForward(60_000);
    await expect(date).toBeFocused();
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
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page.getByRole("radio", { name: /Мила/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await expect(page.getByLabel("Дата на посещението")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/time-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("radio", { name: "Първо дата и час" }).check();
    await expect(page.getByLabel("Дата на посещението")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/time-first-${width}.png`,
      fullPage: true,
    });
  });
}
