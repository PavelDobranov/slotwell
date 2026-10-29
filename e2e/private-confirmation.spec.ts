import { expect, test } from "@playwright/test";

// Private links must never be retained in traces, videos or screenshots.
test.use({
  trace: "off",
  screenshot: "off",
  video: "off",
  timezoneId: "America/Los_Angeles",
});

test("private entry has privacy headers and rejects missing credentials without a read", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/confirmations/read", async (route) => {
    reads++;
    await route.abort();
  });
  const response = await page.goto("/confirmation");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response?.headers()["x-robots-tag"]).toBe(
    "noindex, nofollow, noarchive",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex.*nofollow.*noarchive/,
  );
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    "content",
    "no-referrer",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Потвърждение на резервация" }),
  ).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Линкът е невалиден или е изтекъл.",
  );
  expect(reads).toBe(0);
});

// Synthetic, non-authorizing credentials only; never use live private links here.
const credential = {
  appointmentId: "11111111-1111-4111-8111-111111111111",
  viewToken: "ab".repeat(32),
};
const fragment = new URLSearchParams(credential).toString();
const snapshot = {
  status: "confirmed",
  startsAt: "2026-06-01T23:30:00.000Z",
  serviceEndsAt: "2026-06-02T00:15:00.000Z",
  bookingTimeZone: "Asia/Tokyo",
  staffName: "Запазен специалист",
  businessAddress: "Запазен адрес 12",
  confirmationExpiresAt: "2026-06-09T00:15:00.000Z",
  services: [
    {
      name: "Подстригване",
      priceCents: 2500,
      currency: "BGN",
      durationMinutes: 30,
    },
    {
      name: "Консултация",
      priceCents: null,
      currency: "BGN",
      durationMinutes: 15,
    },
  ],
};

test("fragment POST renders booking-zone snapshots after reload, without storage or external resources", async ({
  page,
  context,
}) => {
  let reads = 0;
  let transportSafe = true;
  const external: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== "http://127.0.0.1:3100")
      external.push("external");
  });
  await page.route("**/api/confirmations/read", async (route) => {
    reads++;
    const request = route.request();
    // Assert booleans so a failed assertion cannot print a private body/link.
    transportSafe &&=
      request.method() === "POST" &&
      request.url() === "http://127.0.0.1:3100/api/confirmations/read" &&
      JSON.stringify(request.postDataJSON()) === JSON.stringify(credential) &&
      request.headers().referer === undefined;
    await route.fulfill({
      json: {
        ...snapshot,
        contactEmail: "never-render@example.test",
        notes: "Never render notes",
      },
    });
  });
  await page.goto(`/confirmation#${fragment}`);
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  await expect(page.getByText("2 юни 2026", { exact: false })).toBeVisible();
  await expect(page.getByText("08:30 – 09:15", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Часова зона на резервацията: Asia/Tokyo"),
  ).toBeVisible();
  await expect(
    page.getByText(snapshot.staffName, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(snapshot.businessAddress, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Цената се уточнява на място")).toBeVisible();
  await expect(page.getByText(/25,00/)).toBeVisible();
  await expect(
    page.getByText(
      /never-render|Never render notes|Промени часа|Откажи|изпрат.*имейл/i,
    ),
  ).toHaveCount(0);
  const link = page.getByRole("link", { name: "Упътване до салона" });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("referrerpolicy", "no-referrer");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  expect(reads).toBe(2);
  expect(transportSafe).toBe(true);
  expect(new URL(page.url()).hash.length > 1).toBe(true);
  expect(external).toEqual([]);
  // Inspect only empty-store counts, never read credential material.
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).length,
    })),
  ).toEqual({ local: 0, session: 0, databases: 0 });
  expect((await context.cookies()).length).toBe(0);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("unavailable and expired credentials share one accessible error", async ({
  page,
}) => {
  await page.route("**/api/confirmations/read", (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "confirmation_unavailable" } },
    }),
  );
  await page.goto(`/confirmation#${fragment}`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Линкът е невалиден или е изтекъл.",
  );
  await expect(page.getByText(snapshot.staffName)).toHaveCount(0);
});

test("loading and network failures offer keyboard retry without leaking raw errors", async ({
  page,
}) => {
  let mode: "pending" | "network" | "unavailable" | "ok" = "pending";
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/confirmations/read", async (route) => {
    if (mode === "pending") await pending;
    if (mode === "network") return route.abort("failed");
    if (mode === "unavailable")
      return route.fulfill({
        status: 503,
        json: { error: { code: "private raw server error" } },
      });
    return route.fulfill({ json: snapshot });
  });
  await page.goto(`/confirmation#${fragment}`);
  await expect(page.getByRole("status")).toHaveText("Зареждаме резервацията…");
  mode = "network";
  release();
  const retry = page.getByRole("button", { name: "Опитай отново" });
  await expect(retry).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(retry).toBeFocused();
  mode = "unavailable";
  await page.keyboard.press("Enter");
  await expect(retry).toBeVisible();
  await expect(page.getByText("private raw server error")).toHaveCount(0);
  mode = "ok";
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeFocused();
});

test("malformed, duplicate and extra fragment fields never trigger retrieval", async ({
  page,
}) => {
  let reads = 0;
  await page.route("**/api/confirmations/read", (route) => {
    reads++;
    return route.abort();
  });
  for (const hash of [
    "viewToken=bad",
    `${fragment}&viewToken=${credential.viewToken}`,
    `${fragment}&extra=value`,
  ]) {
    await page.goto(`/confirmation#${hash}`);
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Линкът е невалиден или е изтекъл.",
    );
  }
  expect(reads).toBe(0);
});

test("changing the fragment discards the previous snapshot", async ({
  page,
}) => {
  await page.route("**/api/confirmations/read", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto(`/confirmation#${fragment}`);
  await expect(page.getByText(snapshot.staffName)).toBeVisible();
  await page.goto("/confirmation#invalid");
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByText(snapshot.staffName)).toHaveCount(0);
});
