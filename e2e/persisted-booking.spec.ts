import { expect, type Page, test } from "@playwright/test";

const catalog = {
  business: {
    name: "Тест салон",
    address: "Тест адрес",
    timeZone: "Asia/Tokyo",
    currency: "EUR",
  },
  services: [
    {
      id: "cut",
      name: "Подстригване",
      category: "Коса",
      priceCents: 2000,
      durationMinutes: 37,
    },
    {
      id: "color",
      name: "Боядисване",
      category: "Коса",
      priceCents: 3000,
      durationMinutes: 60,
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

test.use({ timezoneId: "America/Los_Angeles" });

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
