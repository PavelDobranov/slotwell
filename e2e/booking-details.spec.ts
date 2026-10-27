import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

test("multi-service review reflects an edited time and an omitted note", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.setViewportSize({ width: 1280, height: 880 });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
  await page.getByRole("checkbox", { name: /Изсушаване и оформяне/ }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("radio", { name: /Павел Добранов/ }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page
    .getByRole("textbox", { name: "Име и фамилия", exact: true })
    .fill("Демо");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("+44 20 7946 0958");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("demo@example.com");
  await page.getByRole("button", { name: "Към преглед" }).click();
  const review = page.getByRole("region", {
    name: "Преглед и потвърждение",
    exact: true,
  });
  await expect(
    review.getByRole("heading", {
      name: "Проверете и потвърдете",
      exact: true,
    }),
  ).toBeFocused();
  await expect(
    page.getByRole("complementary", { name: "Вашата резервация" }),
  ).toHaveCount(0);
  await expect(review).toHaveCSS("width", "680px");
  const services = review.getByRole("region", { name: "Услуги", exact: true });
  await expect(services.getByRole("listitem")).toHaveCount(2);
  await expect(services.getByRole("listitem").nth(0)).toContainText(
    /Мъжко подстригване\s*30 мин\s*18\s*€/,
  );
  await expect(services.getByRole("listitem").nth(1)).toContainText(
    /Изсушаване и оформяне\s*30 мин\s*15\s*€/,
  );
  await expect(review).toContainText(/Общо · 1 ч\s*33\s*€/);
  await expect(review).toContainText("15:00–16:00");
  await expect(review).not.toContainText("16:30");
  await expect(review).toContainText("Без бележка");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 880 });
    await page.screenshot({
      path: `coverage/playwright/review-multi-${width}.png`,
      fullPage: true,
    });
  }
  await review
    .getByRole("button", { name: "Промени датата и часа в прегледа" })
    .click();
  await page.getByRole("radio", { name: "16:00", exact: true }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
  ).toHaveValue("Демо");
  await expect(
    page.getByRole("button", {
      name: "Потвърди резервацията",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Към преглед" }).click();
  await expect(review).toContainText("16:00–17:00");
  await expect(review).not.toContainText("15:00–16:00");
  await expect(review).toContainText(/Общо · 1 ч\s*33\s*€/);
});

for (const path of ["staff-first", "time-first"] as const) {
  test(`${path} details validate, preserve edits and keep contacts private`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    const logs: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      logs.push(message.text());
      if (["error", "warning"].includes(message.type()))
        errors.push(message.text());
    });
    page.on("request", (request) =>
      requests.push(`${request.url()} ${request.postData() ?? ""}`),
    );
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Дамско подстригване/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await page
      .getByRole("radio", {
        name: path === "staff-first" ? "Специалист" : "Дата и час",
        exact: true,
      })
      .check();
    if (path === "time-first") {
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
    } else {
      await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
    }
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    const name = page.getByRole("textbox", {
      name: "Име и фамилия",
      exact: true,
    });
    const country = page.getByRole("combobox", {
      name: "Държава за телефона",
      exact: true,
    });
    await expect(country).toHaveValue("BG");
    const phone = page.getByRole("textbox", { name: "Телефон", exact: true });
    const email = page.getByRole("textbox", { name: "Имейл", exact: true });
    const check = page.getByRole("button", { name: "Към преглед" });
    await expect(name).toHaveAttribute("autocomplete", "name");
    await expect(phone).toHaveAttribute("type", "tel");
    await expect(phone).toHaveAttribute("inputmode", "tel");
    await expect(phone).toHaveAttribute("autocomplete", "tel");
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("inputmode", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    const note = page.getByRole("textbox", { name: /Бележка/ });
    expect(
      await check.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    for (const control of [name, phone, email]) {
      expect(
        await control.evaluate(
          (element) => element.getBoundingClientRect().height,
        ),
      ).toBe(52);
    }
    await expect(note).toBeVisible();
    await expect(page.getByText("0 / 1000", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Вашите данни", exact: true }),
    ).toBeVisible();
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 880 });
      await expect(name).toBeVisible();
      await expect(phone).toBeVisible();
      await expect(email).toBeVisible();
      await expect(note).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1280, height: 880 });
    await expect(check).toHaveCSS("width", "260px");
    await expect(name).toBeVisible();
    await page.screenshot({
      path: `coverage/playwright/details-empty-${path}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await check.click();
    await expect(name).toBeFocused();
    const errorSummary = page
      .getByRole("alert")
      .filter({ hasText: "Проверете 3 полета" });
    await expect(errorSummary).toBeVisible();
    await expect(errorSummary.getByRole("link")).toHaveCount(3);
    await errorSummary.getByRole("link", { name: /Телефон/ }).click();
    await expect(phone).toBeFocused();
    await errorSummary.getByRole("link", { name: /^Име:/ }).click();
    await expect(name).toBeFocused();
    await expect(name).toHaveAccessibleDescription("Въведете име.");
    await expect(phone).toHaveAccessibleDescription(/Напр. 088 123 4567/);
    await page.screenshot({
      path: `coverage/playwright/details-errors-${path}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 880 });
    await expect(check).toHaveCSS("width", "260px");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `coverage/playwright/details-errors-${path}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.keyboard.type("  Демо Посетител  ");
    await page.keyboard.press("Tab");
    await expect(country).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(phone).toBeFocused();
    await page.keyboard.type("invalid-phone");
    await page.keyboard.press("Tab");
    await expect(email).toBeFocused();
    await page.keyboard.type("invalid-email");
    await page.keyboard.press("Enter");
    await expect(phone).toBeFocused();
    await expect(phone).toHaveAttribute("aria-invalid", "true");
    await expect(phone).toHaveValue("invalid-phone");
    await phone.fill("020 7946 0958");
    await country.selectOption("GB");
    await check.click();
    await expect(email).toBeFocused();
    await expect(country).toHaveValue("GB");
    await expect(phone).toHaveValue("020 7946 0958");
    // An explicit international prefix wins over the selected national country.
    await country.selectOption("BG");
    await phone.fill("+44 20 7946 0958");
    await email.fill("fictional-visitor@example.com");
    await note.fill("н".repeat(1001));
    await check.click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue("н".repeat(1001));
    await expect(note).toHaveAccessibleDescription(/1000/);
    await note.fill("н".repeat(1000));
    await check.click();
    await page
      .getByRole("button", { name: "Редактирай данните за контакт" })
      .click();
    await expect(note).toHaveValue("н".repeat(1000));
    await country.selectOption("GB");
    await note.fill("Само демонстрационна бележка.");
    await expect(page.getByText("29 / 1000", { exact: true })).toBeVisible();
    await check.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Данните са валидни" }),
    ).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Вашата резервация" }),
    ).toHaveCount(0);
    const review = page.getByRole("region", {
      name: "Преглед и потвърждение",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: "Проверете и потвърдете" }),
    ).toBeFocused();
    for (const text of [
      "Дамско подстригване",
      "Мими Ибрамова",
      "пн, 1 юни",
      "15:00–15:45",
      "ул. „Шипка“ 18",
      "Само демонстрационна бележка.",
    ]) {
      await expect(review).toContainText(text);
    }
    await expect(
      page.getByRole("button", {
        name: "Потвърди резервацията",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(review).toContainText("fictional-visitor@example.com");
    await expect(review).toContainText(/Общо · 45 мин\s*28\s*€/);
    await expect(review).toContainText(
      "Часът се запазва едва когато натиснете",
    );
    await expect(review).toContainText(
      "Плащането е на място — онлайн не плащате нищо.",
    );
    await page.setViewportSize({ width: 1280, height: 880 });
    const cards = review.locator('[data-slot="card"]');
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      await expect(card).toHaveCSS("width", "680px");
    }
    const contacts = review.getByRole("region", {
      name: "Контакти",
      exact: true,
    });
    const total = review.getByText("Общо · 45 мин", { exact: true });
    const confirm = review.getByRole("button", {
      name: "Потвърди резервацията",
      exact: true,
    });
    expect(
      await total.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeLessThan(
      await contacts.evaluate((element) => element.getBoundingClientRect().top),
    );
    expect(
      await confirm.evaluate((element) => element.getBoundingClientRect().top),
    ).toBeGreaterThan(
      await cards
        .last()
        .evaluate((element) => element.getBoundingClientRect().bottom),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `coverage/playwright/review-${path}-desktop-top.png`,
    });
    await confirm.scrollIntoViewIfNeeded();
    await expect(page.getByRole("banner")).toBeInViewport();
    await page.screenshot({
      path: `coverage/playwright/review-${path}-desktop-bottom.png`,
    });
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `coverage/playwright/review-${path}-${width}.png`,
        fullPage: true,
      });
    }
    await page.setViewportSize({ width: 360, height: 800 });
    for (const [action, heading] of [
      ["Промени услугите в прегледа", "Изберете услуги"],
      ["Промени специалиста в прегледа", "Кога и с кого"],
      ["Промени датата и часа в прегледа", "Кога и с кого"],
    ]) {
      await review.getByRole("button", { name: action, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeFocused();
      for (let step = 0; step < 3 && !(await name.isVisible()); step++) {
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await expect(name).toHaveValue("  Демо Посетител  ");
      await expect(country).toHaveValue("GB");
      await expect(note).toHaveValue("Само демонстрационна бележка.");
      await check.click();
    }
    await review
      .getByRole("button", { name: "Редактирай данните за контакт" })
      .click();
    await expect(name).toBeFocused();
    await expect(note).toHaveValue("Само демонстрационна бележка.");
    await name.fill("");
    await check.click();
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", {
        name: "Потвърди резервацията",
        exact: true,
      }),
    ).toHaveCount(0);
    await name.fill("  Демо Посетител  ");
    await check.click();
    await review.getByRole("button", { name: "Назад към данните" }).click();
    await expect(name).toBeFocused();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await expect(name).toHaveValue("  Демо Посетител  ");
    for (const [action, heading] of [
      ["Промени услугите", "Изберете услуги"],
      ["Промени специалиста", "Кога и с кого"],
      ["Промени датата и часа", "Кога и с кого"],
    ]) {
      const trigger = page.getByRole("button", {
        name: "Обобщение — Виж избора",
      });
      if (await trigger.isVisible()) await trigger.click();
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeFocused();
      for (let step = 0; step < 3 && !(await name.isVisible()); step++) {
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await expect(name).toHaveValue("  Демо Посетител  ");
      await expect(phone).toHaveValue("+44 20 7946 0958");
      await expect(country).toHaveValue("GB");
      await expect(email).toHaveValue("fictional-visitor@example.com");
      await expect(note).toHaveValue("Само демонстрационна бележка.");
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: `coverage/playwright/details-${path}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `coverage/playwright/details-${path}-mobile.png`,
      fullPage: true,
    });
    // Inspect only app-owned storage keys in this isolated test context.
    expect(
      await page.evaluate(() => ({
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      })),
    ).toEqual({ local: [], session: [] });
    for (const marker of [
      "Демо Посетител",
      "+44 20 7946 0958",
      "fictional-visitor@example.com",
      "Само демонстрационна бележка.",
    ]) {
      expect(decodeURIComponent(requests.join("\n"))).not.toContain(marker);
      expect(logs.join("\n")).not.toContain(marker);
      expect(decodeURIComponent(page.url())).not.toContain(marker);
    }
    expect(
      requests.filter(
        (request) => !request.startsWith("http://127.0.0.1:3100/"),
      ),
    ).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Дамско подстригване/ }),
    ).not.toBeChecked();
    await expect(name).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
