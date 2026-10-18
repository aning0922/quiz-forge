import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";
// This nonce is routing metadata, not exit authority. The runner alone holds the private owner/proof.
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    process.env.QF_PREVIEW_E2E_RUN_ID ?? "",
  )
) {
  throw Error("MANAGED_E2E_RUNNER_REQUIRED");
}
const ownedBase = { ...base };
delete ownedBase.webServer;
export default defineConfig({
  ...ownedBase,
  projects: [
    ...(base.projects ?? []),
    {
      name: "studio-draft-revisions",
      testMatch: "**/studio-draft-revisions.spec.ts",
      dependencies: ["studio-preview"],
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
      name: "studio-preview",
      testMatch: "**/studio-preview.spec.ts",
      dependencies: ["studio-drafts"],
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
});
