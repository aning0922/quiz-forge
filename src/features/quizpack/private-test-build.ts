import "server-only";
import type { BuildInput } from "./v1/api";
import type { SupportedValidationContext } from "./package/api";
import { runBuild } from "./package/internal-build";
import { snapshotSupportedContext } from "./package/context";
import { parseCurrentContent } from "./content/current";
import {
  hasPrivateTestUse,
  privateTestMarkerMatches,
} from "./content/private-test";
import { collectIssues } from "./package/issues";
import { validateSupportedQuizPackCore } from "./package/validate-core";
import { inspectImage } from "./v1/media";
import {
  readRestrictedZip,
  throwIfAborted,
  withPackDeadline,
  packIssue,
} from "./v1/zip";
import {
  requirePrivateTestCapability,
  type PrivateTestCapability,
} from "./private-test-scope";

/** Local preparation only. The ordinary build/import entry never calls this function. */
export function buildPrivateTestQuizPack(
  input: BuildInput,
  context: SupportedValidationContext,
  capability: PrivateTestCapability,
) {
  const registration = requirePrivateTestCapability(capability);
  return runBuild(input, snapshotSupportedContext(context), {
    snapshot: snapshotSupportedContext,
    parse(value) {
      if (
        !hasPrivateTestUse(value) ||
        !privateTestMarkerMatches(
          (value as { bindings: { privateTestUse: unknown } }).bindings
            .privateTestUse,
          registration,
        )
      )
        return { ok: false, issues: [packIssue("CONTENT_STRUCTURE")] };
      return parseCurrentContent(value);
    },
    collect: collectIssues,
    validate: (source, value) =>
      validateSupportedQuizPackCore(
        source,
        value,
        {
          execute: (work) =>
            withPackDeadline(snapshotSupportedContext(value), work),
          checkpoint: throwIfAborted,
          readZip: readRestrictedZip,
          inspect: inspectImage,
          propagate: () => false,
        },
        {
          kind: "expected-version",
          expectedContentVersion: "quizpack-content.v3",
        },
      ),
  });
}
