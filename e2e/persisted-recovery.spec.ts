import { expect, type Page, test } from "@playwright/test";

// Synthetic fixtures only. Never retain private page DOM, traces or screenshots.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

async function review(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-24T23:30:00Z"));
  await page.route("**/api/catalog", (route) =>
    route.fulfill({
      json: {
        business: {
          name: "Тест салон",
          address: "Тест адрес",
          timeZone: "Asia/Tokyo",
          currency: "EUR",
          defaultPhoneCountry: "BG",
        },
        services: [
          {
            id: "cut",
            name: "Подстригване",
            category: "Коса",
            priceCents: 2000,
            durationMinutes: 30,
            cleanupMinutes: 0,
            currency: "EUR",
          },
        ],
      },
    }),
  );
  await page.route("**/api/staff?*", (route) =>
    route.fulfill({
      json: {
        staff: [
          { id: "mimi", name: "Мими", description: "Фризьор", imageUrl: null },
        ],
      },
    }),
  );
  await page.route("**/api/availability?*", (route) => {
    const url = new URL(route.request().url());
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const days = [];
    for (let date = from ?? ""; date && date <= (to ?? ""); ) {
      days.push({
        date,
        slots:
          date === "2026-10-25"
            ? [
                {
                  start: "2026-10-25T00:00:00Z",
                  end: "2026-10-25T00:30:00Z",
                },
              ]
            : [],
      });
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }
    return route.fulfill({
      json: {
        timeZone: "Asia/Tokyo",
        serverNow: "2026-10-24T23:30:00Z",
        from,
        to,
        days,
      },
    });
  });
  await page.goto("/book");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  await page.getByRole("radio", { name: "Мими" }).check();
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
  await page.getByRole("radio", { name: "09:00–09:30", exact: true }).check();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Synthetic guest");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("0888123456");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await expect(
    page.getByRole("heading", { name: "Проверете и потвърдете" }),
  ).toBeVisible();
}

async function pending(page: Page) {
  await page.route("**/api/booking-intents/resolve", (route) =>
    route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    }),
  );
}

const confirm = (page: Page) =>
  page.getByRole("button", { name: "Потвърди резервацията", exact: true });

test("failed first allocation offers explicit rediscovery and preserves the in-memory draft", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    let fail = true;
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === "readwrite" && fail) {
        fail = false;
        throw new DOMException("synthetic", "UnknownError");
      }
      return original.apply(this, args);
    };
  });
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await pending(page);
  await page.route("**/api/bookings", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "availability_conflict" } },
    }),
  );
  await review(page);
  await confirm(page).click();
  await expect(
    page.getByText("Съхранението на опитите не е достъпно."),
  ).toBeVisible();
  await expect(confirm(page)).toBeDisabled();
  expect(posts).toBe(0);
  await page
    .getByRole("button", { name: "Провери съхранението отново" })
    .click();
  await expect(confirm(page)).toBeEnabled();
  expect(posts).toBe(0); // Rediscovery alone must never allocate/register/submit.
  await page.getByRole("button", { name: "Редактирай данните" }).click();
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveValue("Synthetic guest");
  await expect(
    page.getByRole("textbox", { name: "Телефон", exact: true }),
  ).toHaveValue("0888123456");
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await confirm(page).click();
  await expect.poll(() => posts).toBe(2);
});

test("unknown outcome stays locked after pending recovery and a later authoritative rejection", async ({
  page,
}) => {
  let submissions = 0;
  let resolves = 0;
  let original = "";
  let identical = true;
  await page.route("**/api/booking-intents/resolve", (route) => {
    resolves++;
    return route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    });
  });
  await page.route("**/api/bookings", (route) => {
    const body = route.request().postData() ?? "";
    if (++submissions === 1) original = body;
    else identical &&= original === body;
    return route.fulfill(
      submissions === 1
        ? {
            status: 503,
            json: { error: { code: "booking_busy", outcome: "unknown" } },
          }
        : {
            status: 409,
            json: { error: { code: "availability_conflict" } },
          },
    );
  });
  await review(page);
  await confirm(page).click();
  await expect(
    page.getByRole("heading", { name: "Резултатът още не е известен" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Провери резултата" }).click();
  await expect.poll(() => resolves).toBe(2);
  await expect(
    page.getByRole("button", { name: "Редактирай данните" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Повтори същото потвърждение" })
    .click();
  await expect.poll(() => submissions).toBe(2);
  await expect(
    page.getByRole("button", { name: "Провери резултата" }),
  ).toBeEnabled();
  await expect(confirm(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Редактирай данните" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Повтори същото потвърждение" }),
  ).toBeEnabled();
  expect(identical).toBe(true);
});

test("lost clear acknowledgement retains the same intent until explicit fence retry completes", async ({
  page,
}) => {
  let resolves = 0;
  let submissions = 0;
  let clears = 0;
  let pair = "";
  let samePair = true;
  await page.route("**/api/booking-intents/resolve", (route) => {
    resolves++;
    pair = route.request().postData() ?? "";
    return route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    });
  });
  await page.route("**/api/bookings", (route) => {
    submissions++;
    return route.abort("failed");
  });
  await page.route("**/api/booking-intents/clear", (route) => {
    samePair &&= pair === route.request().postData();
    if (++clears === 1) return route.abort("failed");
    return route.fulfill({ json: { state: "fenced" } });
  });
  await review(page);
  await confirm(page).click();
  await expect(
    page.getByRole("heading", { name: "Резултатът още не е известен" }),
  ).toBeVisible();
  const clear = page.getByRole("button", {
    name: "Изчисти този опит",
    exact: true,
  });
  await clear.click();
  await expect(clear).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Редактирай данните" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Започни отделна резервация" }),
  ).toHaveCount(0);
  await clear.click();
  await expect(clear).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveValue("Synthetic guest");
  expect(samePair).toBe(true);
  expect(clears).toBe(2);
  expect(resolves).toBe(1);
  expect(submissions).toBe(1);
});
