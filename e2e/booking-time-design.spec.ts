import { expect, test } from "@playwright/test";

for (const width of [320, 768, 1024, 1280, 1440]) {
  test(`reference time step fits ${width}px and retains selection and paging`, async ({ page }) => {
    await page.setViewportSize({ width, height: 880 });
    await page.clock.setFixedTime(new Date("2026-10-24T09:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    await next.click();
    const dates = page.getByRole("group", { name: "Дата на посещението", exact: true });
    const today = dates.getByRole("radio").first().locator("..");
    await expect(today.locator("svg")).toHaveCount(0);
    await expect(today).toContainText("сб");
    const previous = page.getByRole("button", { name: "Предишни дни" });
    await expect(previous).toHaveCSS("height", "72px");
    await expect(previous).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const slot = page.getByRole("radio", { name: "13:00", exact: true });
    await expect(slot.locator("..")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(next).toBeDisabled();
    await page.screenshot({ path: `coverage/playwright/time-design-${width}.png`, fullPage: true });
    await slot.check();
    await expect(next).toBeEnabled();
    await page.getByRole("button", { name: "Следващи дни" }).click();
    await expect(slot).toBeChecked();
    await previous.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await next.click();
    await expect(page.getByRole("group", { name: "Избери специалист" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
