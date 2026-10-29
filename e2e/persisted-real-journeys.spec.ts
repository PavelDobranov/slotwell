import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { count } from "drizzle-orm";

import {
  appointmentAccess,
  appointmentServices,
  appointments,
  bookingOperations,
} from "@/db/schema";
import type { PersistedBrowserServer } from "../scripts/e2e-db";
import {
  confirmPersistedBooking,
  enterPersistedDetails,
  expectPersistedConfirmation,
  fillPersistedContact,
  reviewPersistedBooking,
  test,
} from "./persisted-fixtures";

// Compare only safe aggregate counts, not private rows or request/receipt data.
async function totals(persisted: PersistedBrowserServer) {
  const result = [];
  for (const table of [
    appointments,
    appointmentServices,
    appointmentAccess,
    bookingOperations,
  ]) {
    const [row] = await persisted.db.select({ value: count() }).from(table);
    result.push(row.value);
  }
  return result;
}

test.use({ timezoneId: "America/Los_Angeles" });

test("staff-first UI double submit commits once and confirmation survives reload", async ({
  page,
  persisted,
  reloadConfirmation,
}) => {
  const before = await totals(persisted);
  const { range } = await enterPersistedDetails(page, persisted);
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await expect(page.getByText(new RegExp(range))).toBeVisible();
  await expect(
    page.getByText("Все още няма потвърдена резервация."),
  ).toBeVisible();
  let posts = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/bookings") posts++;
  });
  await confirmPersistedBooking(page).click({ clickCount: 2 });
  await expectPersistedConfirmation(page);
  await reloadConfirmation();
  await expectPersistedConfirmation(page);
  assert.equal(posts, 1);
  assert.deepEqual(
    await totals(persisted),
    before.map((value) => value + 1),
  );
  await expect(
    page.getByText("journey@example.test", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Fictional note", { exact: true })).toHaveCount(
    0,
  );
});

test("invalid details never submit; edits and back preserve contacts, service, staff and time", async ({
  page,
  persisted,
}) => {
  const before = await totals(persisted);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  const { range } = await enterPersistedDetails(page, persisted);
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  const name = page.getByRole("textbox", { name: "Име", exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("alert").filter({ hasText: "Проверете данните" }),
  ).toBeVisible();
  await fillPersistedContact(page);
  await page.getByRole("textbox", { name: "Телефон", exact: true }).fill("123");
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await expect(
    page.getByRole("textbox", { name: "Телефон", exact: true }),
  ).toBeFocused();
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await page.getByRole("button", { name: "Редактирай данните" }).click();
  await expect(name).toHaveValue("Fictional Journey Guest");
  await page.getByRole("button", { name: "Назад към часа" }).click();
  await expect(
    page.getByRole("radio", { name: range, exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(name).toHaveValue("Fictional Journey Guest");
  await expect(
    page.getByRole("textbox", { name: "Телефон", exact: true }),
  ).toHaveValue("0888123456");
  await expect(
    page.getByRole("textbox", { name: "Имейл", exact: true }),
  ).toHaveValue("journey@example.test");
  await expect(
    page.getByRole("textbox", { name: "Бележка (по желание)", exact: true }),
  ).toHaveValue("Fictional note");
  await reviewPersistedBooking(page);
  await expect(
    page.getByText("Специалист: Павел Добранов", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Мъжко подстригване · 30 мин", { exact: false }),
  ).toBeVisible();
  assert.equal(posts, 0);
  assert.deepEqual(await totals(persisted), before);
});
