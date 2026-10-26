import { expect, test } from "@playwright/test";

import { auditRenderedControls } from "./rendered-audit";

test("360px booking bar owns one action and remains in flow with a short keyboard viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  const summary = page.getByRole("button", { name: /Обобщение/ });
  const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
  await expect(next).toHaveCount(1);
  await expect(summary).toContainText("Няма избрани услуги");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await expect(summary).toContainText("1 услуга · 30 мин");
  await expect(summary).toContainText("23,00");
  await next.click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await expect(next).toBeDisabled();
  await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
  await next.click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await expect(summary).toContainText("15:00");
  await next.click();
  const submit = page.getByRole("button", {
    name: "Провери данните",
    exact: true,
  });
  await expect(submit).toHaveCount(1);
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveAttribute("aria-invalid", "false");
  await expect(submit).toHaveAttribute("form", "booking-contact");
  await page.setViewportSize({ width: 360, height: 320 });
  const email = page.getByRole("textbox", { name: "Имейл", exact: true });
  await email.focus();
  await expect(email).toBeInViewport();
  await page.keyboard.type("demo@example.com");
  await page.keyboard.press("Tab");
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  await submit.click();
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL("/");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});

test("200% scaled mobile bar and long summary stay scrollable without covering focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  for (const checkbox of await page.getByRole("checkbox").all())
    await checkbox.check();
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const trigger = page.getByRole("button", { name: /Обобщение/ });
  await trigger.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await trigger.click();
  const sheet = page.getByRole("dialog", { name: "Вашата резервация" });
  await expect(sheet.getByRole("listitem")).toHaveCount(4);
  expect(
    await sheet.evaluate(
      (element) => element.scrollHeight > element.clientHeight,
    ),
  ).toBe(true);
  const footerClose = sheet
    .locator('[data-slot="sheet-footer"]')
    .getByRole("button", { name: "Затвори", exact: true });
  await footerClose.focus();
  await expect(footerClose).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.screenshot({
    path: "coverage/playwright/booking-bar-200-percent.png",
    fullPage: true,
  });
});

for (const width of [360, 390, 1280, 1440]) {
  test(`${width}px shared controls retain size and state throughout the wizard`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 940 });
    await page.clock.install({ time: new Date("2026-06-01T05:00:00Z") });
    await page.goto("/");
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    await expect(next).toBeEnabled();
    await expect(next).toHaveCSS("height", "52px");
    const service = page.getByRole("checkbox", { name: /Подстригване/ });
    await service.focus();
    await expect(service.locator("..")).not.toHaveCSS("box-shadow", "none");
    await page.keyboard.press("Space");
    await expect(service).toBeChecked();
    await next.click();
    await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    await expect(next).toBeDisabled();
    await expect(next).toHaveCSS("opacity", "0.5");
    const slot = page.getByRole("radio", { name: "15:00", exact: true });
    // The associated label is the full target; the overlaid input sits inside its border.
    await expect(slot.locator("..")).toHaveCSS("height", "48px");
    await page.keyboard.press("Tab");
    await slot.focus();
    await expect(slot.locator("..")).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await expect(slot).toBeChecked();
    await expect(slot.locator("..").locator("svg")).toBeVisible();
    const timeAudit = await auditRenderedControls(page);
    expect(timeAudit.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
    await next.click();
    await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
    await next.click();
    const name = page.getByRole("textbox", { name: "Име", exact: true });
    for (const label of ["Име", "Телефон", "Имейл"]) {
      await expect(
        page.getByRole("textbox", { name: label, exact: true }),
      ).toHaveCSS("height", "52px");
    }
    await name.focus();
    await expect(name).not.toHaveCSS("box-shadow", "none");
    const normalBorder = await name.evaluate(
      (element) => getComputedStyle(element).borderColor,
    );
    await page.getByRole("button", { name: "Провери данните" }).click();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(name).not.toHaveCSS("border-color", normalBorder);
    await page.screenshot({
      path: `coverage/playwright/control-errors-${width}.png`,
      fullPage: true,
    });
    for (const [label, value] of [
      ["Име", "Демо Клиент"],
      ["Телефон", "0888123456"],
      ["Имейл", "demo@example.com"],
    ])
      await page.getByRole("textbox", { name: label, exact: true }).fill(value);
    await page.getByRole("button", { name: "Провери данните" }).click();
    const reviewAudit = await auditRenderedControls(page);
    expect(reviewAudit.targets.filter(({ minimum44 }) => !minimum44)).toEqual(
      [],
    );
    await testInfo.attach("control-audit", {
      body: JSON.stringify({ timeAudit, reviewAudit }),
      contentType: "application/json",
    });
    // Pause the real demo confirmation timer so the pending appearance can be measured.
    await page.clock.pauseAt(new Date("2026-06-01T05:01:00Z"));
    await page
      .getByRole("button", {
        name: /^Потвърди резервация(?:та)?$/,
        exact: true,
      })
      .click();
    const pending = page.getByRole("button", {
      name: "Потвърждаваме…",
      exact: true,
    });
    await expect(pending).toBeDisabled();
    await expect(pending).toHaveCSS("height", "52px");
    await expect(pending.locator("svg")).toBeVisible();
    await page.screenshot({
      path: `coverage/playwright/control-pending-${width}.png`,
      fullPage: true,
    });
    await page.clock.runFor(300);
    await expect(
      page.getByRole("heading", {
        name: "Резервацията е потвърдена",
        exact: true,
      }),
    ).toBeFocused();
  });

  test(`${width}px wrapped recovery actions meet the control scale`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 940 });
    await page.clock.setFixedTime(new Date("2026-06-07T05:00:00Z"));
    await page.goto("/");
    await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
    await page.getByRole("checkbox", { name: /Измиване и оформяне/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await page.getByRole("radio", { name: "Специалист", exact: true }).check();
    const removal = page.getByRole("button", {
      name: "Махни „Измиване и оформяне“",
    });
    expect((await removal.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await removal.click();
    await page.getByRole("radio", { name: /Павел Добранов/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
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
    await expect(
      page.getByRole("button", { name: /^(Продължи|Напред:)/ }),
    ).toBeEnabled();
    await verify("M1-services");
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    await verify("M2-time");
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await verify("M4-staff");
    await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
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
      .getByRole("button", {
        name: /^Потвърди резервация(?:та)?$/,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Резервацията е потвърдена",
        exact: true,
      }),
    ).toBeFocused();
    await expect(
      page
        .getByRole("region", { name: "Твоето посещение" })
        .getByText("Специалист", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Твоето посещение" })
        .getByText("Дата и час", { exact: true }),
    ).toBeVisible();
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
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    const trigger = page.getByRole("button", { name: "Виж избора" });
    await trigger.click();
    const sheet = page.getByRole("dialog", { name: "Вашата резервация" });
    await expect(sheet).toContainText("Подстригване");
    await expect(sheet).toContainText("15:00–15:30");
    await expect(sheet).toContainText("Предстои — стъпка 2");
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
      page.getByRole("heading", { name: "Изберете услуги", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("checkbox", { name: /Подстригване/ }),
    ).toBeChecked();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}
