import { expect, type Locator, type Page, test } from "@playwright/test";

import { auditRenderedControls } from "./rendered-audit";

async function expectUnobscured(target: Locator) {
  await expect(target).toBeInViewport();
  expect(
    await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      );
      return top !== null && (element.contains(top) || top.contains(element));
    }),
  ).toBe(true);
}

async function expectNoPersistence(page: Page) {
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  expect(
    await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      databases: (await indexedDB.databases()).map(({ name }) => name),
    })),
  ).toEqual({ local: 0, session: 0, databases: [] });
  expect(await page.context().cookies()).toEqual([]);
}

// Reach controls through the real tab order, never locator.focus()/click().
async function tabTo(page: Page, target: Locator) {
  for (let index = 0; index < 100; index++) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      await expectUnobscured(target);
      return;
    }
  }
  throw new Error(
    `Control is not keyboard reachable: ${await target.ariaSnapshot()}`,
  );
}

async function activate(page: Page, target: Locator, key = "Enter") {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

async function chooseTime(page: Page, time: string) {
  const slots = page.getByRole("group", { name: "Свободни начални часове" });
  const selected = slots.getByRole("radio", { checked: true });
  await tabTo(
    page,
    (await selected.count()) ? selected : slots.getByRole("radio").first(),
  );
  const target = slots.getByRole("radio", { name: time, exact: true });
  for (let index = 0; index < 100; index++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      await page.keyboard.press("Space");
      await expect(target).toBeChecked();
      await expectUnobscured(target);
      return;
    }
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`Time is not keyboard reachable: ${time}`);
}

test.use({ timezoneId: "America/New_York" });

const reviewViewports = [360, 390, 768, 1023, 1024, 1280, 1440].map(
  (width) => ({ width, zoom: false }),
);
reviewViewports.push({ width: 390, zoom: true }, { width: 1280, zoom: true });

for (const { width, zoom } of reviewViewports) {
  for (const path of ["staff-first", "time-first"] as const) {
    test(`${width}px ${path}${zoom ? " at 200% CSS zoom with reduced motion" : ""}: keyboard-only multi-service booking, edits, validation and reset`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      if (zoom) await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      const consoleMessages: string[] = [];
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        consoleMessages.push(message.text());
        if (["error", "warning"].includes(message.type()))
          errors.push(message.text());
      });
      page.on("request", (request) =>
        requests.push(`${request.url()} ${request.postData() ?? ""}`),
      );
      page.on("requestfailed", (request) =>
        errors.push(`Failed request: ${request.url()}`),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          errors.push(`HTTP ${response.status()}: ${response.url()}`);
      });
      await page.goto("/");
      if (zoom) {
        await page.evaluate(() => {
          document.documentElement.style.zoom = "2";
        });
        expect(
          await page.evaluate(
            () => matchMedia("(prefers-reduced-motion: reduce)").matches,
          ),
        ).toBe(true);
      }
      const button = (name: string | RegExp) =>
        page.getByRole("button", { name, exact: true });
      const heading = (name: string) =>
        page.getByRole("heading", { name, exact: true });
      async function verifyRendered(name: string) {
        const audit = await auditRenderedControls(page);
        await testInfo.attach(`rendered-audit-${name}`, {
          body: JSON.stringify(audit, null, 2),
          contentType: "application/json",
        });
        expect(audit.contrasts.length).toBeGreaterThan(0);
        expect(audit.contrasts.filter(({ ratio }) => ratio < 4.5)).toEqual([]);
        expect(audit.targets.filter(({ minimum44 }) => !minimum44)).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        const screenshot = await page.screenshot({
          path: `coverage/playwright/keyboard-${width}-${path}${zoom ? "-zoom-reduced" : ""}-${name}.png`,
          fullPage: true,
        });
        await testInfo.attach(`screen-${name}`, {
          body: screenshot,
          contentType: "image/png",
        });
      }
      async function verifyStep(name: string) {
        // The time and specialist screens share one milestone heading.
        const headingName =
          name === "Дата и час" || name === "Специалист"
            ? "Кога и с кого"
            : name;
        await expect(heading(headingName)).toBeFocused();
        await verifyRendered(name);
      }
      await expect(page.locator("html")).toHaveAttribute("lang", "bg");
      for (const name of [/Подстригване/, /Оформяне на брада/]) {
        const checkbox = page.getByRole("checkbox", { name });
        await activate(page, checkbox, "Space");
        await expect(checkbox).toBeChecked();
        // Visible check icon supplements the selected background colour.
        await expect(checkbox.locator("svg")).toBeVisible();
      }
      await verifyRendered("Избрани услуги");
      await activate(page, button(/^(Продължи|Напред:)/));
      const staffPath = page.getByRole("radio", {
        name: "Специалист",
        exact: true,
      });
      const timePath = page.getByRole("radio", {
        name: "Дата и час",
        exact: true,
      });
      const startsWithStaff = await staffPath.isChecked();
      await verifyStep(startsWithStaff ? "Специалист" : "Дата и час");
      // Normalize with the keyboard, even when staff-first is already selected.
      await activate(
        page,
        startsWithStaff ? staffPath : timePath,
        startsWithStaff ? "Space" : "ArrowLeft",
      );
      await expect(staffPath).toBeChecked();
      if (!startsWithStaff) await verifyStep("Специалист");
      if (path === "time-first") {
        await activate(
          page,
          page.getByRole("radio", { name: "Специалист", exact: true }),
          "ArrowRight",
        );
        await expect(
          page.getByRole("radio", { name: "Дата и час", exact: true }),
        ).toBeChecked();
        await verifyStep("Дата и час");
      } else {
        await activate(
          page,
          page.getByRole("radio", { name: /Павел Добранов/ }),
          "Space",
        );
        await activate(page, button(/^(Продължи|Напред:)/));
        await verifyStep("Дата и час");
      }
      await chooseTime(page, "15:00");
      await activate(page, button(/^(Продължи|Напред:)/));
      if (path === "time-first") {
        await verifyStep("Специалист");
        await activate(
          page,
          page.getByRole("radio", { name: /Павел Добранов/ }),
          "Space",
        );
        await activate(page, button(/^(Продължи|Напред:)/));
      }
      await verifyStep("Данни и преглед");
      await activate(page, button("Към преглед"));
      const name = page.getByRole("textbox", {
        name: "Име и фамилия",
        exact: true,
      });
      await expect(name).toBeFocused();
      await expect(name).toHaveAttribute("aria-invalid", "true");
      await expect(name).toHaveAccessibleDescription(/име/);
      await expect(
        page.getByRole("alert").filter({ hasText: /^Въведете име\.$/ }),
      ).toBeVisible();
      await verifyRendered("Грешки в данните");
      await page.keyboard.type("Demo Keyboard");
      for (const [label, value] of [
        ["Телефон", "0888123456"],
        ["Имейл", "keyboard@example.com"],
      ]) {
        await tabTo(
          page,
          page.getByRole("textbox", { name: label, exact: true }),
        );
        await page.keyboard.type(value);
      }
      await expectNoPersistence(page);
      const summaryTrigger = page.getByRole("button", { name: "Виж избора" });
      if (await summaryTrigger.isVisible())
        await activate(page, summaryTrigger);
      await activate(page, button("Промени датата и часа"));
      await verifyStep("Дата и час");
      await activate(page, button("Назад"));
      await verifyStep(
        path === "staff-first" ? "Специалист" : "Изберете услуги",
      );
      await activate(page, button(/^(Продължи|Напред:)/));
      await verifyStep("Дата и час");
      await chooseTime(page, "15:15");
      await expect(
        page.getByRole("radio", { name: "15:15", exact: true }),
      ).toBeChecked();
      await activate(page, button(/^(Продължи|Напред:)/));
      if (path === "time-first") {
        await verifyStep("Специалист");
        await activate(page, button(/^(Продължи|Напред:)/));
      }
      await verifyStep("Данни и преглед");
      await expect(name).toHaveValue("Demo Keyboard");
      await expect(
        page.getByRole("textbox", { name: "Имейл", exact: true }),
      ).toHaveValue("keyboard@example.com");
      const summary = page.getByRole("complementary", {
        name: "Вашата резервация",
      });
      await expect(summary).toContainText("50 мин");
      await expect(summary).toContainText(/35,00\s*€/);
      await expect(summary).toContainText("15:15–16:05");
      await activate(page, button("Към преглед"));
      await verifyRendered("Проверени данни");
      await expectNoPersistence(page);
      await activate(page, button(/^Потвърди резервация(?:та)?$/));
      await expect(button("Потвърждаваме…")).toBeDisabled();
      // Repeated keyboard activation while the first confirmation is pending.
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await verifyStep("Резервацията е потвърдена");
      await expectNoPersistence(page);
      await activate(
        page,
        page.getByText("Данни за контакт и нова резервация", { exact: true }),
      );
      await activate(page, button("Нова резервация"));
      await verifyStep("Изберете услуги");
      await expect(
        page.getByRole("checkbox", { name: /Подстригване/ }),
      ).not.toBeChecked();
      await expectNoPersistence(page);
      expect(
        requests.filter(
          (request) => !request.startsWith("http://127.0.0.1:3100/"),
        ),
      ).toEqual([]);
      for (const value of [
        "Demo Keyboard",
        "0888123456",
        "keyboard@example.com",
      ]) {
        expect(decodeURIComponent(requests.join("\n"))).not.toContain(value);
        expect(consoleMessages.join("\n")).not.toContain(value);
      }
      expect(errors).toEqual([]);
    });
  }
}
