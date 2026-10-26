import { expect, type Page, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

type BookingPath = "staff-first" | "time-first";

async function reachReview(
  page: Page,
  path: BookingPath,
  capture: (screen: string) => Promise<void> = async () => {},
) {
  await page.goto("/");
  const service = page.getByRole("checkbox", { name: /Подстригване/ });
  await expect(service).toBeEnabled();
  await service.check();
  await expect(service).toBeChecked();
  await expect(
    page.getByRole("heading", { name: "Изберете услуги", exact: true }),
  ).toBeVisible();
  await capture("services");
  await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  await page
    .getByRole("radio", {
      name: path === "staff-first" ? "Специалист" : "Дата и час",
      exact: true,
    })
    .check();

  for (const [index, step] of (path === "staff-first"
    ? ["staff", "time"]
    : ["time", "staff"]
  ).entries()) {
    await expect(
      page.getByRole("heading", {
        name: "Кога и с кого",
        exact: true,
      }),
    ).toBeVisible();
    const choice = page.getByRole("radio", {
      name: step === "staff" ? /Мила/ : "15:00",
      exact: step === "time",
    });
    await choice.check();
    await expect(choice).toBeChecked();
    await capture(`${index + 1}-${step}`);
    await page.getByRole("button", { name: /^(Продължи|Напред:)/ }).click();
  }

  for (const [name, value] of [
    ["Име", "Демо Посетител"],
    ["Телефон", "0888123456"],
    ["Имейл", "baseline@example.com"],
  ]) {
    const input = page.getByRole("textbox", { name, exact: true });
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }
  await expect(
    page.getByRole("button", { name: "Провери данните", exact: true }),
  ).toBeVisible();
  await capture("details");
  await page
    .getByRole("button", { name: "Провери данните", exact: true })
    .click();
  const review = page.getByRole("region", {
    name: "Преглед и потвърждение",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("Демо Посетител");
  await expect(review).toContainText("baseline@example.com");
  await expect(
    page.getByRole("button", {
      name: /^Потвърди резервация(?:та)?$/,
      exact: true,
    }),
  ).toBeEnabled();
  await capture("review");
}

for (const width of [360, 390, 1280]) {
  test.describe(`${width}px issue #29 current-UI baseline`, () => {
    test.use({ viewport: { width, height: width === 1280 ? 880 : 844 } });

    let errors: string[];
    test.beforeEach(async ({ page }) => {
      errors = [];
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          errors.push(message.text());
      });
    });
    test.afterEach(() => {
      expect(errors).toEqual([]);
    });

    for (const path of ["staff-first", "time-first"] as const) {
      test(`${path} services through success`, async ({ page }) => {
        const capture = async (screen: string) => {
          await page.screenshot({
            path: `coverage/playwright/baseline-29/${width}-${path}-${screen}.png`,
            fullPage: true,
            animations: "disabled",
          });
        };
        await reachReview(page, path, capture);
        if (width < 1280)
          await page.getByRole("button", { name: "Виж избора" }).click();
        const summary = page.getByRole(
          width < 1280 ? "dialog" : "complementary",
          {
            name: "Вашата резервация",
            exact: true,
          },
        );
        await expect(summary).toBeVisible();
        for (const text of ["Подстригване", "Мила", "15:00–15:30"])
          await expect(summary).toContainText(text);
        await capture("summary");
        if (width < 1280) {
          await page.keyboard.press("Escape");
          await expect(summary).not.toBeVisible();
        }
        await page
          .getByRole("button", {
            name: /^Потвърди резервация(?:та)?$/,
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Резервацията е потвърдена",
            exact: true,
          }),
        ).toBeFocused();
        await expect(
          page.getByRole("region", { name: "Твоето посещение" }),
        ).toContainText("15:00–15:30");
        await capture("success");
      });
    }

    for (const scenario of ["conflict", "retryable"] as const) {
      test(`staff-first ${scenario} recovery`, async ({ page }) => {
        // Existing demo-only enum hook; no injected booking or visitor state.
        await page.addInitScript((value) => {
          Object.assign(window, { __SLOTWELL_DEMO_SCENARIO__: value });
        }, scenario);
        await reachReview(page, "staff-first");
        await page
          .getByRole("button", {
            name: /^Потвърди резервация(?:та)?$/,
            exact: true,
          })
          .click();
        if (scenario === "conflict") {
          await expect(
            page.getByRole("heading", { name: "Кога и с кого", exact: true }),
          ).toBeFocused();
          await expect(
            page.getByRole("alert").filter({ hasText: "Избери нов час" }),
          ).toContainText("Резервацията не е направена");
          await expect(
            page.getByRole("radio", {
              name: "15:00",
              exact: true,
              checked: true,
            }),
          ).toHaveCount(0);
          await expect(
            page.getByRole("radio", { name: "16:00", exact: true }),
          ).toBeEnabled();
        } else {
          await expect(
            page
              .getByRole("region", { name: "Данни и преглед" })
              .getByRole("alert"),
          ).toContainText("Опитай отново");
          await expect(
            page.getByRole("button", { name: "Опитай отново", exact: true }),
          ).toBeEnabled();
          await expect(
            page.getByRole("region", {
              name: "Преглед и потвърждение",
              exact: true,
            }),
          ).toContainText("baseline@example.com");
        }
        await page.screenshot({
          path: `coverage/playwright/baseline-29/${width}-staff-first-${scenario}.png`,
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  });
}
