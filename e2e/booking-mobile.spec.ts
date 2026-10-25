import { expect, test } from "@playwright/test";

import { auditRenderedControls } from "./rendered-audit";

for (const width of [390, 1440]) {
  test(`${width}px wrapped recovery actions meet the control scale`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.clock.setFixedTime(new Date("2026-06-07T05:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
    await page.getByRole("checkbox", { name: /Измиване и оформяне/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    const removal = page.getByRole("button", {
      name: "Махни „Измиване и оформяне“",
    });
    expect((await removal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await removal.click();
    await page.getByRole("radio", { name: /Иван/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    await expect(
      page.getByText("Няма свободни часове за тази дата."),
    ).toBeVisible();
    const recovery = page.getByRole("button", { name: /Към .*първи час/ });
    expect((await recovery.boundingBox())!.height).toBeGreaterThanOrEqual(52);
    await recovery.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("radio", { name: "15:00", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

for (const width of [360, 390]) {
  test(`${width}px M1–M6 fit without horizontal scroll and expose 44px targets`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(message.text());
    });
    await page.goto("/");
    async function verify(screen: string) {
      const audit = await auditRenderedControls(page);
      await testInfo.attach(screen, {
        body: JSON.stringify(audit),
        contentType: "application/json",
      });
      expect(audit.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
      expect(audit.contrasts.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: `coverage/playwright/mobile-${width}-${screen}.png`,
        fullPage: true,
      });
    }
    await expect(page.getByRole("button", { name: "Продължи" })).toBeEnabled();
    await verify("M1-services");
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page.getByRole("radio", { name: "Първо дата и час" }).check();
    await verify("M2-time");
    await page.getByRole("button", { name: "Календар", exact: true }).click();
    // The popup scales in; measure settled hit areas rather than an animation frame.
    await expect
      .poll(async () =>
        (
          await auditRenderedControls(page, '[data-slot="popover-content"]')
        ).targets.filter(({ minimum44 }) => !minimum44),
      )
      .toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `coverage/playwright/mobile-calendar-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await verify("M4-staff");
    await page.getByRole("radio", { name: /Мила/ }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page.getByRole("button", { name: "Провери данните" }).click();
    await verify("M5-details-errors");
    for (const [name, value] of [
      ["Име", "Демо Клиент"],
      ["Телефон", "0888123456"],
      ["Имейл", "demo@example.com"],
    ])
      await page.getByRole("textbox", { name, exact: true }).fill(value);
    await page.getByRole("button", { name: "Провери данните" }).click();
    await verify("review");
    await page
      .getByRole("button", { name: "Потвърди демо резервация", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Демо резервацията е потвърдена",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page
        .getByRole("region", { name: "Твоето посещение" })
        .getByText("Специалист", { exact: true }),
    ).toBeHidden();
    await expect(
      page
        .getByRole("region", { name: "Твоето посещение" })
        .getByText("Дата и час", { exact: true }),
    ).toBeHidden();
    await verify("M6-success");
    expect(errors).toEqual([]);
  });
  test(`${width}px mobile summary sheet traps focus, closes with Escape and edits without losing choices`, async ({
    page,
  }) => {
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
      expect(
        await sheet.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
    const audit = await auditRenderedControls(page, '[role="dialog"]');
    expect(audit.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
    expect(audit.contrasts.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
    await page.screenshot({
      path: `coverage/playwright/mobile-summary-${width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(sheet).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await sheet
      .getByRole("button", { name: "Промени услугите", exact: true })
      .click();
    await expect(sheet).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Услуги", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("checkbox", { name: /Подстригване/ }),
    ).toBeChecked();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
