import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`specialist rows and S3 quick fixes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
    await page.getByRole("checkbox", { name: /Измиване и оформяне/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    const group = page.getByRole("group", { name: "Избери специалист" });
    await expect(group.getByRole("radio")).toHaveCount(3);
    for (const radio of await group.getByRole("radio").all()) {
      await expect(radio).toBeDisabled();
      await expect(radio).not.toBeChecked();
    }
    const alert = page
      .getByRole("alert")
      .filter({ hasText: "Никой специалист" });
    await expect(alert).toHaveAttribute("data-variant", "warning");
    await expect(
      alert.getByRole("button", { name: "Махни „Оформяне на брада“" }),
    ).toBeVisible();
    await expect(
      alert.getByRole("button", { name: "Към услугите" }),
    ).toBeVisible();
    await page.screenshot({
      path: `coverage/playwright/specialist-s3-${width}.png`,
      fullPage: true,
    });
    await alert
      .getByRole("button", { name: "Махни „Измиване и оформяне“" })
      .click();
    await expect(alert).toHaveCount(0);
    const ivan = group.getByRole("radio", { name: /Иван/ });
    const mila = group.getByRole("radio", { name: /Мила/ });
    await expect(ivan).toBeEnabled();
    await expect(ivan).not.toBeChecked();
    await expect(mila).toBeDisabled();
    await expect(mila).toHaveAccessibleDescription(
      /Не прави: Оформяне на брада/,
    );
    await expect(
      page.getByRole("button", { name: "Продължи", exact: true }),
    ).toBeDisabled();
    // The entire row, including the name, activates its radio.
    await group.getByText("Иван — демо специалист", { exact: true }).click();
    await expect(ivan).toBeChecked();
    await expect(ivan.locator("..")).toHaveAttribute("data-checked", "true");
    await expect(
      page.getByRole("button", { name: "Продължи", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/specialist-d2-${width}.png`,
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
