import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";

import type { BookingReceipt, BookingSubmission } from "@/server/booking";
import {
  type PersistedBrowserServer,
  withPersistedBrowserServer,
} from "../scripts/e2e-db";

/** Real catalog/staff/availability through the owned production server; no API mocks. */
export async function enterPersistedDetails(
  page: Page,
  persisted: PersistedBrowserServer,
) {
  const scenario = await persisted.booking();
  const clock = (instant: string) =>
    new Intl.DateTimeFormat("bg-BG", {
      timeZone: "Europe/Sofia",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(instant));
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
  }).format(new Date(scenario.input.startsAt));
  const end = new Date(
    Date.parse(scenario.input.startsAt) + 30 * 60_000,
  ).toISOString();
  const range = `${clock(scenario.input.startsAt)}–${clock(end)}`;
  await page.goto("/book");
  await page.getByRole("checkbox", { name: /Мъжко подстригване/ }).check();
  await page
    .getByRole("button", { name: "Продължи към избор на специалист" })
    .click();
  await page
    .getByRole("radio", { name: "Павел Добранов", exact: true })
    .check();
  await page.getByRole("button", { name: "Продължи към дата и час" }).click();
  await expect(
    page.getByText("Часова зона: Europe/Sofia", { exact: true }),
  ).toBeVisible();
  // Scenario is the first available day in tomorrow's rolling seven-day window.
  // It can be on the next UI page when tomorrow + six is the only available day.
  if (!(await page.locator(`#date-${date}`).count()))
    await page.getByRole("button", { name: "Следващи дни" }).click();
  const dateLabel = new Intl.DateTimeFormat("bg-BG", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T00:00:00Z`));
  await page
    .getByRole("radiogroup", { name: "Дати", exact: true })
    .getByRole("radio", { name: dateLabel, exact: true })
    .check();
  await page.getByRole("radio", { name: range, exact: true }).check();
  await page.getByRole("button", { name: "Продължи към данните" }).click();
  await expect(
    page.getByRole("heading", { name: "Вашите данни" }),
  ).toBeFocused();
  return { scenario, range };
}

export async function fillPersistedContact(page: Page) {
  await page
    .getByRole("textbox", { name: "Име", exact: true })
    .fill("Fictional Journey Guest");
  await page
    .getByRole("textbox", { name: "Телефон", exact: true })
    .fill("0888123456");
  await page
    .getByRole("textbox", { name: "Имейл", exact: true })
    .fill("journey@example.test");
  await page
    .getByRole("textbox", { name: "Бележка (по желание)", exact: true })
    .fill("Fictional note");
}

export async function reviewPersistedBooking(page: Page) {
  await page.getByRole("button", { name: "Прегледай резервацията" }).click();
  await expect(
    page.getByRole("heading", { name: "Проверете и потвърдете" }),
  ).toBeFocused();
}

export const confirmPersistedBooking = (page: Page) =>
  page.getByRole("button", { name: "Потвърди резервацията", exact: true });

export async function expectPersistedConfirmation(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Резервацията е потвърдена" }),
  ).toBeVisible();
  // Only public labels, never the fragment/receipt, enter assertion diagnostics.
  await expect(
    page.getByText("Мъжко подстригване", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Павел Добранов", { exact: true })).toBeVisible();
}

type SubmissionResult = {
  status: number;
  receipt: BookingReceipt | null;
  code: string | null;
};
type PrivateFixtures = {
  privateArtifacts: undefined;
  submit: (submission: BookingSubmission) => Promise<SubmissionResult>;
  openConfirmation: (receipt: BookingReceipt) => Promise<void>;
  reloadConfirmation: () => Promise<void>;
};

export function assertPrivateArtifactPolicy(
  info: Pick<TestInfo, "project" | "config">,
  origin: string,
) {
  const settings = info.project.use;
  if (
    new URL(origin).hostname !== "127.0.0.1" ||
    settings.trace !== "off" ||
    settings.screenshot !== "off" ||
    settings.video !== "off" ||
    settings.serviceWorkers !== "block" ||
    settings.reuseContext === true ||
    settings.connectOptions !== undefined ||
    settings.storageState !== undefined ||
    settings.contextOptions?.recordVideo !== undefined ||
    settings.contextOptions?.recordHar !== undefined ||
    process.env.PLAYWRIGHT_NO_COPY_PROMPT !== "1" ||
    info.config.reporter.some(([reporter]) => reporter !== "list")
  )
    throw new Error("Private browser artifact policy refused");
}

export const test = base.extend<
  PrivateFixtures,
  { persisted: PersistedBrowserServer }
>({
  persisted: [
    async ({ browserName }, use) => {
      if (browserName !== "chromium")
        throw new Error("Persisted browser fixture requires Chromium");
      await withPersistedBrowserServer(use);
    },
    { scope: "worker", timeout: 60000 },
  ],
  baseURL: async ({ persisted }, use) => {
    await use(persisted.origin);
  },
  privateArtifacts: [
    async ({ persisted }, use, info) => {
      assertPrivateArtifactPolicy(info, persisted.origin);
      await use(undefined);
    },
    { auto: true },
  ],
  submit: async ({ page }, use) => {
    await use(async (submission) => {
      try {
        return await page.evaluate(async (value) => {
          const response = await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...value.authorization,
              booking: value.input,
            }),
          });
          const body = await response.json();
          return {
            status: response.status,
            receipt: response.ok
              ? {
                  appointmentId: body.appointmentId,
                  viewToken: body.viewToken,
                  confirmationExpiresAt: body.confirmationExpiresAt,
                }
              : null,
            code: body.error?.code ?? null,
          };
        }, submission);
      } catch {
        throw new Error("Private booking request failed");
      }
    });
  },
  openConfirmation: async ({ page, persisted }, use) => {
    await use(async (receipt) => {
      try {
        const fragment = new URLSearchParams({
          appointmentId: receipt.appointmentId,
          viewToken: receipt.viewToken,
        });
        await page.goto(`${persisted.origin}/confirmation#${fragment}`);
      } catch {
        throw new Error("Private confirmation navigation failed");
      }
    });
  },
  reloadConfirmation: async ({ page }, use) => {
    await use(async () => {
      try {
        await page.reload();
      } catch {
        throw new Error("Private confirmation reload failed");
      }
    });
  },
});
