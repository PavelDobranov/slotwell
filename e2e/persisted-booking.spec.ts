import { expect, type Page, test } from "@playwright/test";

// Installed Playwright otherwise captures private page DOM on failures, even with traces off.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

const catalog = {
  business: {
    name: "Тест салон",
    address: "Тест адрес",
    timeZone: "Asia/Tokyo",
    currency: "EUR",
    defaultPhoneCountry: "JP",
  },
  services: [
    {
      id: "cut",
      name: "Подстригване",
      category: "Коса",
      priceCents: 2000,
      durationMinutes: 37,
      cleanupMinutes: 0,
      currency: "EUR",
    },
    {
      id: "color",
      name: "Боядисване",
      category: "Коса",
      priceCents: 3000,
      durationMinutes: 60,
      cleanupMinutes: 10,
      currency: "EUR",
    },
  ],
};
function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  expect(value).not.toBeNull();
  if (value === null) throw new Error(`Missing ${key}`);
  return value;
}
const slot = { start: "2026-10-25T00:15:00Z", end: "2026-10-25T00:52:00Z" };
function availability(
  from: string,
  to: string,
  slots = [slot],
  timeZone = "Asia/Tokyo",
) {
  const dates: string[] = [];
  for (let day = from; day <= to; ) {
    dates.push(day);
    const carrier = new Date(`${day}T00:00:00Z`);
    carrier.setUTCDate(carrier.getUTCDate() + 1);
    day = carrier.toISOString().slice(0, 10);
  }
  return {
    timeZone,
    serverNow: "2026-10-24T23:30:00Z",
    from,
    to,
    days: dates.map((date) => ({
      date,
      slots: date === "2026-10-25" ? slots : [],
    })),
  };
}
async function enterTime(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-24T23:30:00Z"));
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
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
  await page.goto("/book");
  await page.getByRole("checkbox", { name: /Подстригване/ }).check();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  await page.getByRole("radio", { name: "Мими" }).check();
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
}

test.use({
  timezoneId: "America/Los_Angeles",
  trace: "off",
  screenshot: "off",
  video: "off",
});

async function enterReview(page: Page) {
  await page.route("**/api/availability?*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: availability(requiredParam(url, "from"), requiredParam(url, "to")),
    });
  });
  await enterTime(page);
  await page.getByRole("radio", { name: "09:15–09:52", exact: true }).check();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Synthetic guest");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("09012345678");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await expect(
    page.getByRole("heading", { name: "Проверете и потвърдете" }),
  ).toBeVisible();
}
const receipt = {
  appointmentId: "11111111-1111-4111-8111-111111111111",
  viewToken: "ab".repeat(32),
  confirmationExpiresAt: "2026-11-02T00:52:00.000Z",
};

test("persisted details/review submits one retained agreement then opens a reloadable private confirmation", async ({
  page,
}) => {
  let submits = 0;
  let safe = true;
  await page.route("**/api/booking-intents/resolve", (route) =>
    route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/bookings", (route) => {
    submits++;
    const input = route.request().postDataJSON();
    safe &&=
      input.booking.contact.phoneCountry === "JP" &&
      input.booking.reviewedServices[0].cleanupMinutes === 0 &&
      input.booking.reviewedServices[0].currency === "EUR" &&
      input.booking.startsAt === slot.start &&
      !route.request().headers().referer;
    return route.fulfill({ json: receipt });
  });
  await page.route("**/api/confirmations/read", (route) =>
    route.fulfill({
      json: {
        status: "confirmed",
        startsAt: slot.start,
        serviceEndsAt: slot.end,
        bookingTimeZone: "Asia/Tokyo",
        staffName: "Мими",
        businessAddress: "Тест адрес",
        confirmationExpiresAt: receipt.confirmationExpiresAt,
        services: [
          {
            name: "Подстригване",
            priceCents: 2000,
            currency: "EUR",
            durationMinutes: 37,
          },
        ],
      },
    }),
  );
  await enterReview(page);
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click({ clickCount: 2 });
  await expect.poll(() => new URL(page.url()).pathname).toBe("/confirmation");
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  expect(submits).toBe(1);
  expect(safe).toBe(true);
});

test("unknown submission locks edits and retries an identical pair/agreement", async ({
  page,
}) => {
  let first = "";
  let submissions = 0;
  let identical = true;
  await page.route("**/api/booking-intents/resolve", (route) =>
    route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/bookings", (route) => {
    submissions++;
    const body = route.request().postData() ?? "";
    if (submissions === 1) first = body;
    else identical &&= first === body;
    return route.fulfill({
      status: 503,
      json: { error: { code: "booking_busy", outcome: "unknown" } },
    });
  });
  await enterReview(page);
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect(page.getByText(/Резултатът още не е известен/)).toBeVisible();
  await expect.poll(() => submissions).toBe(1);
  await expect(
    page.getByRole("button", { name: "Редактирай данните" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Повтори същото потвърждение" })
    .click();
  await expect.poll(() => submissions).toBe(2);
  expect(identical).toBe(true);
});

test("server slots render in business zone, empty dates and paging preserve selection", async ({
  page,
}) => {
  await page.route("**/api/availability?*", (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("staff")).toBe("mimi");
    expect(url.searchParams.getAll("service")).toEqual(["cut"]);
    return route.fulfill({
      json: availability(requiredParam(url, "from"), requiredParam(url, "to")),
    });
  });
  await enterTime(page);
  await expect(
    page.getByText("Часова зона: Asia/Tokyo", { exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "09:15–09:52", exact: true }).check();
  await expect(page.getByText(/Избраният час е предварителен/)).toBeVisible();
  await page.getByRole("button", { name: "Следващи дни" }).click();
  await expect(
    page.getByText("Няма свободни часове за тази дата.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Избраният час е предварителен/)).toBeVisible();
  await page.getByRole("button", { name: "Предишни дни" }).click();
  await expect(
    page.getByRole("radio", { name: "09:15–09:52", exact: true }),
  ).toBeChecked();
  await page.getByRole("radio", { name: /26 октомври/ }).check();
  await expect(page.getByText(/Датата е променена/)).toBeVisible();
  await expect(
    page.getByText(/Избраният час е предварителен/),
  ).not.toBeVisible();
});

test("loading, retry and changed-end revalidation never silently replace a choice", async ({
  page,
}) => {
  let mode: "ok" | "error" | "changed" = "ok";
  await page.route("**/api/availability?*", async (route) => {
    if (mode === "error")
      return route.fulfill({
        status: 500,
        json: { error: { code: "availability_unavailable" } },
      });
    const url = new URL(route.request().url());
    return route.fulfill({
      json: availability(
        requiredParam(url, "from"),
        requiredParam(url, "to"),
        mode === "changed"
          ? [{ ...slot, end: "2026-10-25T01:00:00Z" }]
          : [slot],
      ),
    });
  });
  await enterTime(page);
  await page.getByRole("radio", { name: "09:15–09:52", exact: true }).check();
  mode = "error";
  await page.getByRole("button", { name: "Обнови часовете" }).click();
  await expect(
    page.getByRole("button", { name: "Опитай отново" }),
  ).toBeVisible();
  await expect(page.getByText(/Избраният час е предварителен/)).toBeVisible();
  mode = "changed";
  await page.getByRole("button", { name: "Опитай отново" }).click();
  await expect(page.getByText(/Избраният час вече не е наличен/)).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "09:15–10:00", exact: true }),
  ).not.toBeChecked();
});

test("cached empty results after a service edit cannot clear a tentative choice before a successful refresh", async ({
  page,
}) => {
  let phase: "empty" | "combined" | "held-error" | "fresh-empty" = "empty";
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/availability?*", async (route) => {
    if (phase === "held-error") {
      await held;
      return route.fulfill({
        status: 500,
        json: { error: { code: "internal" } },
      });
    }
    const url = new URL(route.request().url());
    return route.fulfill({
      json: availability(
        requiredParam(url, "from"),
        requiredParam(url, "to"),
        phase === "combined" ? [slot] : [],
      ),
    });
  });
  await enterTime(page);
  await expect(
    page.getByText("Няма свободни часове за тази дата.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await page.getByRole("checkbox", { name: /Боядисване/ }).check();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  phase = "combined";
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
  await page.getByRole("radio", { name: "09:15–09:52", exact: true }).check();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await page.getByRole("checkbox", { name: /Боядисване/ }).uncheck();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  phase = "held-error";
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
  await expect(page.getByText("Зареждаме свободните часове…")).toBeAttached();
  await expect(page.getByText(/Избраният час е предварителен/)).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: "Опитай отново" }),
  ).toBeVisible();
  await expect(page.getByText(/Избраният час е предварителен/)).toBeVisible();
  phase = "fresh-empty";
  await page.getByRole("button", { name: "Опитай отново" }).click();
  await expect(page.getByText(/Избраният час вече не е наличен/)).toBeVisible();
});

// The old request is intentionally released after a newer page has rendered.
test("late responses do not replace a newer page; loading is announced", async ({
  page,
}) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/api/availability?*", async (route) => {
    const url = new URL(route.request().url());
    if (++requests === 1) await held;
    await route
      .fulfill({
        json: availability(
          requiredParam(url, "from"),
          requiredParam(url, "to"),
        ),
      })
      .catch(() => {});
  });
  await enterTime(page);
  await expect(page.getByText("Зареждаме свободните часове…")).toBeAttached();
  await page.getByRole("button", { name: "Следващи дни" }).click();
  await expect(
    page.getByText("Няма свободни часове за тази дата.", { exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("radio", { name: "09:15–09:52", exact: true }),
  ).not.toBeVisible();
  await expect(page.getByRole("radio", { name: /1 ноември/ })).toBeChecked();
});

for (const [timeZone, expected, dateName] of [
  ["Pacific/Honolulu", "14:15–14:52", "24 октомври"],
  ["America/New_York", "20:15–20:52", "24 октомври"],
  ["Europe/London", "01:15–01:52", "25 октомври"],
]) {
  test(`response zone ${timeZone} controls instant display across DST`, async ({
    page,
  }) => {
    await page.route("**/api/availability?*", (route) => {
      const url = new URL(route.request().url());
      const response = availability(
        requiredParam(url, "from"),
        requiredParam(url, "to"),
        [slot],
        timeZone,
      );
      const date = timeZone === "Europe/London" ? "2026-10-25" : "2026-10-24";
      response.days = response.days.map((day) => ({
        ...day,
        slots: day.date === date ? [slot] : [],
      }));
      return route.fulfill({ json: response });
    });
    await enterTime(page);
    await page.getByRole("radio", { name: new RegExp(dateName) }).check();
    await expect(
      page.getByRole("radio", { name: expected, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(`Часова зона: ${timeZone}`, { exact: true }),
    ).toBeVisible();
  });
}

test("time controls support keyboard and narrow/desktop layouts without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  await page.route("**/api/availability?*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: availability(requiredParam(url, "from"), requiredParam(url, "to")),
    });
  });
  await enterTime(page);
  await expect(
    page.getByRole("heading", { name: "Изберете дата и час" }),
  ).toBeFocused();
  const time = page.getByRole("radio", { name: "09:15–09:52", exact: true });
  await time.focus();
  await page.keyboard.press("Space");
  await expect(time).toBeChecked();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `coverage/playwright/persisted-time-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("details validate and focus errors; edits preserve contacts and business-zone review on narrow/desktop", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", () => runtimeErrors.push("pageerror"));
  await enterReview(page);
  await page.getByRole("button", { name: "Редактирай данните" }).click();
  await expect(
    page.getByRole("heading", { name: "Вашите данни" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("invalid");
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await expect(
    page.getByRole("textbox", { name: "Имейл", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Имейл", exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("synthetic@example.test");
  await page.getByRole("button", { name: "Назад към часа" }).click();
  await expect(
    page.getByRole("radio", { name: "09:15–09:52", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveValue("Synthetic guest");
  await page.getByRole("button", { name: "Прегледай резервацията" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Проверете и потвърдете" }),
  ).toBeFocused();
  await expect(
    page.getByText("25 октомври 2026 г. · 09:15–09:52", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/изпрат.*имейл|линк за промяна|отказ|Плащането е/),
  ).toHaveCount(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(runtimeErrors).toEqual([]);
});

test("authoritative overlap clears the invalid time, refreshes availability and preserves contacts/services", async ({
  page,
}) => {
  await page.route("**/api/booking-intents/resolve", (route) =>
    route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/bookings", (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "availability_conflict" } },
    }),
  );
  await enterReview(page);
  let refreshes = 0;
  await page.route("**/api/availability?*", (route) => {
    refreshes++;
    const url = new URL(route.request().url());
    return route.fulfill({
      json: availability(requiredParam(url, "from"), requiredParam(url, "to"), [
        { start: "2026-10-25T01:15:00Z", end: "2026-10-25T01:52:00Z" },
      ]),
    });
  });
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Изберете дата и час" }),
  ).toBeVisible();
  await expect(page.getByText(/Избраният час вече не е наличен/)).toBeVisible();
  await expect(page.getByText(/Избраният час е предварителен/)).toHaveCount(0);
  await page.getByRole("radio", { name: "10:15–10:52", exact: true }).check();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(
    page.getByRole("textbox", { name: "Име", exact: true }),
  ).toHaveValue("Synthetic guest");
  await expect(
    page.getByRole("textbox", { name: "Телефон", exact: true }),
  ).toHaveValue("09012345678");
  expect(refreshes).toBeGreaterThan(0);
});

test("explicit other-tab recovery stays recovery-only; fenced clear prevents delayed same-pair retries", async ({
  page,
  context,
}) => {
  let resolves = 0;
  let submissions = 0;
  let firstPair = "";
  let samePair = true;
  await context.route("**/api/booking-intents/resolve", (route) => {
    const auth = JSON.stringify(route.request().postDataJSON());
    if (++resolves === 1) firstPair = auth;
    else samePair &&= firstPair === auth;
    return route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    });
  });
  await context.route("**/api/bookings", (route) => {
    submissions++;
    return route.fulfill({
      status: 503,
      json: { error: { code: "booking_busy", outcome: "unknown" } },
    });
  });
  await context.route("**/api/booking-intents/clear", (route) =>
    route.fulfill({ json: { state: "fenced" } }),
  );
  await context.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
  await enterReview(page);
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect(page.getByText(/Резултатът още не е известен/)).toBeVisible();
  const other = await context.newPage();
  await other.goto("/book");
  await other
    .getByRole("button", { name: "Възстанови опит 1", exact: true })
    .click();
  await expect(
    other.getByRole("heading", {
      name: "Този запазен опит е само за възстановяване",
    }),
  ).toBeFocused();
  await other.reload();
  await expect(
    other.getByRole("heading", {
      name: "Този запазен опит е само за възстановяване",
    }),
  ).toBeVisible();
  await expect(
    other.getByRole("checkbox", { name: /Подстригване/ }),
  ).toBeDisabled();
  await other
    .getByRole("button", { name: "Изчисти този опит", exact: true })
    .click();
  await expect(
    other.getByRole("heading", { name: "Имате запазени опити" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Повтори същото потвърждение" })
    .click();
  await expect(
    page.getByRole("button", { name: "Повтори същото потвърждение" }),
  ).toBeEnabled();
  expect(submissions).toBe(1);
  expect(resolves).toBe(3);
  expect(samePair).toBe(true);
});

test("changed catalog requires time revalidation and renewed consent using configured currency", async ({
  page,
}) => {
  let submissions = 0;
  let originalPair = "";
  let renewed = false;
  let catalogRefreshes = 0;
  await page.route("**/api/booking-intents/resolve", (route) =>
    route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    }),
  );
  await page.route("**/api/bookings", (route) => {
    const input = route.request().postDataJSON();
    const auth = JSON.stringify({
      operationId: input.operationId,
      credential: input.credential,
    });
    submissions++;
    if (submissions === 1) {
      originalPair = auth;
      return route.fulfill({
        status: 409,
        json: { error: { code: "review_required" } },
      });
    }
    renewed =
      originalPair === auth &&
      input.booking.reviewedServices[0].priceCents === 2100 &&
      input.booking.reviewedServices[0].currency === "BGN" &&
      input.booking.contact.name === "Synthetic guest";
    return route.fulfill({
      status: 503,
      json: { error: { code: "booking_busy", outcome: "unknown" } },
    });
  });
  await enterReview(page);
  await page.route("**/api/catalog", (route) => {
    catalogRefreshes++;
    return route.fulfill({
      json: {
        ...catalog,
        services: catalog.services.map((service) => ({
          ...service,
          priceCents: 2100,
          currency: "BGN",
        })),
      },
    });
  });
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Изберете дата и час" }),
  ).toBeVisible();
  await expect.poll(() => catalogRefreshes).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(page.getByText(/лв\./).first()).toBeVisible();
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  expect(submissions).toBe(1);
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect.poll(() => submissions).toBe(2);
  expect(renewed).toBe(true);
});

test("association storage failure blocks all intent networking and draft interaction", async ({
  page,
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("synthetic", "SecurityError");
      },
    });
  });
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/book");
  await expect(
    page.getByText("Не можем да свържем запазения опит с този раздел."),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Подстригване/ }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Провери съхранението отново" })
    .click();
  await expect(
    page.getByRole("button", { name: "Провери съхранението отново" }),
  ).toBeEnabled();
  expect(posts).toBe(0);
});

test("full retained capacity refuses allocation until explicit fenced clear releases exactly one slot", async ({
  page,
}) => {
  let resolves = 0;
  let fences = 0;
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.route("**/api/booking-intents/resolve", (route) => {
    resolves++;
    return route.fulfill({
      json: { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    });
  });
  await page.route("**/api/booking-intents/clear", (route) => {
    fences++;
    return route.fulfill({ json: { state: "fenced" } });
  });
  // Seed only this fresh context's fictional credentials; no credential values leave the browser.
  await page.goto("/confirmation");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("slotwell-booking-intents", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("intents", {
            keyPath: "operationId",
          });
          store.createIndex("credential", "credential", { unique: true });
        };
        request.onerror = () =>
          reject(new Error("synthetic fixture setup failed"));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("intents", "readwrite", {
            durability: "strict",
          });
          for (let index = 1; index <= 16; index++)
            tx.objectStore("intents").add({
              operationId: `${index.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`,
              credential: index.toString(16).padStart(64, "0"),
            });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(new Error("synthetic fixture setup failed"));
          };
        };
      }),
  );
  await page.goto("/book");
  await expect(
    page.getByRole("button", { name: /^Възстанови опит/ }),
  ).toHaveCount(16);
  await page
    .getByRole("button", { name: "Започни отделна резервация" })
    .click();
  await expect(
    page.getByText("Достигнат е лимитът от 16 запазени опита."),
  ).toBeVisible();
  expect(resolves).toBe(0);
  await page
    .getByRole("button", { name: "Възстанови опит 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Изчисти този опит", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /^Възстанови опит/ }),
  ).toHaveCount(15);
  expect(fences).toBe(1);
  await page
    .getByRole("button", { name: "Започни отделна резервация" })
    .click();
  await expect(
    page.getByRole("button", { name: "Провери резултата" }),
  ).toBeEnabled();
  expect(resolves).toBe(2);
});

test("commit with a lost response recovers on reload using the original retained pair", async ({
  page,
}) => {
  let committed = false;
  let submits = 0;
  let resolves = 0;
  let originalPair = "";
  let samePair = true;
  await page.route("**/api/booking-intents/resolve", (route) => {
    const auth = JSON.stringify(route.request().postDataJSON());
    if (++resolves === 1) originalPair = auth;
    else samePair &&= auth === originalPair;
    return route.fulfill({
      json: committed
        ? { state: "committed", receipt }
        : { state: "pending", submitBefore: "2026-10-26T00:00:00.000Z" },
    });
  });
  await page.route("**/api/bookings", (route) => {
    submits++;
    committed = true;
    return route.abort("failed");
  });
  await page.route("**/api/confirmations/read", (route) =>
    route.fulfill({
      json: {
        status: "confirmed",
        startsAt: slot.start,
        serviceEndsAt: slot.end,
        bookingTimeZone: "Asia/Tokyo",
        staffName: "Мими",
        businessAddress: "Тест адрес",
        confirmationExpiresAt: receipt.confirmationExpiresAt,
        services: [
          {
            name: "Подстригване",
            priceCents: 2000,
            currency: "EUR",
            durationMinutes: 37,
          },
        ],
      },
    }),
  );
  await enterReview(page);
  await page
    .getByRole("button", { name: "Потвърди резервацията", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Резултатът още не е известен" }),
  ).toBeVisible();
  await page.reload();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/confirmation");
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  expect(submits).toBe(1);
  expect(resolves).toBe(2);
  expect(samePair).toBe(true);
});

test("failed durable discovery exposes an explicit retry without allocating or networking", async ({
  page,
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.addInitScript(() => {
    const original = window.indexedDB;
    let fail = true;
    Object.defineProperty(window, "indexedDB", {
      get() {
        if (fail) {
          fail = false;
          throw new DOMException("synthetic", "SecurityError");
        }
        return original;
      },
    });
  });
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
  await page.goto("/book");
  await expect(
    page.getByRole("button", { name: "Провери съхранението отново" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Подстригване/ }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Провери съхранението отново" })
    .click();
  await expect(
    page.getByRole("checkbox", { name: /Подстригване/ }),
  ).toBeEnabled();
  expect(posts).toBe(0);
});
