import type { BuildInput, BuildOutput, Result, ValidationContext } from "./api";
import { parseQuizPackContent } from "./content";
import { snapshotValidationContext, validateQuizPack } from "./validate";
import { runBuild } from "../package/internal-build";
export { createStoredArchive } from "../package/internal-build";
export type QuizPackBuildResult = Result<BuildOutput> & {
  issuesTruncated?: boolean;
};
/** Caller declarations are never repaired; actual bytes must independently validate. */
export async function buildQuizPack(
  input: BuildInput,
  context: ValidationContext,
): Promise<QuizPackBuildResult> {
  return runBuild(input, context, {
    snapshot: snapshotValidationContext,
    parse: parseQuizPackContent,
    collect: (issues, limit) => ({
      issues: issues.slice(0, limit),
      issuesTruncated: issues.length > limit,
    }),
    validate: validateQuizPack,
  });
}
