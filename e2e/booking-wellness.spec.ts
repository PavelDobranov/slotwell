import { expect, test } from "@playwright/test";

for (const width of [390, 1280]) {
  test(`${width}px wellness catalog, local portraits and massage booking`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(message.text());
    });
    await page.goto("/");
    await expect(page).toHaveTitle("Запази час · Wellness Studio");
    await expect(page.getByRole("checkbox")).toHaveCount(12);
    await page.getByRole("checkbox", { name: /^Масаж на гръб/ }).check();
    const next = page.getByRole("button", { name: /^(Продължи|Напред:)/ });
    await next.click();
    await page.getByRole("radio", { name: "Специалист", exact: true }).check();
    const emil = page.getByRole("radio", { name: "Емил Стойков", exact: true });
    await expect(emil).toBeEnabled();
    await expect(
      page.getByRole("radio", { name: "Мими Ибрамова", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("radio", { name: "Павел Добранов", exact: true }),
    ).toBeDisabled();
    const portraits = page.locator('[data-slot="avatar"] img');
    await expect(portraits).toHaveCount(3);
    for (const portrait of await portraits.all()) {
      await expect(portrait).toBeVisible();
      expect(
        await portrait.evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
        ),
      ).toBe(true);
      await expect(portrait).toHaveAttribute("src", /^\/staff\//);
    }
    await emil.check();
    await page.screenshot({
      path: `coverage/playwright/wellness-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await next.click();
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    await next.click();
    await page
      .getByRole("textbox", { name: "Име и фамилия", exact: true })
      .fill("Демо Посетител");
    await page
      .getByRole("textbox", { name: "Телефон", exact: true })
      .fill("0888123456");
    await page
      .getByRole("textbox", { name: "Имейл", exact: true })
      .fill("wellness@example.com");
    await page
      .getByRole("button", { name: "Към преглед", exact: true })
      .click();
    const review = page.getByRole("region", {
      name: "Преглед и потвърждение",
      exact: true,
    });
    await expect(review).toContainText("Емил Стойков");
    await expect(review).toContainText("Масаж на гръб, врат и рамене");
    await page
      .getByRole("button", { name: /^Потвърди резервация(?:та)?$/ })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Резервацията е потвърдена",
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}
