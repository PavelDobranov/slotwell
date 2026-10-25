import { expect, test } from "@playwright/test";

test("path switches preserve valid choices and service edits explain only invalidated choices", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page
    .getByRole("radio", { name: "Първо специалист", exact: true })
    .check();
  await page.getByRole("radio", { name: /Мила/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: "15:00", exact: true }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
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
    page.getByRole("heading", { name: "Дата и час", exact: true }),
  ).toBeFocused();
  await page.getByRole("radio", { name: "Първо дата и час" }).check();
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
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(page.getByRole("radio", { name: /Мила/ })).toBeChecked();
  await page.getByRole("button", { name: "Продължи" }).click();
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
  const summary = page.getByRole("complementary", { name: "Твоят избор" });
  await expect(summary).toContainText("15:00–15:50");
  await expect(summary).not.toContainText("Мила");
  await page.screenshot({
    path: "coverage/playwright/recovery-invalidation.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Продължи" }).click();
  await expect(
    page.getByRole("radio", { name: "15:00", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Продължи" }).click();
  await page.getByRole("radio", { name: /Иван/ }).check();
  await page.getByRole("button", { name: "Продължи" }).click();
  for (const [name, value] of [
    ["Име", "Демо Клиент"],
    ["Телефон", "0888123456"],
    ["Имейл", "demo@example.com"],
  ])
    await expect(page.getByRole("textbox", { name, exact: true })).toHaveValue(
      value,
    );
});
