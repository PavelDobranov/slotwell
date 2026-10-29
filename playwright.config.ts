import { defineConfig, devices } from "@playwright/test";

const persisted =
  process.env.SLOTWELL_BROWSER_TEST !== undefined ||
  process.env.SLOTWELL_BROWSER_SCHEMA !== undefined;
if (persisted) {
  if (process.env.SLOTWELL_BROWSER_TEST !== "private-schema-v1") {
    throw new Error("Explicit browser test environment required");
  }
  if (
    process.env.DEBUG ||
    process.env.PWDEBUG ||
    process.env.PW_TEST_REUSE_CONTEXT
  ) {
    throw new Error("Private browser tests forbid debug and reused contexts");
  }
  // Installed Playwright otherwise takes automatic AI/DOM failure snapshots.
  process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: persisted ? "**/persisted-real*.spec.ts" : undefined,
  testIgnore: persisted ? [] : "**/persisted-real*.spec.ts",
  fullyParallel: persisted,
  workers: persisted ? 2 : undefined,
  outputDir: persisted
    ? "./coverage/playwright/persisted-results"
    : "./coverage/playwright/results",
  reporter: persisted
    ? [["list"]]
    : [
        ["list"],
        ["html", { outputFolder: "coverage/playwright/report", open: "never" }],
      ],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: persisted ? "off" : "retain-on-failure",
    ...(persisted
      ? {
          screenshot: "off" as const,
          video: "off" as const,
          serviceWorkers: "block" as const,
        }
      : {}),
  },
  projects: [
    {
      name: persisted ? "persisted-chromium" : "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Run `npm run build` first; never test against a development server.
  webServer: persisted
    ? undefined
    : {
        command: "npm run start -- --hostname 127.0.0.1 --port 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
