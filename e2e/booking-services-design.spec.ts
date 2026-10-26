import { expect, test } from "@playwright/test";

for (const width of [320, 768, 1024, 1280, 1440]) {
  test(`reference services fit ${width}px with live totals and keyboard selection`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 880 });
    await page.clock.setFixedTime(new Date("2026-10-24T09:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const women = page.getByRole("checkbox", { name: /Дамско подстригване/ });
    const men = page.getByRole("checkbox", { name: /Мъжко подстригване/ });
    const card = women.locator("..");
    await expect(card).toContainText("28 €");
    await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(women).toHaveCSS("border-radius", "6px");
    await expect(women).toHaveCSS("border-color", "rgb(123, 136, 127)");
    await women.focus();
    await page.keyboard.press("Space");
    await expect(women).toBeChecked();
    await men.check();
    await expect(card).toHaveCSS("background-color", "rgb(241, 247, 244)");
    await expect(card).toHaveCSS("border-color", "rgb(29, 92, 77)");
    const summary = page.getByRole("complementary");
    if (width >= 1024) {
      await expect(summary).toContainText("Общо · 1 ч 15 мин");
      await expect(summary).toContainText("46 €");
      await expect(summary).toContainText("Не е избран");
      await expect(
        summary.getByRole("button", { name: /^Промени/ }),
      ).toHaveCount(0);
      const railBox = await summary.boundingBox();
      const contentBox = await page
        .locator('section[aria-labelledby="step-heading"]')
        .boundingBox();
      expect((contentBox?.width ?? 0) / (railBox?.width ?? 1)).toBeCloseTo(
        1.85,
        2,
      );
      expect((await card.boundingBox())?.height).toBeGreaterThanOrEqual(68);
    }
    await page.screenshot({
      path: `coverage/playwright/services-design-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await women.uncheck();
    const next = page.getByRole("button", { name: "Продължи", exact: true });
    await next.click();
    await expect(
      page.getByRole("heading", { name: "Кога и с кого", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await expect(men).toBeChecked();
    await expect(women).not.toBeChecked();
    await men.uncheck();
    await next.click();
    await expect(
      page.getByRole("group", { name: "Услуги", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText("Изберете поне една услуга", { exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("variable-price services retain an honest lower-bound total", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 880 });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Кератинова терапия/ }).check();
  const summary = page.getByRole("complementary");
  const total = summary.locator('[data-slot="card"] [aria-live="polite"]');
  await expect(total.getByText("на място", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /Дамско подстригване/ }).check();
  await expect(total).toContainText("от 28 €");
  await expect(total).toContainText("Общо · 2 ч 15 мин");
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Кога и с кого", exact: true }),
  ).toBeVisible();
  await expect(total).toContainText(/от 28,00\s*€/);
});
