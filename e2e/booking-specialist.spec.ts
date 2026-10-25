import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  for (const timeFirst of [true, false]) {
    test(`chosen-first recap edits and preserves both selections (${timeFirst ? "time" : "staff"}-first, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 940 });
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto("/");
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (!timeFirst)
        await page
          .getByRole("radio", { name: "Специалист", exact: true })
          .check();
      const recap = page.getByRole("region", { name: "Първият ти избор" });
      const time = page.getByRole("radio", { name: "15:00", exact: true });
      const staff = page.getByRole("radio", { name: /Мила/ });
      await expect(recap).toHaveCount(0);
      await (timeFirst ? time : staff).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await expect(recap).toContainText(
        timeFirst ? "Избран час" : "Избран специалист",
      );
      await expect(recap).toContainText(timeFirst ? "15:00–15:30" : "Мила");
      if (timeFirst) await expect(recap).toContainText("1 юни 2026");
      await (timeFirst ? staff : time).check();
      await page.screenshot({
        path: `coverage/playwright/specialist-recap-${timeFirst ? "time" : "staff"}-${width}.png`,
        fullPage: true,
      });
      await recap.getByRole("button", { name: "Промени", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: timeFirst ? "Дата и час" : "Специалист",
          exact: true,
        }),
      ).toBeFocused();
      await expect(recap).toHaveCount(0);
      await expect(timeFirst ? time : staff).toBeChecked();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await expect(timeFirst ? staff : time).toBeChecked();
      // Switching order keeps both still-valid selections and reverses the recap.
      await page
        .getByRole("radio", {
          name: timeFirst ? "Специалист" : "Дата и час",
          exact: true,
        })
        .check();
      await expect(recap).toHaveCount(0);
      await expect(timeFirst ? staff : time).toBeChecked();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await expect(timeFirst ? time : staff).toBeChecked();
      await expect(recap).toContainText(
        timeFirst ? "Избран специалист" : "Избран час",
      );
      await expect(recap).toContainText(timeFirst ? "Мила" : "15:00–15:30");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Име", exact: true }),
      ).toBeVisible();
      await expect(recap).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}

test("time-first cards distinguish availability from qualification without auto-selecting the only eligible specialist", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 940 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  await page.getByRole("button", { name: "Следващите 7 дни" }).click();
  await page.getByRole("radio", { name: /8 юни 2026/ }).check();
  // Mila's cleanup would overlap her 10:00 occupied interval.
  await page.getByRole("radio", { name: "09:30", exact: true }).check();
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  const group = page.getByRole("group", { name: "Избери специалист" });
  const mila = group.getByRole("radio", { name: /Мила/ });
  const ivan = group.getByRole("radio", { name: /Иван/ });
  const elena = group.getByRole("radio", { name: /Елена/ });
  await expect(mila).toBeDisabled();
  await expect(mila).toHaveAccessibleDescription(
    /Не е свободен за цялото посещение/,
  );
  await expect(elena).toBeDisabled();
  await expect(elena).toHaveAccessibleDescription(/Не прави: Подстригване/);
  await expect(ivan).toBeEnabled();
  await expect(ivan).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Продължи", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "coverage/playwright/specialist-time-first-unavailable.png",
    fullPage: true,
  });
  // Keyboard activation remains explicit even when only one specialist is eligible.
  await ivan.focus();
  await ivan.press("Space");
  await expect(ivan).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Продължи", exact: true }),
  ).toBeEnabled();
});

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
    await page
      .getByRole("radio", { name: "Специалист", exact: true })
      .check();
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
    await group.getByText("Иван", { exact: true }).click();
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
