import { defineConfig, devices } from "@playwright/test";

const apiPort = 3101;
const webPort = 5174;
const baseURL = `http://127.0.0.1:${webPort}`;
const e2eDatabasePath = "/tmp/focusai-e2e.db";
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    launchOptions: executablePath ? { executablePath } : undefined,
    ...devices["Desktop Chrome"],
  },
  webServer: [
    {
      command: `rm -f ${e2eDatabasePath} ${e2eDatabasePath}-shm ${e2eDatabasePath}-wal && FOCUSAI_DATABASE_PATH=${e2eDatabasePath} FOCUSAI_API_PORT=${apiPort} FOCUSAI_COOKIE_SECURE=false FOCUSAI_CORS_ORIGIN=${baseURL} npm run start --workspace=@focusai/api`,
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: [
        `FOCUSAI_API_PROXY=http://127.0.0.1:${apiPort}`,
        "npm run dev --workspace=@focusai/web -- --port 5174",
      ].join(" "),
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
