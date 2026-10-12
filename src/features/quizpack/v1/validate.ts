import type { ValidationContext, QuizPackValidationReport } from "./api";
import { inspectImage } from "./media";
import { readRestrictedZip, throwIfAborted, withPackDeadline } from "./zip";
import { validateQuizPackCore } from "./validate-core";
export { hashBytes, snapshotValidationContext } from "./validate-core";

/** Existing offline API retains its decoder and bounded failure-report semantics. */
export function validateQuizPack(
  source: AsyncIterable<Uint8Array>,
  context: ValidationContext,
): Promise<QuizPackValidationReport> {
  return validateQuizPackCore(source, context, {
    execute: (work) => withPackDeadline(context, work),
    checkpoint: throwIfAborted,
    readZip: readRestrictedZip,
    inspect: inspectImage,
    propagate: () => false,
  });
}
