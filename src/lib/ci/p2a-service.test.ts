import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Exercise only the production cleanup function with a shell stub; never run Docker or create credentials.
const source = await readFile("scripts/ci-p2a-service.sh", "utf8");
const cleanup = source.slice(
  source.indexOf("cleanup() {"),
  source.indexOf("\ntrap cleanup EXIT"),
);

describe("disposable CI service cleanup receipt", () => {
  it.each([
    ["owned", 0, true, ""],
    ["inspect-failed", 1, false, "P2A_CI_CLEANUP_IDENTITY_UNVERIFIED"],
    ["wrong-label", 1, false, "P2A_CI_CLEANUP_IDENTITY_UNVERIFIED"],
    ["invalid-id", 1, false, "P2A_CI_CLEANUP_IDENTITY_UNVERIFIED"],
    ["delete-failed", 1, true, "P2A_CI_CLEANUP_FAILED"],
  ] as const)(
    "%s reports truthfully without deleting an unverified container",
    async (scenario, code, deletes, error) => {
      const directory = await mkdtemp(path.join(tmpdir(), "qf-ci-cleanup-"));
      const marker = `${directory}.removed`;
      try {
        await writeFile(
          path.join(directory, "container-id"),
          scenario === "invalid-id" ? "invalid" : "a".repeat(64),
        );
        const outcome = spawnSync(
          "bash",
          [
            "-c",
            `
set -euo pipefail
ci_service_dir="$1"
ci_service_id=fixture-owned-instance
scenario="$2"
marker="$3"
docker() {
  if [[ "$1" == inspect ]]; then
    [[ "$scenario" != inspect-failed ]] || return 1
    if [[ "$scenario" == wrong-label ]]; then printf different-instance; else printf fixture-owned-instance; fi
  else
    touch "$marker"
    [[ "$scenario" != delete-failed ]]
  fi
}
${cleanup}
true
cleanup
`,
            "cleanup-test",
            directory,
            scenario,
            marker,
          ],
          { encoding: "utf8", timeout: 2000 },
        );
        expect(outcome.error).toBeUndefined();
        expect(outcome.status).toBe(code);
        expect(outcome.stderr.trim()).toBe(error);
        expect(
          await readFile(marker).then(
            () => true,
            () => false,
          ),
        ).toBe(deletes);
        expect(
          await readFile(path.join(directory, "container-id")).then(
            () => true,
            () => false,
          ),
        ).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(marker, { force: true });
      }
    },
  );
});
