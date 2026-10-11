import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    {
      name: "mobile-chromium",
      testIgnore: [
        "**/studio-auth.spec.ts",
        "**/studio-workspace.spec.ts",
        "**/studio-imports.spec.ts",
      ],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "desktop-chromium",
      testIgnore: [
        "**/studio-auth.spec.ts",
        "**/studio-workspace.spec.ts",
        "**/studio-imports.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "studio-imports",
      testMatch: "**/studio-imports.spec.ts",
      dependencies: ["studio-workspace"],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
    {
      name: "studio-workspace",
      testMatch: "**/studio-workspace.spec.ts",
      dependencies: ["studio-auth"],
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
    {
      name: "studio-auth",
      testMatch: "**/studio-auth.spec.ts",
      fullyParallel: false,
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
  ],
  webServer: {
    command: "corepack pnpm start --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
