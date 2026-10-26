import { expect, test } from "@playwright/test";

test("desktop summary remains a sticky 340px rail with one native service submitter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.goto("/");
  const rail = page.getByRole("complementary", { name: "Вашата резервация" });
  await expect(rail).toHaveCSS("width", "340px");
  await expect(rail).toHaveCSS("position", "sticky");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await expect(rail).toContainText("Общо · 30 мин");
  await expect(rail).toContainText("23,00");
  const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
  await expect(next).toHaveCount(1);
  await expect(next).toHaveAttribute("form", "booking-services");
  await next.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await expect(
    page.getByRole("heading", { name: "Кога и с кого", exact: true }),
  ).toBeFocused();
  await expect(next).toBeDisabled();
  await page.getByRole("radio", { name: /Мими Ибрамова/ }).check();
  await next.click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await expect(rail).toContainText("15:00–15:30");
  await expect(rail).toContainText("Мими Ибрамова");
  await page.screenshot({
    path: "coverage/playwright/summary-rail-1280.png",
    fullPage: true,
  });
});

import { auditRenderedControls } from "./rendered-audit";

for (const width of [360, 390, 768, 1024, 1280, 1440]) {
  test(`${width}px fluid brand shell retains landmarks, gutters and skip access`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.goto("/");
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page).toHaveTitle(/Wellness Studio/);
    await expect(page.getByRole("banner")).toContainText("Wellness Studio");
    const main = page.getByRole("main");
    const gutter = width >= 1024 ? "48px" : "16px";
    await expect(main).toHaveCSS("padding-left", gutter);
    await expect(main).toHaveCSS("padding-right", gutter);
    if (width >= 1024)
      await expect(
        page.getByRole("complementary", { name: "Вашата резервация" }),
      ).toHaveCSS("width", "340px");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Към резервацията" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    const progress = page.getByRole("navigation", {
      name: "Стъпки на резервацията",
    });
    const segments = progress.getByRole("listitem");
    await expect(segments).toHaveCount(4);
    await expect(progress.locator('[aria-current="step"]')).toHaveCount(1);
    for (const [index, label] of [
      "Услуги",
      "Час и специалист",
      "Вашите данни",
      "Преглед",
    ].entries()) {
      const text = segments
        .nth(index)
        .getByText(`${index + 1}. ${label}`, { exact: true });
      if (width >= 1024) await expect(text).toHaveCSS("position", "static");
      else await expect(text).toHaveCSS("position", "absolute");
    }
    const bars = await progress
      .locator('span[aria-hidden="true"]')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { top, height } = element.getBoundingClientRect();
          return { top, height };
        }),
      );
    expect(bars).toHaveLength(4);
    expect(
      bars.every((bar) => bar.height === 4 && bar.top === bars[0].top),
    ).toBe(true);
    const mobileProgress = page.getByText("Стъпка 1 от 4 · Услуги", {
      exact: true,
    });
    if (width < 1024) await expect(mobileProgress).toBeVisible();
    else await expect(mobileProgress).toBeHidden();
    await page.screenshot({
      path: `coverage/playwright/shell-${width}.png`,
      fullPage: true,
    });
  });
  test(`${width}px route targets meet the shared 44px floor`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: /^(Продължи|Напред:)/ }),
    ).toBeEnabled();
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
    await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
    const route = await auditRenderedControls(
      page,
      '[role="radiogroup"][aria-labelledby="path-label"]',
    );
    expect(route.targets.length).toBeGreaterThan(0);
    expect(route.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
  });
  for (const path of ["staff-first", "time-first"] as const) {
    test(`${width}px ${path}: chrome navigation preserves selections and focuses headings`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      await page.goto("/");
      await expect(page.getByRole("banner")).toContainText("Wellness Studio");
      const nav = page.getByRole("navigation", {
        name: "Стъпки на резервацията",
      });
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Услуги",
      );
      await expect(nav.getByRole("link")).toHaveCount(0);
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page
        .getByRole("radio", {
          name: "Кога и с кого",
          exact: true,
        })
        .check();
      const second = "Час и специалист";
      await expect(nav.locator('[aria-current="step"]')).toContainText(second);
      await expect(nav.getByRole("link")).toHaveCount(1);
      const completedTarget = await nav.getByRole("link").boundingBox();
      expect(completedTarget?.height).toBeGreaterThanOrEqual(44);
      await nav.getByRole("link", { name: /Услуги/ }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Изберете услуги", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("checkbox", { name: /Подстригване/ }),
      ).toBeChecked();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      if (path === "staff-first") {
        await page.getByRole("radio", { name: /Павел Добранов/ }).check();
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      if (path === "time-first") {
        await page.getByRole("radio", { name: /Павел Добранов/ }).check();
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await expect(
        page.getByRole("button", { name: "Назад", exact: true }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Назад", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: "Кога и с кого",
          exact: true,
        }),
      ).toBeFocused();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page
        .getByRole("textbox", { name: "Име и фамилия", exact: true })
        .fill("Demo Chrome");
      await page
        .getByRole("textbox", { name: "Телефон", exact: true })
        .fill("0888123456");
      await page
        .getByRole("textbox", { name: "Имейл", exact: true })
        .fill("demo@example.com");
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await expect(nav.getByRole("link")).toHaveCount(2);
      await page.getByRole("button", { name: "Към преглед" }).click();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Преглед",
      );
      await expect(nav.getByRole("link")).toHaveCount(3);
      if (width < 1024) {
        await page
          .getByRole("banner")
          .getByRole("button", { name: "Назад", exact: true })
          .click();
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Вашите данни",
        );
        await expect(
          page.getByRole("heading", { name: "Данни и преглед", exact: true }),
        ).toBeFocused();
        await expect(
          page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
        ).toHaveValue("Demo Chrome");
        await page.getByRole("button", { name: "Към преглед" }).click();
      }
      await page.screenshot({
        path: `coverage/playwright/shell-review-${width}-${path}.png`,
        fullPage: true,
      });
      await nav.getByRole("link", { name: /Вашите данни/ }).click();
      await expect(
        page.getByRole("heading", { name: "Данни и преглед", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
      ).toHaveValue("Demo Chrome");
      await page.getByRole("button", { name: "Към преглед" }).click();
      for (const [label, heading] of [
        ["Промени специалиста", "Кога и с кого"],
        ["Промени датата и часа", "Кога и с кого"],
        ["Промени услугите", "Изберете услуги"],
      ]) {
        const trigger = page.getByRole("button", { name: "Виж избора" });
        if (await trigger.isVisible()) await trigger.click();
        await page.getByRole("button", { name: label, exact: true }).click();
        await expect(
          page.getByRole("heading", { name: heading, exact: true }),
        ).toBeFocused();
        for (
          let step = 0;
          step < 3 &&
          !(await page
            .getByRole("textbox", { name: "Име и фамилия", exact: true })
            .isVisible());
          step++
        )
          await page
            .getByRole("button", { name: /^(Продължи|Напред:)/ })
            .click();
        await expect(
          page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
        ).toHaveValue("Demo Chrome");
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Вашите данни",
        );
        await page.getByRole("button", { name: "Към преглед" }).click();
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Преглед",
        );
      }
      await nav.getByRole("link", { name: /Час и специалист/ }).click();
      await expect(
        page.getByRole("heading", {
          name: "Кога и с кого",
          exact: true,
        }),
      ).toBeFocused();
      await page
        .getByRole("radio", {
          name: "Кога и с кого",
          exact: true,
        })
        .check();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Час и специалист",
      );
      await expect(
        page.getByRole("button", {
          name: /^Потвърди резервация(?:та)?$/,
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await expect(
        page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
      ).toHaveValue("Demo Chrome");
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await page.getByRole("button", { name: "Към преглед" }).click();
      await expect(nav.getByRole("link")).toHaveCount(3);
      await page
        .getByRole("button", { name: "Назад към данните", exact: true })
        .click();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await expect(
        page.getByRole("textbox", { name: "Име и фамилия", exact: true }),
      ).toBeFocused();
      expect(new URL(page.url()).hash).toBe("");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    });
  }
}

for (const path of ["staff-first", "time-first"] as const) {
  for (const recovery of ["conflict", "clock", "entry-clock"] as const) {
    test(`${path}: ${recovery} leaves review and requires a fresh contact check`, async ({
      page,
    }) => {
      await page.clock.install({ time: new Date("2026-06-01T05:00:00Z") });
      if (recovery === "conflict")
        await page.addInitScript(() => {
          (
            window as Window & { __SLOTWELL_DEMO_SCENARIO__?: string }
          ).__SLOTWELL_DEMO_SCENARIO__ = "conflict";
        });
      await page.goto("/");
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      await page
        .getByRole("radio", {
          name: "Кога и с кого",
          exact: true,
        })
        .check();
      if (path === "staff-first") {
        await page.getByRole("radio", { name: /Павел Добранов/ }).check();
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      if (path === "time-first") {
        await page.getByRole("radio", { name: /Павел Добранов/ }).check();
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      const nav = page.getByRole("navigation", {
        name: "Стъпки на резервацията",
      });
      const name = page.getByRole("textbox", { name: "Име и фамилия", exact: true });
      await name.fill("Demo Recovery");
      await page
        .getByRole("textbox", { name: "Телефон", exact: true })
        .fill("0888123456");
      await page
        .getByRole("textbox", { name: "Имейл", exact: true })
        .fill("demo@example.com");
      if (recovery === "entry-clock") {
        // Move only Date.now: no interval can revalidate before the form submits.
        await page.clock.setFixedTime(new Date("2026-06-01T11:01:00Z"));
      }
      await page.getByRole("button", { name: "Към преглед" }).click();
      if (recovery !== "entry-clock")
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Преглед",
        );
      if (recovery === "clock") {
        // A valid periodic refresh must not discard the explicit review stage.
        await page.clock.fastForward(60_000);
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Преглед",
        );
        await page.clock.fastForward(6 * 60 * 60_000);
      } else if (recovery === "conflict") {
        await page
          .getByRole("button", {
            name: /^Потвърди резервация(?:та)?$/,
            exact: true,
          })
          .click();
      }
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Час и специалист",
      );
      await expect(
        page.getByRole("heading", { name: "Кога и с кого", exact: true }),
      ).toBeFocused();
      await expect(nav.getByRole("link")).toHaveCount(1);
      await expect(
        page.getByRole("button", {
          name: /^Потвърди резервация(?:та)?$/,
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("radio", { name: "16:00", exact: true }).check();
      await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      if (path === "time-first") {
        await expect(
          page.getByRole("radio", { name: /Павел Добранов/ }),
        ).toBeChecked();
        await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
      }
      await expect(name).toHaveValue("Demo Recovery");
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await page.getByRole("button", { name: "Към преглед" }).click();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Преглед",
      );
      await page.screenshot({
        path: `coverage/playwright/progress-${path}-${recovery}.png`,
        fullPage: true,
      });
    });
  }
}
