import { test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { InternalSuiteCompletion } from "../e2e/studio-internal-versions.completion";
const cases = ["case0", "case1", "case2", "case3", "case4", "case5"],
  completion = new InternalSuiteCompletion(cases);
const mode = process.env.QF_INTERNAL_COMPLETION_MODE,
  output = process.env.QF_INTERNAL_NETWORK_PROBE_OUTPUT;
if (!output || !path.isAbsolute(output))
  throw Error("COMPLETION_ONLY_OUTPUT_REQUIRED");
test.describe.configure({ mode: "serial" });
test.afterEach(async ({}, info) => {
  const observation = {
    title: info.title,
    status: info.status,
    expectedStatus: info.expectedStatus,
    retry: info.retry,
    repeatEachIndex: info.repeatEachIndex,
    configuredRepeats: info.project.repeatEach,
    configuredProjects: info.config.projects.map((p) => ({
      name: p.name,
      repeatEach: p.repeatEach,
    })),
  };
  completion.observe(info);
  await writeFile(
    path.join(output, "observations.jsonl"),
    JSON.stringify(observation) + "\n",
    { flag: "a", mode: 0o600 },
  );
});
test.afterAll(async () => {
  if (!completion.canFinish())
    throw Error("INTERNAL_VERSION_E2E_FULL_SUITE_REQUIRED");
  await writeFile(
    path.join(output, "eligible-to-finish.json"),
    JSON.stringify({
      qualification: "completion-only-no-instance-no-fixture",
      eligible: true,
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
});
for (const [index, title] of cases.entries())
  test(title, async ({}, info) => {
    if (index !== 5) return;
    if (mode === "skip") test.skip(true, "synthetic completion guard");
    if (mode === "xfail") {
      test.fail();
      throw Error("SYNTHETIC_EXPECTED_FAILURE");
    }
    if (mode === "xpass") test.fail();
    if (mode === "retry" && info.retry === 0) throw Error("SYNTHETIC_RETRY");
  });
if (mode === "extra") test("unknown-case", () => {});
