import { expect, type Page, test } from "@playwright/test";

import { auditRenderedControls } from "./rendered-audit";

test.use({ timezoneId: "America/New_York" });

async function chooseDate(page: Page, value: string) {
  await page.getByRole("button", { name: "Календар", exact: true }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  const target = new Date(`${value}T12:00:00`);
  const caption = new Intl.DateTimeFormat("bg-BG", {
    month: "long",
    year: "numeric",
  })
    .format(target)
    .replace(/ г\.$/, "");
  const months = [
    "януари",
    "февруари",
    "март",
    "април",
    "май",
    "юни",
    "юли",
    "август",
    "септември",
    "октомври",
    "ноември",
    "декември",
  ];
  for (
    let attempt = 0;
    attempt < 3 &&
    !(await calendar.getByText(caption, { exact: true }).count());
    attempt++
  ) {
    const current = await calendar.locator(".rdp-caption_label").innerText();
    const index = months.findIndex((month) => current.includes(month));
    await calendar
      .getByRole("button", {
        name:
          index < target.getMonth()
            ? "Към следващия месец"
            : "Към предишния месец",
      })
      .click();
  }
  await calendar
    .getByRole("button", {
      name: new RegExp(
        `(?:^|, )0?${target.getDate()} ${months[target.getMonth()]} ${target.getFullYear()}`,
      ),
    })
    .click();
  await expect(calendar).toHaveCount(0);
}

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
  await expect(page).toHaveTitle("Запази час · Ателие Мента");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Запазете час.*Ателие Мента/,
  );
  await expect(
    page.getByRole("heading", { name: "Запази време за себе си" }),
  ).toBeVisible();
  await expect(page.getByText("Ателие Мента")).toBeVisible();
  const progress = page.getByRole("navigation", {
    name: "Стъпки на резервацията",
  });
  await expect(progress.locator('[aria-current="step"]')).toContainText(
    "Услуги",
  );
  await expect(progress.getByRole("listitem")).toHaveCount(4);
  await expect(
    page.getByRole("complementary", { name: "Вашата резервация" }),
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

test("the initial HTML is clock-independent", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByText("Подготвяме датата на салона…")).toBeVisible();
  await expect(page.locator("time")).toHaveCount(0);
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

test("service cards retain catalog facts, checkbox ticks and wrapped narrow labels", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  const services = page.getByRole("group", { name: "Услуги", exact: true });
  await expect(services.locator("legend")).not.toHaveClass(/sr-only/);
  const cards = services.locator("label");
  await expect(cards).toHaveCount(4);
  const first = cards.first();
  await expect(first).toContainText("Подстригване");
  await expect(first).toContainText("30 мин");
  await expect(first).toContainText(/23,00\s*€/);
  await expect(first.getByRole("checkbox")).not.toBeChecked();
  await expect(first.getByRole("checkbox")).toHaveCSS("width", "24px");
  const box = await first.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(68);
  await first.click();
  await expect(first.getByRole("checkbox")).toBeChecked();
  await expect(first.locator('[data-slot="checkbox-indicator"]')).toBeVisible();
  await page.screenshot({
    path: "coverage/playwright/service-card-one.png",
    fullPage: true,
  });
  // Layout stress only: leave fixture IDs, prices and selection state untouched.
  const name = first.locator("span").filter({ hasText: "Подстригване" }).last();
  await name.evaluate((element) => {
    element.textContent =
      "Подстригване и индивидуално оформяне на много дълга коса";
  });
  const labelBox = await name.boundingBox();
  expect(labelBox?.height).toBeGreaterThan(22);
  expect(
    await name.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await expect(first).toContainText(/23,00\s*€/);
  await page.screenshot({
    path: "coverage/playwright/service-card-long.png",
    fullPage: true,
  });
});

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
  await expect(next).toBeEnabled();
  const services = page.getByRole("group", { name: "Услуги", exact: true });
  const error = page.getByText("Избери поне една услуга, за да продължиш.");
  await expect(error).toHaveCount(0);
  await next.click();
  await expect(error).toBeVisible();
  await expect(services).toBeFocused();
  await expect(services).toHaveAttribute("aria-invalid", "true");
  const audit = await auditRenderedControls(page);
  expect(audit.contrasts.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
  await next.click();
  await expect(services).toBeFocused();
  await page.screenshot({
    path: "coverage/playwright/services-error.png",
    fullPage: true,
  });
  const haircut = page.getByRole("checkbox", { name: /Подстригване/ });
  await haircut.focus();
  await page.keyboard.press("Space");
  await expect(haircut).toBeChecked();
  await expect(error).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  await expect(page.getByTestId("services-total")).toHaveText(
    /2 услуги · 50 мин · 35,00\s*€/,
  );
  const summary = page.getByRole("complementary", { name: "Вашата резервация" });
  await expect(summary).toContainText("50 мин");
  await expect(summary).toContainText(/35,00\s*€/);
  await page.screenshot({
    path: "coverage/playwright/services-selected.png",
    fullPage: true,
  });
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("radio", { name: "Дата и час", exact: true }),
  ).toBeChecked();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(page.locator('[aria-current="step"]')).toContainText(
    "Час и специалист",
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
    page.getByRole("heading", { name: "Изберете услуги", exact: true }),
  ).toBeFocused();
  await expect(haircut).toBeChecked();
  await next.click();
  await page.getByRole("button", { name: "Виж избора" }).click();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await expect(
    page.getByRole("heading", { name: "Изберете услуги", exact: true }),
  ).toBeFocused();
  await haircut.uncheck();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).uncheck();
  await expect(next).toBeEnabled();
  await next.click();
  await expect(error).toBeVisible();
  await expect(services).toBeFocused();
  await page.reload();
  await expect(haircut).not.toBeChecked();
  expect(errors).toEqual([]);
});

test("route choice exists only in when/who, defaults to time-first and cannot be cleared", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  const route = page.getByRole("group", {
    name: "Започнете с",
    exact: true,
  });
  await expect(route).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Дата и час" }),
  ).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await expect(page.getByTestId("services-total")).toHaveText(
    /1 услуга · 30 мин · 23,00\s*€/,
  );
  const next = page.getByRole("button", { name: "Продължи", exact: true });
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(route).toHaveCount(1);
  const timeFirst = page.getByRole("radio", {
    name: "Дата и час",
    exact: true,
  });
  await expect(timeFirst).toBeChecked();
  await expect(
    page.getByRole("radio", { name: "15:00", exact: true }),
  ).not.toBeChecked();
  await expect(next).toBeDisabled();
  await timeFirst.focus();
  await page.keyboard.press("Space");
  await expect(timeFirst).toBeChecked();
  await expect(timeFirst).toBeFocused();
  await page.keyboard.press("Space");
  await expect(timeFirst).toBeChecked();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await expect(route).toHaveCount(1);
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(route).toHaveCount(0);
  await next.click();
  await expect(
    page.getByRole("radio", { name: "Специалист", exact: true }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await next.click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await next.click();
  await expect(route).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Демо Клиент");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("0888123456");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("demo@example.com");
  await page
    .getByRole("button", { name: "Провери данните", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Провери и потвърди", exact: true }),
  ).toBeFocused();
  await expect(route).toHaveCount(0);
});

test("specialist choices require explicit selection and match every service", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  const specialists = page.getByRole("group", { name: "Избери специалист" });
  await expect(
    specialists.getByRole("radio").and(page.locator(":enabled")),
  ).toHaveCount(1);
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
    page.getByText("Никой специалист не прави всички избрани услуги заедно"),
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
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const date = page.getByRole("group", {
    name: "Дата на посещението",
    exact: true,
  });
  await expect(date.getByRole("radio")).toHaveCount(7);
  await chooseDate(page, "2026-07-31");
  await expect(
    page.getByRole("button", { name: "Следващите 7 дни" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("radio", { name: "09:00", exact: true }),
  ).toBeVisible();
  await chooseDate(page, "2026-06-10");
  await expect(date.getByRole("radio", { checked: true })).toHaveValue(
    "2026-06-10",
  );
  await expect(page.getByRole("button", { name: "Продължи" })).toBeDisabled();
  const start = page.getByRole("radio", { name: "09:00", exact: true });
  await start.focus();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("complementary")).toContainText("09:00–09:30");
  await expect(page.getByRole("complementary")).toContainText(
    "Ателие Мента, ул. „Шипка“ 18, София",
  );
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(start).toBeChecked();
  await chooseDate(page, "2026-06-11");
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
  // Retain a date Mila can serve when choosing Ivan, who is off Wednesdays.
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await chooseDate(page, "2026-06-10");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
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
  await page.getByRole("button", { name: /Към .*11 юни.*първи час/ }).click();
  await expect(date.getByRole("radio", { checked: true })).toHaveValue(
    "2026-06-11",
  );
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
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  const date = page.getByRole("group", {
    name: "Дата на посещението",
    exact: true,
  });
  await chooseDate(page, "2026-06-10");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(date.locator('input[value="2026-06-10"]')).toBeChecked();
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(date.locator('input[value="2026-06-10"]')).toBeChecked();
  await expect(
    page.getByText("Няма свободни часове за тази дата."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Смени специалиста", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  await expect(date.getByRole("radio", { checked: true })).toHaveValue(
    "2026-06-10",
  );
  await expect(
    page.getByRole("radio", { name: "09:00", exact: true }),
  ).toBeVisible();
});

test("selection and navigation revalidate the clock instead of retaining page-open lead time", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z")); // 08:00 Sofia.
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
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
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await chooseDate(page, "2026-08-01");
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(page.getByText(/Няма по-късна свободна дата/)).toBeVisible();
  await expect(page.locator('input[value="2026-08-01"]')).toBeChecked();
  await expect(page.getByRole("button", { name: /първи час/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Календар", exact: true }).click();
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(
    calendar.getByRole("button", { name: /, 02 август 2026/ }),
  ).toBeDisabled();
  await expect(
    calendar.getByRole("button", { name: /, 03 август 2026/ }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Промени избора на услуги", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Изберете услуги", exact: true }),
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
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
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
  await expect(
    specialists.getByRole("radio").and(page.locator(":enabled")),
  ).toHaveCount(2);
  await expect(next).toBeDisabled();
  await specialists.getByRole("radio", { name: /Мила/ }).check();
  await next.click();
  await expect(
    page.getByRole("heading", { name: "Данни и преглед", exact: true }),
  ).toBeFocused();
  const summary = page.getByRole("complementary");
  await expect(summary).toContainText("Мила");
  await expect(summary).toContainText("15:00–15:30");
  await expect(
    page.getByRole("radio", { name: "Специалист", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Специалист", exact: true }),
  ).toBeFocused();
  await expect(specialists.getByRole("radio", { name: /Мила/ })).toBeChecked();
  await next.click();
  await expect(start).toBeChecked();
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await expect(start).toBeChecked();
  // The service ends at 10:00, but Mila's cleanup would overlap her occupancy.
  await chooseDate(page, "2026-06-08");
  await page.getByRole("radio", { name: "09:30", exact: true }).check();
  await next.click();
  await expect(
    specialists.getByRole("radio").and(page.locator(":enabled")),
  ).toHaveCount(1);
  await expect(specialists.getByRole("radio", { name: /Мила/ })).toBeDisabled();
  await expect(next).toBeDisabled();
  await specialists.getByRole("radio", { name: /Иван/ }).check();
  // Wednesday has only Mila; changing time must clear retained Ivan, not the time.
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await chooseDate(page, "2026-06-10");
  await page.getByRole("radio", { name: "09:00", exact: true }).check();
  await next.click();
  await expect(
    specialists.getByRole("radio").and(page.locator(":enabled")),
  ).toHaveCount(1);
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
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
  await page.getByRole("radio", { name: "10:00", exact: true }).check();
  await next.click();
  const specialists = page.getByRole("group", { name: "Избери специалист" });
  await expect(
    specialists.getByRole("radio").and(page.locator(":enabled")),
  ).toHaveCount(1);
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
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
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
      await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    } else {
      await page.getByRole("radio", { name: "Специалист", exact: true }).check();
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
    const date = page.locator('input[name="visit-date"]:enabled').first();
    await date.focus();
    await page.clock.fastForward(60_000);
    await expect(date).toBeFocused();
  });
}

test("date strip pages without changing selection and calendar supports keyboard selection and Escape", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  const dates = page.getByRole("group", {
    name: "Дата на посещението",
    exact: true,
  });
  const next = page.getByRole("button", {
    name: "Следващите 7 дни",
    exact: true,
  });
  const previous = page.getByRole("button", {
    name: "Предишните 7 дни",
    exact: true,
  });
  await expect(previous).toBeDisabled();
  await expect(dates.locator('input[value="2026-06-03"]')).toBeDisabled();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await expect(
    page.locator("output").filter({ hasText: "15:00–15:50" }),
  ).toBeVisible();
  await next.click();
  await expect(dates.getByRole("radio").first()).toHaveValue("2026-06-08");
  await expect(
    page.getByRole("radio", { name: "15:00", exact: true }),
  ).toBeChecked();
  await dates.locator('input[value="2026-06-11"]').check();
  await chooseDate(page, "2026-06-01");
  await expect(dates.getByRole("radio", { checked: true })).toHaveValue(
    "2026-06-01",
  );
  await expect(previous).toBeDisabled();
  const trigger = page.getByRole("button", { name: "Календар", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const calendar = page.locator('[data-slot="calendar"]');
  await expect(
    calendar.getByRole("button", { name: /вторник, 09 юни/ }),
  ).toBeDisabled();
  await page.screenshot({
    path: "coverage/playwright/time-calendar.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    calendar.getByRole("button", { name: /понеделник, 01 юни/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(dates.getByRole("radio", { checked: true })).toHaveValue(
    "2026-06-02",
  );
  await expect(
    page.getByRole("button", { name: "Продължи", exact: true }),
  ).toBeDisabled();
  for (let index = 0; index < 8; index++) await next.click();
  await expect(next).toBeDisabled();
  await expect(dates.getByRole("radio").last()).toHaveValue("2026-07-31");
});

for (const width of [360, 1280]) {
  test(`Clear Day dates and real slot controls fit ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    const dates = page.getByRole("group", {
      name: "Дата на посещението",
      exact: true,
    });
    const firstDate = dates.getByRole("radio").first();
    const chip = firstDate.locator("..");
    await expect(chip).toHaveCSS("height", "72px");
    const unavailable = dates
      .getByRole("radio", { name: /Няма часове/ })
      .first();
    await expect(unavailable).toBeDisabled();
    await expect(unavailable.locator("..")).toHaveCSS("border-style", "dashed");
    await expect(
      page.getByRole("radio", { name: "09:00", exact: true }),
    ).not.toBeChecked();
    const slot = page.getByRole("radio", { name: "09:00", exact: true });
    await expect(slot.locator("..")).toHaveCSS("min-height", "48px");
    await slot.check();
    await expect(slot.locator("..")).toHaveCSS(
      "background-color",
      await chip.evaluate((node) => getComputedStyle(node).backgroundColor),
    );
    await expect(
      page.getByRole("radio", { name: "09:15", exact: true }),
    ).not.toBeChecked();
    const grid = slot.locator("../..");
    expect(
      await grid.evaluate(
        (node) => getComputedStyle(node).gridTemplateColumns.split(" ").length,
      ),
    ).toBe(width === 360 ? 4 : 6);
    await page.getByRole("button", { name: "Следващите 7 дни" }).click();
    await expect(slot).toBeChecked();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/time-controls-${width}.png`,
      fullPage: true,
    });
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
      page.getByRole("heading", { name: "Изберете услуги", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `coverage/playwright/shell-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page.getByRole("radio", { name: "Специалист", exact: true }).check();
    await page.getByRole("radio", { name: /Мила/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await expect(
      page.getByRole("group", { name: "Дата на посещението", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/time-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    await expect(
      page.getByRole("group", { name: "Дата на посещението", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/time-first-${width}.png`,
      fullPage: true,
    });
  });
}
