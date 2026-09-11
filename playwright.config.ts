import { defineConfig, devices } from "@playwright/test";

const TEST_DB =
  process.env.DATABASE_URL_TEST ||
  "postgresql://gunce:gunce@localhost:5432/gunce_test?schema=public";

const PORT = Number(process.env.E2E_PORT || 3100);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET || "e2e-secret-please-change-32chars!!";

// Ensure the test runner + Playwright worker code use the same DB + auth secret.
process.env.DATABASE_URL = TEST_DB;
process.env.DATABASE_URL_TEST = TEST_DB;
process.env.BETTER_AUTH_SECRET = BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_URL = baseURL;
process.env.NEXT_PUBLIC_APP_URL = baseURL;
process.env.GUNCE_MAIL_TEST_CAPTURE = "1";
process.env.GUNCE_ALLOW_MAIL_TEST_CAPTURE = "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npx next start --hostname 127.0.0.1 --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB,
      BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      // Deterministic transcription/summary stubs for the local Playwright server only.
      // GUNCE_ALLOW_AI_TEST_STUBS is required because `next start` uses NODE_ENV=production.
      GUNCE_AI_TEST_MODE: "1",
      GUNCE_ALLOW_AI_TEST_STUBS: "1",
      // Cross-process mail capture for auth email e2e (not a public route).
      GUNCE_MAIL_TEST_CAPTURE: "1",
      GUNCE_ALLOW_MAIL_TEST_CAPTURE: "1",
    },
  },
});
