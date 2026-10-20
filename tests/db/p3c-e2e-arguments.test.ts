import { expect, it } from "vitest";
import { previewE2eArguments } from "../../scripts/p3c-e2e-arguments";
it.each([
  ["-V"],
  ["--version"],
  ["--ui"],
  ["--ui-host", "127.0.0.1"],
  ["--ui-port=3000"],
  ["--list"],
  ["--help"],
  ["-cother.ts"],
  ["--config=other.ts"],
  ["--grep", "--version"],
  ["--project=unknown"],
  ["--grep=a", "--grep=b"],
])("refuses non-test or ambiguous forwarded args %j", (...args: string[]) => {
  expect(() => previewE2eArguments(args)).toThrow(
    "MANAGED_E2E_ARGUMENTS_INVALID",
  );
});
it("keeps actual selectors in canonical inline form without changing the owned config", () => {
  expect(previewE2eArguments([])).toEqual([]);
  expect(previewE2eArguments(["--project=studio-draft-revisions"])).toEqual([
    "--project=studio-draft-revisions",
  ]);
  expect(
    previewE2eArguments([
      "--project",
      "studio-preview",
      "--grep",
      "actual six-state",
      "--grep-invert=timeout",
    ]),
  ).toEqual([
    "--project=studio-preview",
    "--grep=actual six-state",
    "--grep-invert=timeout",
  ]);
});
