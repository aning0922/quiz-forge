import { PackToolError, packIssue } from "../src/features/quizpack/v1/zip";
import { ArchiveOutputError } from "../src/features/quizpack/v1/io";
import { packIdSchema } from "../src/features/quizpack/v1/manifest";
export function productArgument(value: string | undefined): string {
  if (!value || !packIdSchema.safeParse(value).success)
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  return value;
}
/** Only an explicit complete suffix opts into the supported package entry point. */
export function contentVersionArgument(
  args: readonly string[],
):
  | import("../src/features/quizpack/package/api").ContentSchemaVersion
  | undefined {
  if (args.length === 0) return undefined;
  if (
    args.length !== 2 ||
    args[0] !== "--content-version" ||
    !["v1", "v2", "v3"].includes(args[1]!)
  )
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  return args[1] === "v1"
    ? "quizpack-content.v1"
    : args[1] === "v2"
      ? "quizpack-content.v2"
      : "quizpack-content.v3";
}
export function outputJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
export function failCli(error: unknown): void {
  outputJson({
    ok: false,
    committed: false,
    candidateValid: false,
    importable: false,
    publishable: false,
    issuesTruncated: false,
    issues: [
      packIssue(
        error instanceof PackToolError ? error.code : "CLI_OPERATION_FAILED",
      ),
      ...(error instanceof ArchiveOutputError ? error.warnings : []),
    ],
  });
  process.exitCode = 1;
}
