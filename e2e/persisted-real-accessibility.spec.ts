import assert from "node:assert/strict";
import { expect, type Locator, type Page } from "@playwright/test";

import { expectPersistedConfirmation, test } from "./persisted-fixtures";

// Drive actual Tab/Enter/Space/arrow keys, never programmatic focus or pointer actions.
async function tabTo(page: Page, control: Locator) {
  for (let index = 0; index < 80; index++) {
    if (
      await control.evaluateAll((elements) =>
        elements.some((element) => element === document.activeElement),
      )
    )
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard walkthrough could not reach the named control");
}
async function activate(page: Page, control: Locator) {
  await expect(control).toBeEnabled();
  await tabTo(page, control);
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}
async function fitsViewport(page: Page) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
}

for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px keyboard walkthrough`, () => {
    test.use({ viewport, timezoneId: "America/Los_Angeles" });
    test("staff-first booking exposes names, focus, status and business-zone time without horizontal overflow", async ({
      page,
      persisted,
    }) => {
      const scenario = await persisted.booking();
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Sofia",
      }).format(new Date(scenario.input.startsAt));
      const dateLabel = new Intl.DateTimeFormat("bg-BG", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "long",
      }).format(new Date(`${date}T00:00:00Z`));
      const clock = (instant: number) =>
        new Intl.DateTimeFormat("bg-BG", {
          timeZone: "Europe/Sofia",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(instant));
      const range = `${clock(Date.parse(scenario.input.startsAt))}–${clock(Date.parse(scenario.input.startsAt) + 30 * 60_000)}`;
      let errors = 0;
      page.on("pageerror", () => errors++);
      page.on("console", (message) => {
        if (message.type() === "error") errors++;
      });
      await page.goto("/book");
      await expect(
        page.getByRole("navigation", { name: "Стъпки на резервацията" }),
      ).toBeVisible();
      const service = page.getByRole("checkbox", {
        name: /Мъжко подстригване/,
      });
      await expect(service).toBeEnabled();
      await tabTo(page, service);
      await page.keyboard.press("Space");
      await expect(service).toBeChecked();
      await fitsViewport(page);
      await activate(
        page,
        page.getByRole("button", { name: "Продължи към избор на специалист" }),
      );
      const staff = page.getByRole("radio", {
        name: "Павел Добранов",
        exact: true,
      });
      await expect(staff).toBeVisible();
      await tabTo(
        page,
        page.getByRole("radio", { name: "Мими Ибрамова", exact: true }),
      );
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Space");
      await expect(staff).toBeChecked();
      await fitsViewport(page);
      await activate(
        page,
        page.getByRole("button", { name: "Продължи към дата и час" }),
      );
      await expect(
        page.getByRole("heading", { name: "Изберете дата и час" }),
      ).toBeFocused();
      await expect(
        page.getByText("Часова зона: Europe/Sofia", { exact: true }),
      ).toBeVisible();
      if (!(await page.locator(`#date-${date}`).count()))
        await activate(
          page,
          page.getByRole("button", { name: "Следващи дни" }),
        );
      const dates = page.getByRole("radiogroup", { name: "Дати", exact: true });
      const day = dates.getByRole("radio", { name: dateLabel, exact: true });
      await tabTo(page, dates.getByRole("radio").first());
      for (
        let index = 0;
        index < 7 && (await day.getAttribute("aria-checked")) !== "true";
        index++
      )
        await page.keyboard.press("ArrowRight");
      await expect(day).toBeChecked();
      const slot = page.getByRole("radio", { name: range, exact: true });
      await expect(slot).toBeVisible();
      await tabTo(page, slot);
      await page.keyboard.press("Space");
      await expect(slot).toBeChecked();
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Избраният час е предварителен" }),
      ).toBeVisible();
      await fitsViewport(page);
      await activate(
        page,
        page.getByRole("button", { name: "Продължи към данните" }),
      );
      await expect(
        page.getByRole("heading", { name: "Вашите данни" }),
      ).toBeFocused();
      await activate(
        page,
        page.getByRole("button", { name: "Прегледай резервацията" }),
      );
      const name = page.getByRole("textbox", { name: "Име", exact: true });
      await expect(name).toBeFocused();
      await expect(name).toHaveAccessibleDescription("Въведете име.");
      await page.keyboard.type("Fictional Keyboard Guest");
      await tabTo(
        page,
        page.getByRole("textbox", { name: "Телефон", exact: true }),
      );
      await page.keyboard.type("0888123456");
      await tabTo(
        page,
        page.getByRole("textbox", { name: "Имейл", exact: true }),
      );
      await page.keyboard.type("keyboard@example.test");
      await fitsViewport(page);
      await activate(
        page,
        page.getByRole("button", { name: "Прегледай резервацията" }),
      );
      await expect(
        page.getByRole("heading", { name: "Проверете и потвърдете" }),
      ).toBeFocused();
      await expect(
        page.getByRole("status").filter({ hasText: "Текуща стъпка: Преглед" }),
      ).toBeVisible();
      await expect(page.getByText(new RegExp(range))).toBeVisible();
      await fitsViewport(page);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/bookings", async (route) => {
        await gate;
        await route.continue();
      });
      await activate(
        page,
        page.getByRole("button", {
          name: "Потвърди резервацията",
          exact: true,
        }),
      );
      try {
        await expect(
          page.getByRole("status").filter({ hasText: "Обработваме заявката…" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Редактирай данните" }),
        ).toBeDisabled();
      } finally {
        release();
      }
      await expectPersistedConfirmation(page);
      await fitsViewport(page);
      assert.equal(errors, 0);
    });
  });
}
