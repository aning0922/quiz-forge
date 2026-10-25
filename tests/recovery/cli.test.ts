import { describe, expect, it, vi } from "vitest";
import {
  parseRecoveryCommand,
  runRecoveryCli,
} from "@/features/runtime-recovery/cli";
import type { RecoveryService } from "@/features/runtime-recovery/service";
import { RecoveryError } from "@/features/runtime-recovery/errors";
import { freshBudget } from "./artifact-fixture";

const sha = "a".repeat(64);
const id = "b".repeat(32);
function service() {
  return {
    doctor: vi.fn<RecoveryService["doctor"]>().mockResolvedValue({
      status: "environment-verified",
      codeSha256: sha,
      fileCount: 1,
      bytes: 10,
      postgresVersion: 180004,
    }),
    backup: vi
      .fn<RecoveryService["backup"]>()
      .mockResolvedValue({ backupId: "synthetic-id", manifestSha256: sha }),
    verify: vi.fn<RecoveryService["verify"]>().mockResolvedValue({
      status: "integrity-verified",
      backupId: "synthetic-id",
      manifestSha256: sha,
    }),
    restore: vi.fn<RecoveryService["restore"]>().mockResolvedValue({
      instanceId: id,
      root: "/synthetic/private/root",
      pgPort: 55426,
      origin: "http://127.0.0.1:55427",
      manifestSha256: sha,
      databaseGraphSha256: sha,
      storageSha256: sha,
      status: "verified-stopped",
    }),
  };
}
describe("finite recovery CLI", () => {
  it.each([
    [],
    ["doctor", "--extra=x"],
    ["backup", `--instance=${id}`, "--out=relative"],
    ["backup", `--instance=${id}`, "--out=/tmp/new", "--out=/tmp/other"],
    ["verify", "--bundle=/tmp/new"],
    ["verify", "--bundle=/tmp/../secret", `--manifest-sha=${sha}`],
    ["verify", "--bundle=/tmp/new", `--manifest-sha=${sha}`, "--unknown=x"],
    [
      "restore",
      "--bundle=/tmp/new",
      `--manifest-sha=${sha}`,
      "--pg-port=5432",
      "--origin=http://127.0.0.1:55427",
    ],
    [
      "restore",
      "--bundle=/tmp/new",
      `--manifest-sha=${sha}`,
      "--pg-port=55426",
      "--origin=http://localhost:55427",
    ],
  ])(
    "rejects malformed arguments without invoking a service: %j",
    async (...args) => {
      const ports = service();
      const result = await runRecoveryCli(args, ports, freshBudget());
      expect(result).toEqual({
        exitCode: 1,
        output: { code: "RECOVERY_ARGUMENTS_INVALID" },
      });
      for (const call of Object.values(ports))
        expect(call).not.toHaveBeenCalled();
    },
  );
  it("parses restore with explicit SHA, independent port and loopback origin", () => {
    expect(
      parseRecoveryCommand([
        "restore",
        "--bundle=/tmp/new",
        `--manifest-sha=${sha}`,
        "--pg-port=55426",
        "--origin=http://127.0.0.1:55427",
      ]),
    ).toEqual({
      kind: "restore",
      directory: "/tmp/new",
      expectedManifestSha256: sha,
      pgPort: 55426,
      origin: "http://127.0.0.1:55427",
    });
  });
  it("outputs only approved restore evidence, without private target paths", async () => {
    const result = await runRecoveryCli(
      [
        "restore",
        "--bundle=/tmp/new",
        `--manifest-sha=${sha}`,
        "--pg-port=55426",
        "--origin=http://127.0.0.1:55427",
      ],
      service(),
      freshBudget(),
    );
    expect(result.exitCode).toBe(0);
    expect(result.output.status).toBe("verified-stopped");
    expect(JSON.stringify(result)).not.toContain("/synthetic/private");
    expect(Object.keys(result.output).sort()).toEqual([
      "databaseGraphSha256",
      "manifestSha256",
      "status",
      "storageSha256",
    ]);
  });
  it.each([
    new Error("password=synthetic-private-credential /private/path"),
    new RecoveryError("RECOVERY_CLOSE_UNPROVEN"),
  ])("never exposes arbitrary service errors", async (error) => {
    const ports = service();
    ports.doctor.mockRejectedValue(error);
    const result = await runRecoveryCli(["doctor"], ports, freshBudget());
    expect(result.exitCode).toBe(1);
    expect(result.output).toEqual({
      code:
        error instanceof RecoveryError
          ? error.code
          : "RECOVERY_OPERATION_FAILED",
    });
    expect(JSON.stringify(result)).not.toContain(
      "synthetic-private-credential",
    );
  });
});
