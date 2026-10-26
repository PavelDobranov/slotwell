import { expect, test } from "@playwright/test";

for (const width of [320, 768, 1024, 1280, 1440]) {
  test(`reference time step fits ${width}px and retains selection and paging`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 880 });
    await page.clock.setFixedTime(new Date("2026-10-24T09:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    await next.click();
    const dates = page.getByRole("group", {
      name: "Дата на посещението",
      exact: true,
    });
    const today = dates.getByRole("radio").first().locator("..");
    await expect(today.locator("svg")).toHaveCount(0);
    await expect(today).toContainText("сб");
    const previous = page.getByRole("button", { name: "Предишни дни" });
    await expect(previous).toHaveCSS("height", "72px");
    await expect(previous).toHaveCSS("background-color", "rgb(255, 255, 255)");
    const slot = page.getByRole("radio", { name: "13:00", exact: true });
    await expect(slot.locator("..")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await expect(next).toBeDisabled();
    if (width >= 1024) {
      const rail = page.getByRole("complementary");
      await expect(rail).toContainText("Не е избран");
      await expect(rail.getByRole("button", { name: /^Промени/ })).toHaveCount(
        3,
      );
      const railBox = await rail.boundingBox();
      const contentBox = await page
        .locator('section[aria-labelledby="step-heading"]')
        .boundingBox();
      expect((contentBox?.width ?? 0) / (railBox?.width ?? 1)).toBeCloseTo(
        1.85,
        2,
      );
      const backBox = await page
        .getByRole("button", { name: "Назад", exact: true })
        .boundingBox();
      const nextBox = await next.boundingBox();
      expect(backBox?.y).toBe(nextBox?.y);
    }
    await page.screenshot({
      path: `coverage/playwright/time-design-${width}.png`,
      fullPage: true,
    });
    await slot.check();
    for (const control of [today, slot.locator("..")]) {
      await expect(control).toHaveCSS("background-color", "rgb(29, 92, 77)");
      await expect(control).toHaveCSS("color", "rgb(255, 255, 255)");
    }
    await page.screenshot({
      path: `coverage/playwright/time-design-selected-${width}.png`,
      fullPage: true,
    });
    await expect(next).toBeEnabled();
    await page.getByRole("button", { name: "Следващи дни" }).click();
    await expect(slot).toBeChecked();
    await previous.click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await next.click();
    await expect(
      page.getByRole("group", { name: "Избери специалист" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

for (const selected of [false, true]) {
  test(`summary edits preserve services with a ${selected ? "selected" : "pending"} time`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 880 });
    await page.clock.setFixedTime(new Date("2026-10-24T09:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    if (selected)
      await page.getByRole("radio", { name: "13:00", exact: true }).check();
    const summary = page.getByRole("complementary");
    await summary
      .getByRole("button", { name: "Промени датата и часа" })
      .click();
    await expect(page.locator("#step-heading")).toBeFocused();
    await summary.getByRole("button", { name: "Промени специалиста" }).click();
    await expect(
      page.getByRole("group", { name: "Избери специалист" }),
    ).toBeVisible();
    await expect(summary).toContainText("Мъжко подстригване");
    if (selected) await expect(summary).toContainText("13:00–13:30");
    else
      await expect(
        page.getByRole("radio", { name: "Специалист", exact: true }),
      ).toBeChecked();
    await summary.getByRole("button", { name: "Промени услугите" }).click();
    await expect(
      page.getByRole("checkbox", { name: /Мъжко подстригване/ }),
    ).toBeChecked();
  });
}
