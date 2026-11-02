import { expect, test } from "@playwright/test";

// Current demo controls, independently of the retained historical selector debt.
// No captures or contact/network dumps: these journeys exercise only the demo.
test.use({
  timezoneId: "America/New_York",
  screenshot: "off",
  trace: "off",
  video: "off",
});

for (const path of ["staff-first", "time-first"] as const) {
  test(`${path}: context preserves review edits and recovers focus after minute revalidation`, async ({
    page,
  }) => {
    let errors = 0;
    page.on("pageerror", () => errors++);
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.setViewportSize({
      width: path === "time-first" ? 390 : 1280,
      height: 900,
    });
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
    const next = () =>
      page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await next();
    await page
      .getByRole("radio", {
        name: path === "staff-first" ? "Специалист" : "Дата и час",
        exact: true,
      })
      .check();
    if (path === "staff-first") {
      await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
      await next();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
    } else {
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await next();
      await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
    }
    await next();
    await page
      .getByRole("textbox", { name: "Име и фамилия", exact: true })
      .fill("Демо Проверка");
    await page
      .getByRole("textbox", { name: "Телефон", exact: true })
      .fill("0888123456");
    await page
      .getByRole("textbox", { name: "Имейл", exact: true })
      .fill("demo@example.com");
    await page.getByRole("button", { name: "Към преглед" }).click();
    const review = page.getByRole("region", {
      name: "Преглед и потвърждение",
      exact: true,
    });
    await expect(review).toBeVisible();
    await page
      .getByRole("button", {
        name:
          path === "staff-first" ? "Редактирай данните за контакт" : "Назад",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Телефон", exact: true }),
    ).toHaveValue("0888123456");
    await page.getByRole("textbox", { name: /Бележка/ }).fill("Демо промяна");
    await page.getByRole("button", { name: "Към преглед" }).click();
    await expect(review).toContainText("Демо промяна");
    await page.clock.setFixedTime(new Date("2026-06-01T11:30:00Z"));
    await page.clock.runFor(60_000);
    await expect(review).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Кога и с кого", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("radio", { name: "15:00", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "16:00", exact: true }).check();
    await next();
    if (path === "time-first") {
      await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
      await next();
    }
    await expect(
      page.getByRole("textbox", { name: "Телефон", exact: true }),
    ).toHaveValue("0888123456");
    await expect(page.getByRole("textbox", { name: /Бележка/ })).toHaveValue(
      "Демо промяна",
    );
    await expect(review).toHaveCount(0);
    await page.getByRole("button", { name: "Към преглед" }).click();
    await expect(review).toContainText("16:00–16:30");
    expect(errors).toBe(0);
  });
}
