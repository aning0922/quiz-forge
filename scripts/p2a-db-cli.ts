import { StudioError } from "../src/lib/http-security/errors";
import { ManagementError } from "../src/lib/db/management";
import { MigrationError } from "../src/lib/db/migrate";
import { PgStartError } from "../src/lib/db/pg-start";

export function parseArguments(
  args: string[],
  allowed: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (
      !key?.startsWith("--") ||
      !allowed.includes(key.slice(2)) ||
      value === undefined ||
      value.startsWith("--") ||
      Object.hasOwn(result, key.slice(2))
    )
      throw new ManagementError("CLI_ARGUMENTS_INVALID");
    result[key.slice(2)] = value;
  }
  if (allowed.some((key) => !Object.hasOwn(result, key)))
    throw new ManagementError("CLI_ARGUMENTS_INVALID");
  return result;
}
export function printSafeError(error: unknown) {
  const code =
    (error instanceof StudioError ||
      error instanceof ManagementError ||
      error instanceof MigrationError ||
      error instanceof PgStartError) &&
    /^[A-Z_]+$/.test(error.code)
      ? error.code
      : "P2A_OPERATION_FAILED";
  process.stderr.write(JSON.stringify({ code }) + "\n");
  process.exitCode = 1;
}
