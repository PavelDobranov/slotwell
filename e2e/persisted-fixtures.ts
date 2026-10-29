import { test as base, type TestInfo } from "@playwright/test";

import type { BookingReceipt, BookingSubmission } from "@/server/booking";
import {
  type PersistedBrowserServer,
  withPersistedBrowserServer,
} from "../scripts/e2e-db";

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
