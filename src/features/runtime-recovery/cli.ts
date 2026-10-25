import {
  recoveryOriginSchema,
  recoveryPortSchema,
  recoveryRootSchema,
} from "./contracts";
import { RecoveryError, safeRecoveryError } from "./errors";
import type { RecoveryBudget } from "./ports";
import type { RecoveryService } from "./service";

export type RecoveryCommand =
  | { kind: "doctor" }
  | { kind: "backup"; instanceId: string; directory: string }
  | { kind: "verify"; directory: string; expectedManifestSha256: string }
  | {
      kind: "restore";
      directory: string;
      expectedManifestSha256: string;
      pgPort: number;
      origin: string;
    };
const invalid = () => new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
export function parseRecoveryCommand(args: readonly string[]): RecoveryCommand {
  if (args.length > 8 || args.some((arg) => arg.length > 4096)) throw invalid();
  const [kind, ...rest] = args;
  if (kind === "doctor" && !rest.length) return { kind };
  if (!["backup", "verify", "restore"].includes(kind ?? "")) throw invalid();
  const values = new Map<string, string>();
  for (const arg of rest) {
    const match = /^--([a-z][a-z-]*)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!)) throw invalid();
    values.set(match[1]!, match[2]!);
  }
  const take = (name: string) => {
    const value = values.get(name);
    if (value === undefined) throw invalid();
    values.delete(name);
    return value;
  };
  if (kind === "backup") {
    const instanceId = take("instance");
    const directory = take("out");
    if (
      !/^[a-f0-9]{32}$/.test(instanceId) ||
      !recoveryRootSchema.safeParse(directory).success ||
      values.size
    )
      throw invalid();
    return { kind, instanceId, directory };
  }
  const directory = take("bundle");
  const expectedManifestSha256 = take("manifest-sha");
  if (
    !recoveryRootSchema.safeParse(directory).success ||
    !/^[a-f0-9]{64}$/.test(expectedManifestSha256)
  )
    throw invalid();
  if (kind === "verify") {
    if (values.size) throw invalid();
    return { kind, directory, expectedManifestSha256 };
  }
  const port = take("pg-port");
  const origin = take("origin");
  if (
    !/^[1-9][0-9]{3,4}$/.test(port) ||
    !recoveryPortSchema.safeParse(Number(port)).success ||
    !recoveryOriginSchema.safeParse(origin).success ||
    values.size
  )
    throw invalid();
  return {
    kind: "restore",
    directory,
    expectedManifestSha256,
    pgPort: Number(port),
    origin,
  };
}

/** Only allowlisted DTOs leave the CLI, even when a port throws a sensitive driver error. */
export async function runRecoveryCli(
  args: readonly string[],
  service: RecoveryService,
  budget: RecoveryBudget,
): Promise<{ exitCode: 0 | 1; output: Record<string, unknown> }> {
  try {
    const command = parseRecoveryCommand(args);
    switch (command.kind) {
      case "doctor": {
        const result = await service.doctor(budget);
        return {
          exitCode: 0,
          output: {
            status: result.status,
            postgresVersion: result.postgresVersion,
            codeSha256: result.codeSha256,
            fileCount: result.fileCount,
            bytes: result.bytes,
          },
        };
      }
      case "backup": {
        const result = await service.backup(command, budget);
        return {
          exitCode: 0,
          output: {
            status: "sealed",
            backupId: result.backupId,
            manifestSha256: result.manifestSha256,
          },
        };
      }
      case "verify": {
        const result = await service.verify(command, budget);
        return {
          exitCode: 0,
          output: {
            status: result.status,
            backupId: result.backupId,
            manifestSha256: result.manifestSha256,
          },
        };
      }
      case "restore": {
        const result = await service.restore(command, budget);
        return {
          exitCode: 0,
          output: {
            status: result.status,
            manifestSha256: result.manifestSha256,
            sourceDatabaseGraphSha256: result.sourceDatabaseGraphSha256,
            databaseGraphSha256: result.databaseGraphSha256,
            authenticationRevocation: result.authenticationRevocation,
            storageSha256: result.storageSha256,
          },
        };
      }
    }
  } catch (error) {
    return { exitCode: 1, output: safeRecoveryError(error) };
  }
}
