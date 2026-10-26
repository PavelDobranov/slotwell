import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`summary has one consistent design across steps at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 880 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
    await page.getByRole("checkbox", { name: /Изсушаване и оформяне/ }).check();
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    const designs: string[] = [];
    async function checkSummary(step: string, review = false) {
      if (width < 1024 && !review) {
        await page
          .getByRole("button", { name: "Обобщение — Виж избора" })
          .click();
      }
      const container = review
        ? page.getByRole("region", {
            name: "Преглед и потвърждение",
            exact: true,
          })
        : width < 1024
          ? page.getByRole("dialog")
          : page.getByRole("complementary");
      const card = container.locator('[data-slot="card"]').first();
      await expect(card).toContainText("Вашата резервация");
      await expect(card).toContainText(/Общо · 1 ч\s*33\s*€/);
      await expect(card).toContainText("Плащане на място в салона.");
      const items = card.getByRole("listitem");
      await expect(items).toHaveCount(2);
      for (const item of await items.all()) {
        await expect(item).toContainText("30 мин");
        const positions = await item.evaluate((element) =>
          Array.from(
            element.children,
            (child) => child.getBoundingClientRect().top,
          ),
        );
        expect(positions[1]).toBe(positions[0]);
      }
      designs.push(
        await card.evaluate((el) => {
          const style = getComputedStyle(el);
          return [
            style.fontSize,
            style.lineHeight,
            style.borderRadius,
            style.paddingTop,
          ].join("|");
        }),
      );
      await card.screenshot({
        path: `coverage/playwright/summary-${step}-${width}.png`,
      });
      if (width < 1024 && !review)
        await page
          .getByRole("button", { name: "Затвори", exact: true })
          .first()
          .click();
    }
    await checkSummary("services");
    await next.click();
    await checkSummary("time");
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    await next.click();
    await checkSummary("staff");
    await page.getByRole("radio", { name: /Павел Добранов/ }).check();
    await next.click();
    await checkSummary("details");
    await page
      .getByRole("textbox", { name: "Име и фамилия", exact: true })
      .fill("Демо");
    await page
      .getByRole("textbox", { name: "Телефон", exact: true })
      .fill("0888123456");
    await page
      .getByRole("textbox", { name: "Имейл", exact: true })
      .fill("demo@example.com");
    await page.getByRole("button", { name: "Към преглед" }).click();
    await checkSummary("review", true);
    expect(new Set(designs).size).toBe(1);
  });
}
