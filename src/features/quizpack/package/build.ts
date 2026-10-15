import type { BuildSupportedQuizPack } from "./api";
import { runBuild } from "./internal-build";
import { snapshotSupportedContext } from "./context";
import { parseSupportedContent } from "../content/supported";
import { declarationMismatch, isContentSchemaVersion } from "./manifest";
import { collectIssues } from "./issues";
import { validateSupportedQuizPack } from "./validate";
import { PackToolError, packIssue } from "../v1/zip";
export const buildSupportedQuizPack: BuildSupportedQuizPack = async (
  input,
  context,
  expectedContentVersion,
) => {
  try {
    const snapshot = snapshotSupportedContext(context);
    return await runBuild(input, snapshot, {
      snapshot: snapshotSupportedContext,
      parse: (value) => {
        const parsed = parseSupportedContent(value);
        if (!parsed.ok) return parsed;
        return isContentSchemaVersion(expectedContentVersion) &&
          parsed.value.schemaVersion === expectedContentVersion
          ? parsed
          : { ok: false, issues: [declarationMismatch()] };
      },
      collect: collectIssues,
      validate: (source, value) =>
        validateSupportedQuizPack(
          source,
          snapshotSupportedContext(value),
          expectedContentVersion,
        ),
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        packIssue(error instanceof PackToolError ? error.code : "BUILD_FAILED"),
      ],
    };
  }
};
