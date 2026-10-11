import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** WebKit engine emulation is additional evidence, never an iPhone Safari claim. */
export default defineConfig({
  ...base,
  testMatch: ["d1c-experience.spec.ts", "d1c-poster.spec.ts"],
  projects: [
    {
      name: "d1c-webkit",
      use: {
        browserName: "webkit",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
