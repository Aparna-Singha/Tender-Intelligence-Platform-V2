import { defineConfig } from "@playwright/test";

const webBaseUrl = process.env.WEB_APP_URL ?? "http://127.0.0.1:3000";
const apiBaseUrl =
  process.env.API_PUBLIC_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:4000";
const workerBaseUrl = `http://127.0.0.1:${process.env.WORKER_HEALTH_PORT ?? "4001"}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webBaseUrl,
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "pnpm --filter @tender/api start",
      reuseExistingServer: true,
      url: `${apiBaseUrl}/ready`,
    },
    {
      command: "pnpm --filter @tender/worker start",
      reuseExistingServer: true,
      url: `${workerBaseUrl}/ready`,
    },
    {
      command: "pnpm --filter @tender/web start",
      reuseExistingServer: true,
      url: `${webBaseUrl}/login`,
    },
  ],
});
