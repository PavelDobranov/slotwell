import { expect, test } from "@playwright/test";

import { auditRenderedControls } from "./rendered-audit";

for (const width of [360, 1440]) {
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
      const second = path === "staff-first" ? "Специалист" : "Дата и час";
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
      await page
        .getByRole("textbox", { name: "Име", exact: true })
        .fill("Demo Chrome");
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
      }
      await expect(nav.getByRole("link")).toHaveCount(3);
      expect(new URL(page.url()).hash).toBe("");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    });
  }
}
