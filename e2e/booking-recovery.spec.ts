import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TimeStep } from "@/app/_components/booking/time-step";
import { createDemoSalon } from "@/app/_lib/booking/fixtures";

test("path switches preserve valid choices and service edits explain only invalidated choices", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("radio", { name: "Специалист", exact: true }).check();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Демо Клиент");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("0888123456");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("demo@example.com");
  await page.getByRole("button", { name: "Виж избора" }).click();
  await page
    .getByRole("button", { name: "Промени датата и часа", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Кога и с кого", exact: true }),
  ).toBeFocused();
  await page.getByRole("radio", { name: "Дата и час", exact: true }).check();
  const preserved = page
    .getByRole("status")
    .filter({ hasText: "Запазихме избора ти" });
  await expect(preserved).toContainText("15:00");
  await expect(preserved).toContainText("Мила");
  await expect(preserved).toHaveAttribute("data-variant", "info");
  await expect(preserved).toHaveAttribute("aria-atomic", "true");
  await expect(preserved).not.toContainText("demo@example.com");
  await expect(
    page.getByRole("radio", { name: "15:00", exact: true }),
  ).toBeChecked();
  await page.screenshot({
    path: "coverage/playwright/recovery-path-switch.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await expect(page.getByRole("radio", { name: /Мила/ })).toBeChecked();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("button", { name: "Виж избора" }).click();
  await page
    .getByRole("button", { name: "Промени услугите", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
  const invalidated = page
    .getByRole("alert")
    .filter({ hasText: "Изборът е променен" });
  await expect(invalidated).toContainText("специалист е премахнат");
  await expect(invalidated).toContainText("Данните ти за контакт са запазени");
  await expect(invalidated).toContainText("15:00 остава");
  await expect(invalidated).toHaveAttribute("data-variant", "warning");
  await expect(invalidated).toHaveAttribute("aria-atomic", "true");
  for (const contact of ["Демо Клиент", "0888123456", "demo@example.com"])
    await expect(invalidated).not.toContainText(contact);
  // The time is still valid with Ivan: only Mila must be cleared.
  const summary = page.getByRole("complementary", {
    name: "Вашата резервация",
  });
  await expect(summary).toContainText("15:00–15:50");
  await expect(summary).not.toContainText("Мила");
  await page.screenshot({
    path: "coverage/playwright/recovery-invalidation.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await expect(
    page.getByRole("radio", { name: "15:00", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  for (const [name, value] of [
    ["Име", "Демо Клиент"],
    ["Телефон", "0888123456"],
    ["Имейл", "demo@example.com"],
  ])
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(
      value,
    );
});

for (const width of [360, 390, 1280]) {
  test(`state matrix: empty selection, no common specialist and empty day at ${width}px`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.setViewportSize({ width, height: 880 });
    await page.goto("/");
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    await next.click();
    await expect(
      page.getByRole("group", { name: "Услуги", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("alert").filter({ hasText: "Избери поне една услуга" }),
    ).toBeVisible();
    await page.screenshot({
      path: `coverage/playwright/state-empty-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("checkbox", { name: /Оформяне на брада/ }).check();
    await page.getByRole("checkbox", { name: /Измиване и оформяне/ }).check();
    await next.click();
    await page.getByRole("radio", { name: "Специалист", exact: true }).check();
    const noqual = page
      .getByRole("alert")
      .filter({ hasText: "Никой специалист" });
    await expect(noqual).toHaveAttribute("data-variant", "warning");
    await expect(next).toBeDisabled();
    await page.screenshot({
      path: `coverage/playwright/state-noqual-${width}.png`,
      fullPage: true,
    });
    await noqual
      .getByRole("button", { name: "Махни „Измиване и оформяне“" })
      .click();
    await page.getByRole("radio", { name: /Иван/ }).check();
    await next.click();
    // Wednesday is reachable via Mila, then remains selected when switching to Ivan.
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("checkbox", { name: /Оформяне на брада/ }).uncheck();
    await page.getByRole("checkbox", { name: /Подстригване/ }).check();
    await next.click();
    await page.getByRole("radio", { name: /Мила/ }).check();
    await next.click();
    await page.locator('input[name="visit-date"][value="2026-06-03"]').check();
    await page.getByRole("button", { name: "Назад", exact: true }).click();
    await page.getByRole("radio", { name: /Иван/ }).check();
    await next.click();
    const emptyDay = page
      .locator('[data-slot="alert"][role="status"]')
      .filter({ hasText: "Няма свободни часове за тази дата" });
    await expect(emptyDay).toContainText("Иван");
    await expect(next).toBeDisabled();
    await expect(
      emptyDay.getByRole("button", { name: /първи час/ }),
    ).toBeEnabled();
    await page.screenshot({
      path: `coverage/playwright/state-nodate-${width}.png`,
      fullPage: true,
    });
    await emptyDay.getByRole("button", { name: /първи час/ }).click();
    await expect(
      page.getByRole("group", { name: "Свободни начални часове" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { checked: true, name: /^\d\d:\d\d$/ }),
    ).toHaveCount(0);
  });

  for (const scenario of ["loading", "nospec"] as const) {
    test(`state matrix: ${scenario} component fixture at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 880 });
      await page.goto("/");
      const styles = await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((links) => links.map((link) => link.outerHTML).join(""));
      const rootClass = await page.locator("html").getAttribute("class");
      const now = Date.parse("2026-06-01T05:00:00Z");
      const salon = createDemoSalon(() => now);
      // Exercise the existing component boundary, not a new visitor-facing scenario hook.
      const html = renderToStaticMarkup(
        createElement(TimeStep, {
          availability: {
            salon:
              scenario === "nospec"
                ? {
                    ...salon,
                    staff: salon.staff.map((staff) => ({
                      ...staff,
                      hours: {
                        0: [],
                        1: [],
                        2: [],
                        3: [],
                        4: [],
                        5: [],
                        6: [],
                      },
                    })),
                  }
                : salon,
            now,
            serviceIds: ["haircut"],
            staffId: "ivan",
          },
          start: null,
          selectedDate: "2026-06-01",
          loading: scenario === "loading",
          onDate() {},
          onSelect() {},
          onNext() {},
          onEditServices() {},
          onEditStaff() {},
        }),
      );
      await page.setContent(
        `<!doctype html><html lang="bg" class="${rootClass ?? ""}"><head>${styles}</head><body><main class="mx-auto max-w-3xl p-4">${html}</main></body></html>`,
      );
      if (scenario === "loading") {
        await expect(
          page
            .getByRole("status")
            .filter({ hasText: "Търсим свободни часове" }),
        ).toBeVisible();
        await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(10);
        await expect(
          page.getByRole("radio", { name: /^\d\d:\d\d$/ }),
        ).toHaveCount(0);
      } else {
        await expect(
          page
            .locator('[data-slot="alert"][role="status"]')
            .filter({ hasText: "Няма свободни часове" }),
        ).toContainText("Няма по-късна свободна дата");
        await expect(
          page.getByRole("button", { name: "Смени специалиста" }),
        ).toBeVisible();
      }
      await expect(
        page.getByRole("button", { name: /^(Продължи|Напред:)/ }),
      ).toBeDisabled();
      await page.screenshot({
        path: `coverage/playwright/state-${scenario}-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}
