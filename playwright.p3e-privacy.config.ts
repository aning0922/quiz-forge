import { defineConfig } from "@playwright/test";
import path from "node:path";
const output = process.env.QF_INTERNAL_NETWORK_PROBE_OUTPUT;
if (
  !output ||
  !path.isAbsolute(output) ||
  !output.startsWith(path.resolve(".cache/p3e-network-privacy") + path.sep)
)
  throw Error("SYNTHETIC_PRIVACY_OUTPUT_REQUIRED");
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["p3e-network-privacy.spec.ts", "p3e-completion.spec.ts"],
  workers: 1,
  retries: 0,
  outputDir: path.join(output, "artifacts"),
  reporter: [
    ["json", { outputFile: path.join(output, "result.json") }],
    ["html", { outputFolder: path.join(output, "html"), open: "never" }],
  ],
  use: { trace: "off", video: "off", screenshot: "off", headless: true },
});
