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

const unknownHeading = (page: import("@playwright/test").Page) =>
  page.getByRole("heading", {
    name: "Резултатът още не е известен",
    exact: true,
  });

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

test("a real competing booking rejects the slot, refreshes availability and preserves contacts", async ({
  page,
  persisted,
}) => {
  const before = await totals(persisted);
  const { scenario, range } = await enterPersistedDetails(page, persisted);
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await persisted.occupy(scenario);
  let status = 0;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/bookings")
      status = response.status();
  });
  await confirmPersistedBooking(page).click();
  await expect(
    page.getByRole("heading", { name: "Изберете дата и час" }),
  ).toBeFocused();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Избраният час вече не е наличен." }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: range, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Продължи към данните" }),
  ).toBeDisabled();
  await page
    .getByRole("radiogroup", { name: /^Часове за/ })
    .getByRole("radio")
    .first()
    .check();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveValue("Fictional Journey Guest");
  await expect(
    page.getByRole("textbox", { name: "Бележка (по желание)", exact: true }),
  ).toHaveValue("Fictional note");
  assert.equal(status, 409);
  // One competitor committed; the rejected UI intent remains pending, not replaced.
  assert.deepEqual(
    await totals(persisted),
    before.map((value, index) => value + (index === 3 ? 2 : 1)),
  );
});

test("generic transport failure locks edits and retries the identical agreement against PostgreSQL", async ({
  page,
  persisted,
}) => {
  const before = await totals(persisted);
  let first = "";
  let identical = true;
  let posts = 0;
  await page.route("**/api/bookings", async (route) => {
    const body = route.request().postData() ?? "";
    if (++posts === 1) {
      first = body;
      return route.fulfill({
        status: 500,
        contentType: "text/plain",
        body: "Fictional transport failure",
      });
    }
    identical &&= body === first;
    await route.continue();
  });
  await enterPersistedDetails(page, persisted);
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await confirmPersistedBooking(page).click();
  await expect(unknownHeading(page)).toBeFocused();
  await expect(confirmPersistedBooking(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Редактирай данните" }),
  ).toBeDisabled();
  assert.deepEqual(
    await totals(persisted),
    before.map((value, index) => value + (index === 3 ? 1 : 0)),
  );
  await page
    .getByRole("button", { name: "Провери резултата", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Повтори същото потвърждение" }),
  ).toBeEnabled();
  await expect(confirmPersistedBooking(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Повтори същото потвърждение" })
    .click();
  await expectPersistedConfirmation(page);
  assert.equal(posts, 2);
  assert.equal(identical, true);
  assert.deepEqual(
    await totals(persisted),
    before.map((value) => value + 1),
  );
});

test("commit with lost response recovers on reload and after tab closure without another submit", async ({
  page,
  persisted,
  reloadConfirmation,
}) => {
  const before = await totals(persisted);
  let posts = 0;
  let committed = false;
  let operationId = "";
  let credential = "";
  let samePair = true;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/booking-intents/resolve" && operationId) {
      const pair = request.postDataJSON();
      samePair &&=
        pair.operationId === operationId && pair.credential === credential;
    }
  });
  await page.route("**/api/bookings", async (route) => {
    posts++;
    const pair = route.request().postDataJSON();
    operationId = pair.operationId;
    credential = pair.credential;
    try {
      const response = await route.fetch();
      committed = response.status() === 200;
      await response.dispose();
      await route.abort("failed");
    } catch {
      throw new Error("Private lost-response simulation failed");
    }
  });
  await enterPersistedDetails(page, persisted);
  await fillPersistedContact(page);
  await reviewPersistedBooking(page);
  await confirmPersistedBooking(page).click();
  await expect(unknownHeading(page)).toBeFocused();
  assert.equal(committed, true);
  assert.deepEqual(
    await totals(persisted),
    before.map((value) => value + 1),
  );
  // The tab hint is locator-only; the new route must authenticate the retained pair.
  await page.reload();
  await expectPersistedConfirmation(page);
  await reloadConfirmation();
  await expectPersistedConfirmation(page);
  // A truly independent tab has no hint: it must require explicit discovery selection.
  const reopened = await page.context().newPage();
  await page.close();
  try {
    await reopened.goto("/book");
    await expect(
      reopened.getByRole("heading", { name: "Имате запазени опити" }),
    ).toBeVisible();
    await expect(
      reopened.getByRole("checkbox", { name: /Мъжко подстригване/ }),
    ).toBeDisabled();
    await reopened
      .getByRole("button", { name: "Възстанови опит 1", exact: true })
      .click();
    await expectPersistedConfirmation(reopened);
  } finally {
    await reopened.close();
  }
  assert.equal(posts, 1);
  assert.equal(samePair, true);
  assert.deepEqual(
    await totals(persisted),
    before.map((value) => value + 1),
  );
});
