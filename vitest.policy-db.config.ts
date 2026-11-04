import { defineConfig } from "vitest/config";
import base from "./vitest.config.ts";

// Explicit owned synthetic seed only. Never joins the reset or general DB suites.
if (!process.env.QF_POLICY_SEED) throw Error("POLICY_FAULT_SEED_REQUIRED");
export default defineConfig({
  ...base,
  test: {
    environment: "node",
    include: ["tests/analysis/consumer-policy-recovery-faults.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 15000,
  },
});
