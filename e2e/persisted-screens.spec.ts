import { expect, type Page, test } from "@playwright/test";

// Fictional read-only fixtures; never retain page DOM or browser artifacts.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

const catalog = {
  business: {
    name: "Тест ателие",
    address: "Тест адрес",
    timeZone: "Europe/Sofia",
    currency: "EUR",
    defaultPhoneCountry: "BG",
  },
  // Interleaved categories, deliberately not alphabetical in either dimension.
  services: [
    { id: "zephyr", name: "Зефир", category: "Тест зона Я" },
    { id: "amber", name: "Янтар", category: "Тест зона А" },
    { id: "amethyst", name: "Аметист", category: "Тест зона Я" },
    { id: "breeze", name: "Бриз", category: "Тест зона А" },
  ].map((service) => ({
    ...service,
    priceCents: 2000,
    durationMinutes: 30,
    cleanupMinutes: 0,
    currency: "EUR",
  })),
};
const staff = [
  {
    id: "zora",
    name: "Тест Зора",
    description: "Тест майстор",
    imageUrl: null,
  },
  {
    id: "astra",
    name: "Тест Астра",
    description: "Тест майстор",
    imageUrl: null,
  },
];
const servicesNext = (page: Page) =>
  page.getByRole("button", { name: "Продължи към избор на специалист" });
const staffNext = (page: Page) =>
  page.getByRole("button", { name: "Продължи към дата и час" });
const service = (page: Page, name: string) =>
  page.getByRole("checkbox", { name: new RegExp(name) });

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function mockCatalog(page: Page) {
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: catalog }),
  );
}
async function enterStaff(page: Page) {
  await page.goto("/book");
  await service(page, "Зефир").check();
  await servicesNext(page).click();
}

test("services keep first-seen category/server order and choices remain explicit even for sole staff", async ({
  page,
}) => {
  const queries: string[][] = [];
  await mockCatalog(page);
  await page.route("**/api/staff?*", (route) => {
    queries.push(new URL(route.request().url()).searchParams.getAll("service"));
    return route.fulfill({ json: { staff: [staff[0]] } });
  });
  await page.goto("/book");
  const groups = page
    .getByRole("region", { name: "Изберете услуги" })
    .getByRole("group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAccessibleName("Тест зона Я");
  await expect(groups.nth(1)).toHaveAccessibleName("Тест зона А");
  for (const [index, names] of [
    ["Зефир", "Аметист"],
    ["Янтар", "Бриз"],
  ].entries()) {
    const choices = groups.nth(index).getByRole("checkbox");
    await expect(choices).toHaveCount(2);
    for (const [position, name] of names.entries()) {
      await expect(choices.nth(position)).toHaveAccessibleName(
        new RegExp(name),
      );
      await expect(choices.nth(position)).not.toBeChecked();
    }
  }
  await expect(servicesNext(page)).toBeDisabled();
  expect(queries).toEqual([]);
  await service(page, "Бриз").check();
  await service(page, "Зефир").check();
  await servicesNext(page).click();
  await expect(
    page.getByRole("radio", { name: staff[0].name }),
  ).not.toBeChecked();
  await expect(staffNext(page)).toHaveCount(0);
  expect(queries).toEqual([["breeze", "zephyr"]]);

  await page.getByRole("button", { name: "Промени услугите" }).click();
  await service(page, "Бриз").uncheck();
  await service(page, "Бриз").check();
  await servicesNext(page).click();
  await expect(page.getByRole("radio", { name: staff[0].name })).toBeVisible();
  await expect
    .poll(() => queries)
    .toEqual([
      ["breeze", "zephyr"],
      ["zephyr", "breeze"],
    ]);
  await expect(staffNext(page)).toHaveCount(0);
  await page.getByRole("radio", { name: staff[0].name }).check();
  await expect(
    page.getByText(`Избрахте ${staff[0].name}`, { exact: true }),
  ).toBeVisible();
  await expect(staffNext(page)).toBeEnabled();
});

test("Space toggles services and staff; arrows move the specialist selection in server order", async ({
  page,
}) => {
  await mockCatalog(page);
  await page.route("**/api/staff?*", (route) =>
    route.fulfill({ json: { staff } }),
  );
  await page.goto("/book");
  const choice = service(page, "Зефир");
  await choice.focus();
  await choice.press("Space");
  await expect(choice).toBeChecked();
  await expect(servicesNext(page)).toBeEnabled();
  await choice.press("Space");
  await expect(choice).not.toBeChecked();
  await expect(servicesNext(page)).toBeDisabled();
  await choice.press("Space");
  await servicesNext(page).click();
  const first = page.getByRole("radio", { name: staff[0].name });
  const second = page.getByRole("radio", { name: staff[1].name });
  await expect(first).not.toBeChecked();
  await expect(second).not.toBeChecked();
  await first.focus();
  await first.press("Space");
  await expect(first).toBeChecked();
  await first.press("ArrowDown");
  await expect(second).toBeFocused();
  await expect(second).toBeChecked();
  await expect(first).not.toBeChecked();
  await expect(
    page.getByText(`Избрахте ${staff[1].name}`, { exact: true }),
  ).toBeVisible();
  await second.press("ArrowUp");
  await expect(first).toBeFocused();
  await expect(first).toBeChecked();
  await expect(second).not.toBeChecked();
  await expect(staffNext(page)).toBeEnabled();
});

test("catalog loading and network error offer an explicit successful retry", async ({
  page,
}) => {
  const pending = gate();
  let fail = true;
  await page.route("**/api/catalog", async (route) => {
    await pending.promise;
    return fail ? route.abort("failed") : route.fulfill({ json: catalog });
  });
  await page.goto("/book");
  await expect(
    page.getByText("Зареждаме услугите…", { exact: true }),
  ).toBeAttached();
  await expect(servicesNext(page)).toBeDisabled();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  pending.release();
  // The production query client performs automatic retries before surfacing errors.
  await expect(
    page.getByText(
      "Няма връзка със сървъра. Провери връзката си и опитай отново.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Неуспешно зареждане", { exact: true }),
  ).toBeVisible();
  fail = false;
  await page
    .getByRole("button", { name: "Опитай отново", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(4);
  await expect(service(page, "Зефир")).not.toBeChecked();
  await expect(servicesNext(page)).toBeDisabled();
  await expect(
    page.getByText("Неуспешно зареждане", { exact: true }),
  ).toHaveCount(0);
});

test("empty catalog keeps service progression unavailable", async ({
  page,
}) => {
  await page.route("**/api/catalog", (route) =>
    route.fulfill({ json: { ...catalog, services: [] } }),
  );
  await page.goto("/book");
  await expect(
    page.getByText("Няма налични услуги в момента", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(servicesNext(page)).toBeDisabled();
});

test("staff loading and server error retry without silently choosing the recovered sole specialist", async ({
  page,
}) => {
  const pending = gate();
  let fail = true;
  await mockCatalog(page);
  await page.route("**/api/staff?*", async (route) => {
    await pending.promise;
    return fail
      ? route.fulfill({ status: 503, json: { error: { code: "internal" } } })
      : route.fulfill({ json: { staff: [staff[0]] } });
  });
  await enterStaff(page);
  await expect(
    page.getByText("Търсим подходящ специалист…", { exact: true }),
  ).toBeAttached();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(staffNext(page)).toHaveCount(0);
  pending.release();
  await expect(
    page.getByText("Нещо се обърка при зареждането. Опитай отново."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Неуспешно зареждане", { exact: true }),
  ).toBeVisible();
  await expect(staffNext(page)).toHaveCount(0);
  fail = false;
  await page
    .getByRole("button", { name: "Опитай отново", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: staff[0].name }),
  ).not.toBeChecked();
  await expect(staffNext(page)).toHaveCount(0);
  await expect(
    page.getByText("Неуспешно зареждане", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await expect(service(page, "Зефир")).toBeChecked();
});

test("empty qualification returns to the services without losing their selection", async ({
  page,
}) => {
  await mockCatalog(page);
  await page.route("**/api/staff?*", (route) =>
    route.fulfill({ json: { staff: [] } }),
  );
  await enterStaff(page);
  await expect(
    page.getByText("Няма специалист за всички избрани услуги заедно", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(staffNext(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Към услугите", exact: true }).click();
  await expect(service(page, "Зефир")).toBeChecked();
  await expect(servicesNext(page)).toBeEnabled();
});

test("qualification refresh after service edits preserves valid staff and drops invalid staff without replacement", async ({
  page,
}) => {
  await mockCatalog(page);
  await page.route("**/api/staff?*", (route) => {
    const ids = new URL(route.request().url()).searchParams.getAll("service");
    return route.fulfill({
      json: { staff: ids.includes("breeze") ? [staff[1]] : staff },
    });
  });
  await enterStaff(page);
  await page.getByRole("radio", { name: staff[0].name }).check();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await service(page, "Аметист").check();
  await servicesNext(page).click();
  await expect(page.getByRole("radio", { name: staff[0].name })).toBeChecked();
  await expect(staffNext(page)).toBeEnabled();
  await page.getByRole("button", { name: "Промени услугите" }).click();
  await service(page, "Бриз").check();
  await servicesNext(page).click();
  await expect(page.getByRole("radio", { name: staff[1].name })).toBeVisible();
  await expect(page.getByRole("radio", { name: staff[0].name })).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: staff[1].name }),
  ).not.toBeChecked();
  await expect(
    page.getByText(
      "Специалистът вече не е подходящ за избраните услуги. Изберете специалист и час.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(staffNext(page)).toHaveCount(0);
  await page.getByRole("radio", { name: staff[1].name }).check();
  await expect(staffNext(page)).toBeEnabled();
});
