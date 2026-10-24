import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

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
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    if (path === "time-first") {
      await page.getByRole("radio", { name: "Първо дата и час" }).check();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page.getByRole("radio", { name: /Мила/ }).check();
    } else {
      await page.getByRole("radio", { name: /Мила/ }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
    }
    await page.getByRole("button", { name: "Продължи" }).click();
    const name = page.getByRole("textbox", { name: "Име", exact: true });
    const phone = page.getByRole("textbox", { name: "Телефон", exact: true });
    const email = page.getByRole("textbox", { name: "Имейл", exact: true });
    const check = page.getByRole("button", { name: "Провери данните" });
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
    await expect(note).not.toBeVisible();
    await check.click();
    await expect(name).toBeFocused();
    const errorSummary = page
      .getByRole("alert")
      .filter({ hasText: "Провери 3 полета" });
    await expect(errorSummary).toBeVisible();
    await expect(errorSummary.getByRole("link")).toHaveCount(3);
    await errorSummary.getByRole("link", { name: /Телефон/ }).click();
    await expect(phone).toBeFocused();
    await errorSummary.getByRole("link", { name: /^Име —/ }).click();
    await expect(name).toBeFocused();
    await expect(name).toHaveAccessibleDescription("Въведи име.");
    await expect(phone).toHaveAccessibleDescription(/Например 0888 123 456/);
    await page.screenshot({
      path: `coverage/playwright/details-errors-${path}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: `coverage/playwright/details-errors-${path}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.keyboard.type("  Демо Посетител  ");
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
    await phone.fill("+44 20 7946 0958");
    await check.click();
    await expect(email).toBeFocused();
    await email.fill("fictional-visitor@example.com");
    await page
      .getByText("Добави бележка (по желание)", { exact: true })
      .click();
    await note.fill("н".repeat(1001));
    await page
      .getByText("Добави бележка (по желание)", { exact: true })
      .click();
    await expect(note).not.toBeVisible();
    await check.click();
    await expect(note).toBeFocused();
    await expect(note).toHaveValue("н".repeat(1001));
    await expect(note).toHaveAccessibleDescription(/1000/);
    await note.fill("Само демонстрационна бележка.");
    await check.click();
    await expect(
      page.getByRole("status").filter({ hasText: "Данните са валидни" }),
    ).toBeVisible();
    const summary = page.getByRole("complementary", { name: "Твоят избор" });
    await expect(summary).toContainText("Подстригване");
    await expect(summary).toContainText("Мила");
    await expect(summary).toContainText("1 юни 2026");
    await expect(summary).toContainText("15:00–15:30");
    await expect(summary).toContainText("30 мин");
    await expect(summary).toContainText(/23,00\s*€/);
    await expect(summary).toContainText("измислен адрес");
    await expect(summary).not.toContainText("15:40");
    const review = page.getByRole("region", {
      name: "Преглед и потвърждение",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: "Провери и потвърди" }),
    ).toBeFocused();
    await expect(review).toContainText("fictional-visitor@example.com");
    await expect(review).toContainText(/Общо 30 мин · 23,00\s*€/);
    await expect(review).toContainText("Часът не е задържан");
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
        name: "Потвърди демо резервация",
        exact: true,
      }),
    ).toHaveCount(0);
    await name.fill("  Демо Посетител  ");
    await check.click();
    await review.getByRole("button", { name: "Назад към данните" }).click();
    await expect(name).toBeFocused();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("button", { name: "Продължи" }).click();
    await expect(name).toHaveValue("  Демо Посетител  ");
    for (const [action, heading] of [
      ["Промени услугите", "Услуги"],
      ["Промени специалиста", "Специалист"],
      ["Промени датата и часа", "Дата и час"],
    ]) {
      await summary.getByRole("button", { name: action, exact: true }).click();
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeFocused();
      for (let step = 0; step < 3 && !(await name.isVisible()); step++) {
        await page.getByRole("button", { name: "Продължи" }).click();
      }
      await expect(name).toHaveValue("  Демо Посетител  ");
      await expect(phone).toHaveValue("+44 20 7946 0958");
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
      page.getByRole("checkbox", { name: /Подстригване/ }),
    ).not.toBeChecked();
    await expect(name).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
