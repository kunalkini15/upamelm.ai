import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.MUSE_BASE_URL ?? "http://127.0.0.1:5210",
    trace: "retain-on-failure",
    ...(process.env.MUSE_CHROME_CHANNEL
      ? { channel: process.env.MUSE_CHROME_CHANNEL as "chrome" }
      : {}),
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        browserName: (process.env.MUSE_BROWSER as "chromium" | "firefox" | "webkit" | undefined) ?? "chromium",
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: process.env.MUSE_NO_SERVER
    ? undefined
    : {
        command: "npm run preview -- --port 5210 --strictPort",
        port: 5210,
        reuseExistingServer: false,
        stdout: "pipe",
        stderr: "pipe",
      },
});
