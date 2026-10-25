import { expect, test } from "@playwright/test";

test.use({ timezoneId: "America/New_York" });

for (const path of ["staff-first", "time-first"] as const) {
  for (const scenario of ["conflict", "retryable", "stale"] as const) {
    test(`${path} recovers from ${scenario} without losing contact details`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
      if (scenario !== "stale") {
        // Demo-only bootstrap hook: one enum value, never visitor data.
        await page.addInitScript((value) => {
          Object.assign(window, { __SLOTWELL_DEMO_SCENARIO__: value });
        }, scenario);
      }
      const errors: string[] = [];
      const requests: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type()))
          errors.push(message.text());
      });
      page.on("request", (request) =>
        requests.push(`${request.url()} ${request.postData() ?? ""}`),
      );
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto("/");
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page
        .getByRole("radio", {
          name:
            path === "staff-first" ? "Първо специалист" : "Първо дата и час",
          exact: true,
        })
        .check();
      if (path === "staff-first") {
        await page.getByRole("radio", { name: /Мила/ }).check();
        await page.getByRole("button", { name: "Продължи" }).click();
        await page.getByRole("radio", { name: "15:00", exact: true }).check();
      } else {
        await page.getByRole("radio", { name: "15:00", exact: true }).check();
        await page.getByRole("button", { name: "Продължи" }).click();
        await page.getByRole("radio", { name: /Мила/ }).check();
      }
      await page.getByRole("button", { name: "Продължи" }).click();
      await page
        .getByRole("textbox", { name: "Име", exact: true })
        .fill("Демо Възстановяване");
      await page
        .getByRole("textbox", { name: "Телефон", exact: true })
        .fill("0888123456");
      await page
        .getByRole("textbox", { name: "Имейл", exact: true })
        .fill("recovery@example.com");
      await page
        .getByText("Добави бележка (по желание)", { exact: true })
        .click();
      await page
        .getByRole("textbox", { name: /Бележка/ })
        .fill("Запази бележката.");
      await page.getByRole("button", { name: "Провери данните" }).click();
      // Move only the wall clock so the selected time expires before confirm,
      // without letting the periodic refresh preempt the submit-time check.
      if (scenario === "stale")
        await page.clock.setFixedTime(new Date("2026-06-01T11:30:00Z"));
      await page
        .getByRole("button", {
          name: "Потвърди демо резервацията",
          exact: true,
        })
        .click();
      const summary = page.getByRole("complementary", { name: "Твоят избор" });
      await expect(summary).toContainText("Подстригване");
      if (scenario === "retryable") {
        await expect(
          page
            .getByRole("region", { name: "Данни и преглед" })
            .getByRole("alert"),
        ).toContainText("Опитай отново");
        await expect(summary).toContainText("15:00–15:30");
        await expect(summary).toContainText("Мила");
        const failure = page
          .getByRole("alert")
          .filter({ hasText: "Не успяхме да потвърдим" });
        await expect(failure).toHaveAttribute("data-variant", "error");
        await expect(failure).toHaveAttribute("aria-atomic", "true");
        const review = page.getByRole("region", {
          name: "Преглед и потвърждение",
          exact: true,
        });
        await expect(review).toContainText("Демо Възстановяване");
        await expect(review).toContainText("Запази бележката.");
        await expect(
          review.getByRole("button", {
            name: "Потвърди демо резервацията",
            exact: true,
          }),
        ).toHaveCount(0);
        await page.screenshot({
          path: `coverage/playwright/recovery-${path}-${scenario}.png`,
          fullPage: true,
        });
        const retry = page.getByRole("button", {
          name: "Опитай отново",
          exact: true,
        });
        await retry.focus();
        await page.keyboard.press("Enter");
      } else {
        await expect(
          page.getByRole("heading", { name: "Дата и час", exact: true }),
        ).toBeFocused();
        const recovery = page
          .getByRole("region", { name: "Дата и час", exact: true })
          .getByRole("alert");
        await expect(recovery).toHaveCount(1);
        await expect(recovery).toHaveAttribute("data-variant", "error");
        await expect(recovery).toHaveAttribute("aria-atomic", "true");
        await expect(recovery).toContainText(
          /[Дд]анните ти за контакт са запазени/,
        );
        for (const contact of [
          "Демо Възстановяване",
          "0888123456",
          "recovery@example.com",
          "Запази бележката.",
        ])
          await expect(recovery).not.toContainText(contact);
        if (scenario === "conflict" && path === "staff-first")
          await expect(
            page.getByRole("radio", { name: "15:00", exact: true }),
          ).toHaveCount(0);
        await expect(summary).not.toContainText("15:00–15:30");
        await expect(
          page.getByRole("radio", {
            name: "15:00",
            exact: true,
            checked: true,
          }),
        ).toHaveCount(0);
        await page.screenshot({
          path: `coverage/playwright/recovery-${path}-${scenario}.png`,
          fullPage: true,
        });
        await page.getByRole("radio", { name: "16:00", exact: true }).check();
        await page.getByRole("button", { name: "Продължи" }).click();
        if (path === "time-first") {
          await page.getByRole("radio", { name: /Мила/ }).check();
          await page.getByRole("button", { name: "Продължи" }).click();
        }
        for (const [name, value] of [
          ["Име", "Демо Възстановяване"],
          ["Телефон", "0888123456"],
          ["Имейл", "recovery@example.com"],
        ])
          await expect(
            page.getByRole("textbox", { name, exact: true }),
          ).toHaveValue(value);
        await page.getByRole("button", { name: "Провери данните" }).click();
        await page
          .getByRole("button", {
            name: "Потвърди демо резервацията",
            exact: true,
          })
          .click();
      }
      await expect(
        page.getByRole("heading", {
          name: "Демо резервацията е потвърдена",
          exact: true,
        }),
      ).toBeFocused();
      await expect(
        page.getByText("Запази бележката.", { exact: true }),
      ).toBeVisible();
      expect(new URL(page.url()).search).toBe("");
      expect(
        await page.evaluate(() => [localStorage.length, sessionStorage.length]),
      ).toEqual([0, 0]);
      expect(
        requests.filter(
          (request) => !request.startsWith("http://127.0.0.1:3100/"),
        ),
      ).toEqual([]);
      for (const contact of [
        "Демо Възстановяване",
        "0888123456",
        "recovery@example.com",
        "Запази бележката.",
      ])
        expect(decodeURIComponent(requests.join("\n"))).not.toContain(contact);
      expect(errors).toEqual([]);
    });
  }
  test(`${path} confirms once, retains demo occupancy on restart and clears everything on reload`, async ({
    page,
  }) => {
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(message.text());
    });
    page.on("request", (request) =>
      requests.push(`${request.url()} ${request.postData() ?? ""}`),
    );
    await page.clock.setFixedTime(new Date("2026-06-01T05:00:00Z"));
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    async function chooseServiceAndStaff() {
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page
        .getByRole("radio", { name: "Първо специалист", exact: true })
        .check();
      await page.getByRole("radio", { name: /Мила/ }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
    }
    if (path === "staff-first") {
      await chooseServiceAndStaff();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
    } else {
      await page.getByRole("checkbox", { name: /Подстригване/ }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page.getByRole("radio", { name: "Първо дата и час" }).check();
      await page.getByRole("radio", { name: "15:00", exact: true }).check();
      await page.getByRole("button", { name: "Продължи" }).click();
      await page.getByRole("radio", { name: /Мила/ }).check();
    }
    await page.getByRole("button", { name: "Продължи" }).click();
    await page
      .getByRole("textbox", { name: "Име", exact: true })
      .fill("Демо Посетител");
    await page
      .getByRole("textbox", { name: "Телефон", exact: true })
      .fill("0888123456");
    await page
      .getByRole("textbox", { name: "Имейл", exact: true })
      .fill("demo@example.com");
    await page
      .getByText("Добави бележка (по желание)", { exact: true })
      .click();
    const note =
      path === "staff-first"
        ? `Само демо бележка.\n${"ДългаБележка".repeat(80)}\nКрай на бележката.`
        : "Само демо бележка.";
    await page.getByRole("textbox", { name: /Бележка/ }).fill(note);
    await page.getByRole("button", { name: "Провери данните" }).click();
    const confirm = page.getByRole("button", {
      name: "Потвърди демо резервацията",
      exact: true,
    });
    await page.clock.pauseAt(new Date("2026-06-01T05:01:00Z"));
    await confirm.click();
    await expect(
      page.getByRole("button", { name: "Потвърждаваме…" }),
    ).toBeDisabled();
    const review = page.getByRole("region", {
      name: "Преглед и потвърждение",
      exact: true,
    });
    await expect(
      review.getByRole("status").filter({ hasText: "Проверяваме дали часът" }),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Редактирай данните за контакт" }),
    ).toBeDisabled();
    for (const button of await review.getByRole("button").all()) {
      await expect(button).toBeDisabled();
    }
    await expect(
      page.getByRole("button", { name: "Назад", exact: true }),
    ).toBeDisabled();
    await expect(review).toContainText("Демо Посетител");
    await expect(review).toHaveAttribute("aria-busy", "true");
    await page.screenshot({
      path: `coverage/playwright/state-confirming-${path}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 880 });
    const pendingSummary = page.getByRole("complementary", {
      name: "Твоят избор",
    });
    for (const button of await pendingSummary.getByRole("button").all()) {
      await expect(button).toBeDisabled();
    }
    await expect(
      page
        .getByRole("navigation", { name: "Стъпки на резервацията" })
        .getByRole("link"),
    ).toHaveCount(0);
    await page.screenshot({
      path: `coverage/playwright/state-confirming-${path}-desktop.png`,
      fullPage: true,
    });
    await page.clock.runFor(300);
    await page.setViewportSize({ width: 360, height: 800 });
    const heading = page.getByRole("heading", {
      name: "Демо резервацията е потвърдена",
      exact: true,
    });
    await expect(heading).toBeFocused();
    const visit = page.getByRole("region", { name: "Твоето посещение" });
    for (const text of ["Подстригване", "Мила", "15:00–15:30", "30 мин"])
      await expect(visit).toContainText(text);
    await expect(visit).toContainText(/23,00\s*€/);
    await expect(
      page.getByRole("heading", { name: "Какво означава „демо“?" }),
    ).toBeVisible();
    await expect(
      page.getByText("Това не е реална резервация.", { exact: false }),
    ).toBeVisible();
    const summary = page.getByRole("complementary", { name: "Твоят избор" });
    for (const text of [
      "Подстригване",
      "Мила",
      "15:00–15:30",
      "30 мин",
      "измислен адрес",
    ])
      await expect(summary).toContainText(text);
    await expect(summary).toContainText(/23,00\s*€/);
    await expect(visit.getByText("Специалист", { exact: true })).toBeVisible();
    await expect(visit.getByText("Дата и час", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Данни за контакт", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Няма достъп за управление на резервация/),
    ).toBeVisible();
    await expect(
      page.getByText(/Часът е зает само в тази демонстрация/),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: "Демо резервацията е потвърдена",
          exact: true,
        })
        .getByRole("link"),
    ).toHaveCount(0);
    for (const text of [
      "Демо Посетител",
      "0888123456",
      "demo@example.com",
      note,
    ])
      await expect(page.getByText(text, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Промени/ })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: `coverage/playwright/confirmation-${path}-mobile.png`,
      fullPage: true,
    });
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      const success = page.getByRole("region", {
        name: "Демо резервацията е потвърдена",
        exact: true,
      });
      expect(
        await success.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return Array.from(element.children).flatMap((child) => {
            if (getComputedStyle(child).position === "absolute") return [];
            const childBounds = child.getBoundingClientRect();
            if (childBounds.width === 0) return [];
            return childBounds.left < bounds.left - 1 ||
              childBounds.right > bounds.right + 1 ||
              child.scrollWidth > child.clientWidth
              ? [
                  {
                    tag: child.tagName,
                    width: childBounds.width,
                    parentWidth: bounds.width,
                  },
                ]
              : [];
          });
        }),
      ).toEqual([]);
      const displayedNote = page.getByText(note, { exact: true });
      await expect(displayedNote).toBeVisible();
      expect(
        await displayedNote.evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
      ).toBe(true);
      if (width === 390 || width === 1280)
        await page.screenshot({
          path: `coverage/playwright/confirmation-${path}-${width}.png`,
          fullPage: true,
        });
    }
    await page.screenshot({
      path: `coverage/playwright/confirmation-${path}-desktop.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "Нова демо резервация" }).click();
    await expect(
      page.getByRole("heading", { name: "Услуги", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("checkbox", { name: /Подстригване/ }),
    ).not.toBeChecked();
    await chooseServiceAndStaff();
    await expect(
      page.getByRole("radio", { name: "15:00", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("radio", { name: "16:00", exact: true }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await page
      .getByText("Добави бележка (по желание)", { exact: true })
      .click();
    for (const label of ["Име", "Телефон", "Имейл", "Бележка (по желание)"])
      await expect(
        page.getByRole("textbox", { name: label, exact: true }),
      ).toHaveValue("");
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: /Подстригване/ }),
    ).not.toBeChecked();
    await chooseServiceAndStaff();
    await expect(
      page.getByRole("radio", { name: "15:00", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "15:00", exact: true }).check();
    await page.getByRole("button", { name: "Продължи" }).click();
    await expect(
      page.getByRole("textbox", { name: "Име", exact: true }),
    ).toHaveValue("");
    expect(
      requests.filter(
        (request) => !request.startsWith("http://127.0.0.1:3100/"),
      ),
    ).toEqual([]);
    for (const contact of [
      "Демо Посетител",
      "0888123456",
      "demo@example.com",
      "Само демо бележка.",
      note,
    ])
      expect(decodeURIComponent(requests.join("\n"))).not.toContain(contact);
    expect(errors).toEqual([]);
  });
}
