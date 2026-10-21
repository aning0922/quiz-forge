import { expect, it } from "vitest";
import { parseRecoverySourceOptions } from "./source-options";

it("can prepare a new seven-day source on explicit independent ports without selecting old instance IDs", () => {
  expect(
    parseRecoverySourceOptions([
      "--pg-port=55430",
      "--origin=http://127.0.0.1:55431",
    ]),
  ).toEqual({
    pgPort: 55430,
    httpPort: 55431,
    origin: "http://127.0.0.1:55431",
  });
  expect(() =>
    parseRecoverySourceOptions(["--instance=" + "a".repeat(32)]),
  ).toThrow("RECOVERY_ARGUMENTS_INVALID");
});
it.each([3100, 5432, 55423, 55426, 55427])(
  "refuses protected/reserved listener %s before preparation",
  (port) => {
    expect(() =>
      parseRecoverySourceOptions([
        `--pg-port=${port}`,
        "--origin=http://127.0.0.1:55431",
      ]),
    ).toThrow();
    expect(() =>
      parseRecoverySourceOptions([
        "--pg-port=55430",
        `--origin=http://127.0.0.1:${port}`,
      ]),
    ).toThrow();
  },
);
