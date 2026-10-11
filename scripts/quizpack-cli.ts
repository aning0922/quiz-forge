import { PackToolError, packIssue } from "../src/features/quizpack/v1/zip";
import { packIdSchema } from "../src/features/quizpack/v1/manifest";
export function productArgument(value: string | undefined): string {
  if (!value || !packIdSchema.safeParse(value).success)
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  return value;
}
export function outputJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
export function failCli(error: unknown): void {
  outputJson({
    ok: false,
    candidateValid: false,
    importable: false,
    publishable: false,
    issuesTruncated: false,
    issues: [
      packIssue(
        error instanceof PackToolError ? error.code : "CLI_OPERATION_FAILED",
      ),
    ],
  });
  process.exitCode = 1;
}
