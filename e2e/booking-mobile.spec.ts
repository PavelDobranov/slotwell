import { expect, test } from "@playwright/test";

for (const width of [360, 390]) {
  test(`${width}px mobile summary sheet traps focus, closes with Escape and edits without losing choices`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page.getByRole("radio", { name: "Първо дата и час" }).check();
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    const trigger = page.getByRole("button", { name: "Виж избора" });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Твоят избор" });
    await expect(sheet).toContainText("Подстригване");
    await expect(sheet).toContainText("15:00–15:30");
    await expect(sheet).toContainText("Предстои — стъпка 3");
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({ path: `coverage/playwright/mobile-summary-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await sheet.getByRole("button", { name: "Промени услугите", exact: true }).click();
    await expect(sheet).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Услуги", exact: true })).toBeFocused();
    await expect(page.getByRole("checkbox", { name: /Подстригване/ })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
