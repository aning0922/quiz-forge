import {
  recoveryOriginSchema,
  recoveryPortSchema,
} from "@/features/runtime-recovery/contracts";
import { RecoveryError } from "@/features/runtime-recovery/errors";

/** Parameters select only new source listeners, never an existing logical instance. */
export function parseRecoverySourceOptions(args: readonly string[]) {
  if (!args.length)
    return { pgPort: 55422, origin: "http://127.0.0.1:55428", httpPort: 55428 };
  if (args.length !== 2) throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(pg-port|origin)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!))
      throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
    values.set(match[1]!, match[2]!);
  }
  const port = values.get("pg-port") ?? "";
  const origin = values.get("origin") ?? "";
  if (
    !/^[1-9][0-9]{3,4}$/.test(port) ||
    !recoveryPortSchema.safeParse(Number(port)).success ||
    !recoveryOriginSchema.safeParse(origin).success
  )
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  const pgPort = Number(port),
    httpPort = Number(new URL(origin).port);
  // 3100 belongs to root E2E; 55423 is the protected original instance; 55426/7 are restore slots.
  if (
    pgPort === httpPort ||
    [pgPort, httpPort].some((p) =>
      [3100, 5432, 55423, 55426, 55427].includes(p),
    )
  )
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  return { pgPort, origin, httpPort };
}
