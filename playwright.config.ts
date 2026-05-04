import { defineConfig, devices } from "@playwright/test";

const PLAYWRIGHT_NAVIGATION_TIMEOUT_MILLISECONDS = 60_000;
const PLAYWRIGHT_ACTION_TIMEOUT_MILLISECONDS = 60_000;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    navigationTimeout: PLAYWRIGHT_NAVIGATION_TIMEOUT_MILLISECONDS,
    actionTimeout: PLAYWRIGHT_ACTION_TIMEOUT_MILLISECONDS,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
