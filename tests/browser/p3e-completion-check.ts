import assert from "node:assert/strict";
import { InternalSuiteCompletion } from "../e2e/studio-internal-versions.completion";
const cases = ["record", "seal", "read-only", "history", "late", "authority"];
const pass = (title: string) => ({
  title,
  status: "passed",
  expectedStatus: "passed",
  retry: 0,
  repeatEachIndex: 0,
});
let checks = 0;
const complete = new InternalSuiteCompletion(cases);
for (const title of cases) complete.observe(pass(title));
assert.equal(complete.canFinish(), true);
checks++;
for (const last of [
  undefined,
  { ...pass(cases[5]!), status: "skipped" },
  { ...pass(cases[5]!), status: "failed", expectedStatus: "failed" },
  { ...pass(cases[5]!), expectedStatus: "failed" },
  { ...pass(cases[5]!), retry: 1 },
  { ...pass(cases[5]!), repeatEachIndex: 1 },
  pass(cases[0]!),
  pass("unknown"),
]) {
  const ledger = new InternalSuiteCompletion(cases);
  for (const title of cases.slice(0, 5)) ledger.observe(pass(title));
  if (last) ledger.observe(last);
  assert.equal(ledger.canFinish(), false);
  checks++;
}
complete.observe(pass(cases[0]!));
assert.equal(complete.canFinish(), false);
checks++;
assert.throws(() => new InternalSuiteCompletion(cases.slice(0, 5)));
checks++;
console.log(
  JSON.stringify({
    qualification: "pure-completion-no-fixture",
    checks,
    passed: true,
  }),
);
