import { expect, it } from "vitest";
import { ConsumerSuiteCompletion } from "../../../../tests/e2e/consumer-flow.fixture";
import { CONSUMER_E2E_CASES } from "../../../../tests/db/p4-consumer-fixture-contract";

const pass = (title: string) => ({
  title,
  status: "passed",
  expectedStatus: "passed",
  retry: 0,
  repeatEachIndex: 0,
});
it("cannot finish a filtered run, skipped/expected failure, retry, repeat, duplicate or unknown case", () => {
  const incomplete = new ConsumerSuiteCompletion();
  for (const title of CONSUMER_E2E_CASES.slice(0, -1))
    incomplete.observe(pass(title));
  expect(incomplete.canFinish()).toBe(false);
  expect(() => incomplete.receipt()).toThrow("CONSUMER_E2E_SUITE_INCOMPLETE");
  for (const bad of [
    { ...pass(CONSUMER_E2E_CASES[0]), status: "skipped" },
    { ...pass(CONSUMER_E2E_CASES[0]), expectedStatus: "failed" },
    { ...pass(CONSUMER_E2E_CASES[0]), retry: 1 },
    { ...pass(CONSUMER_E2E_CASES[0]), repeatEachIndex: 1 },
    pass("unregistered-case"),
    pass(CONSUMER_E2E_CASES[0]),
  ]) {
    const completion = new ConsumerSuiteCompletion();
    for (const title of CONSUMER_E2E_CASES) completion.observe(pass(title));
    completion.observe(bad);
    expect(completion.canFinish()).toBe(false);
  }
});
it("requires each of the exact eight actual first-run successful cases", () => {
  const completion = new ConsumerSuiteCompletion();
  for (const title of [...CONSUMER_E2E_CASES].reverse())
    completion.observe(pass(title));
  expect(completion.canFinish()).toBe(true);
});
