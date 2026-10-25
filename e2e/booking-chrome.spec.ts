import { expect, test } from "@playwright/test";

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
    await expect(page).toHaveTitle(/Ателие Мента/);
    await expect(page.getByRole("banner")).toContainText("Ателие Мента");
    await expect(page.getByRole("banner")).toContainText(
      "Демо версия — не се създава реална резервация.",
    );
    await expect(page.getByRole("contentinfo")).toContainText(
      "Данните се пазят само докато страницата е отворена.",
    );
    const main = page.getByRole("main");
    const gutter = width >= 1024 ? "48px" : "16px";
    await expect(main).toHaveCSS("padding-left", gutter);
    await expect(main).toHaveCSS("padding-right", gutter);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Към резервацията" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(main).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.getByRole("contentinfo").scrollIntoViewIfNeeded();
    await expect(page.getByRole("contentinfo")).toBeInViewport();
    await page.screenshot({
      path: `coverage/playwright/shell-${width}.png`,
      fullPage: true,
    });
  });
  test(`${width}px calendar and route targets meet the shared 44px floor`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Продължи", exact: true }),
    ).toBeEnabled();
    const route = await auditRenderedControls(
      page,
      '[data-slot="toggle-group"]',
    );
    expect(route.targets.length).toBeGreaterThan(0);
    expect(route.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await page.getByRole("button", { name: "Продължи", exact: true }).click();
    await page
      .getByRole("radio", { name: "Първо дата и час", exact: true })
      .check();
    await page.getByRole("button", { name: "Календар", exact: true }).click();
    const popup = page.locator('[data-slot="popover-content"]');
    await expect
      .poll(async () =>
        (
          await auditRenderedControls(page, '[data-slot="popover-content"]')
        ).targets.filter(({ minimum44 }) => !minimum44),
      )
      .toEqual([]);
    const bounds = await popup.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await popup.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Календар", exact: true }),
    ).toBeFocused();
  });
  for (const path of ["staff-first", "time-first"] as const) {
    test(`${width}px ${path}: chrome navigation preserves selections and focuses headings`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      await page.goto("/");
      await expect(page.getByRole("banner")).toContainText("Демо");
      const nav = page.getByRole("navigation", {
        name: "Стъпки на резервацията",
      });
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Услуги",
      );
      await expect(nav.getByRole("link")).toHaveCount(0);
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "time-first")
        await page
          .getByRole("radio", { name: "Първо дата и час", exact: true })
          .check();
      const second = "Час и специалист";
      await expect(nav.locator('[aria-current="step"]')).toContainText(second);
      await expect(nav.getByRole("link")).toHaveCount(1);
      await nav.getByRole("link", { name: /Услуги/ }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("heading", { name: "Услуги", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("checkbox", { name: /Подстригване/ }),
      ).toBeChecked();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "staff-first") {
        await page.getByRole("radio", { name: /Иван/ }).check();
        await page
          .getByRole("button", { name: "Продължи", exact: true })
          .click();
      }
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "time-first") {
        await page.getByRole("radio", { name: /Иван/ }).check();
        await page
          .getByRole("button", { name: "Продължи", exact: true })
          .click();
      }
      await expect(
        page.getByRole("button", { name: "Назад", exact: true }),
      ).toHaveCount(1);
      await page.getByRole("button", { name: "Назад", exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: path === "staff-first" ? "Дата и час" : "Специалист",
          exact: true,
        }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Име", exact: true })
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
      await page.getByRole("button", { name: "Провери данните" }).click();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Преглед",
      );
      await expect(nav.getByRole("link")).toHaveCount(3);
      await nav.getByRole("link", { name: /Вашите данни/ }).click();
      await expect(
        page.getByRole("heading", { name: "Данни и преглед", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("textbox", { name: "Име", exact: true }),
      ).toHaveValue("Demo Chrome");
      await page.getByRole("button", { name: "Провери данните" }).click();
      for (const [label, heading] of [
        ["Промени специалиста", "Специалист"],
        ["Промени датата и часа", "Дата и час"],
        ["Промени услугите", "Услуги"],
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
            .getByRole("textbox", { name: "Име", exact: true })
            .isVisible());
          step++
        )
          await page
            .getByRole("button", { name: "Продължи", exact: true })
            .click();
        await expect(
          page.getByRole("textbox", { name: "Име", exact: true }),
        ).toHaveValue("Demo Chrome");
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Вашите данни",
        );
        await page.getByRole("button", { name: "Провери данните" }).click();
        await expect(nav.locator('[aria-current="step"]')).toContainText(
          "Преглед",
        );
      }
      await page
        .getByRole("radio", {
          name:
            path === "staff-first" ? "Първо дата и час" : "Първо специалист",
          exact: true,
        })
        .check();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Час и специалист",
      );
      await expect(
        page.getByRole("button", {
          name: "Потвърди демо резервация",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "Име", exact: true }),
      ).toHaveValue("Demo Chrome");
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await page.getByRole("button", { name: "Провери данните" }).click();
      await expect(nav.getByRole("link")).toHaveCount(3);
      await page
        .getByRole("button", { name: "Назад към данните", exact: true })
        .click();
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await expect(
        page.getByRole("textbox", { name: "Име", exact: true }),
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
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "time-first")
        await page
          .getByRole("radio", { name: "Първо дата и час", exact: true })
          .check();
      if (path === "staff-first") {
        await page.getByRole("radio", { name: /Иван/ }).check();
        await page
          .getByRole("button", { name: "Продължи", exact: true })
          .click();
      }
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "time-first") {
        await page.getByRole("radio", { name: /Иван/ }).check();
        await page
          .getByRole("button", { name: "Продължи", exact: true })
          .click();
      }
      const nav = page.getByRole("navigation", {
        name: "Стъпки на резервацията",
      });
      const name = page.getByRole("textbox", { name: "Име", exact: true });
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
      await page.getByRole("button", { name: "Провери данните" }).click();
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
            name: "Потвърди демо резервация",
            exact: true,
          })
          .click();
      }
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Час и специалист",
      );
      await expect(
        page.getByRole("heading", { name: "Дата и час", exact: true }),
      ).toBeFocused();
      await expect(nav.getByRole("link")).toHaveCount(1);
      await expect(
        page.getByRole("button", {
          name: "Потвърди демо резервация",
          exact: true,
        }),
      ).toHaveCount(0);
      await page.getByRole("radio", { name: "16:00", exact: true }).check();
      await page.getByRole("button", { name: "Продължи", exact: true }).click();
      if (path === "time-first") {
        await expect(page.getByRole("radio", { name: /Иван/ })).toBeChecked();
        await page
          .getByRole("button", { name: "Продължи", exact: true })
          .click();
      }
      await expect(name).toHaveValue("Demo Recovery");
      await expect(nav.locator('[aria-current="step"]')).toContainText(
        "Вашите данни",
      );
      await page.getByRole("button", { name: "Провери данните" }).click();
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
