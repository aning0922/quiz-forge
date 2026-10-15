import type {
  QuizPackValidationReport,
  ValidationContext,
  Result,
  ImageDeclaration,
  ImageFacts,
  ImageInspectionContext,
} from "./api";
import type { QuizPackContent } from "./content";
import type { PackLimits } from "./limits";
import { QUIZPACK_POLICY_ID, QUIZPACK_VALIDATOR_VERSION } from "./limits";
import { checkCompatibility } from "./compatibility";
import { parseQuizPackContent } from "./content";
import { parseQuizPackManifest } from "./manifest";
import { canonicalPackJson } from "./io";
import { validateContentReferences } from "./references";
import { hashBytes, snapshotValidationContext } from "./core-support";
import {
  runValidationCore,
  createValidationReport,
} from "../package/internal-core";
export {
  hashBytes,
  snapshotValidationContext,
  checkArchiveIntegrity,
} from "./core-support";
export interface P1CoreExecution {
  execute: <T>(
    work: (signal: AbortSignal, limits: Readonly<PackLimits>) => Promise<T>,
  ) => Promise<T>;
  checkpoint: (signal: AbortSignal) => void;
  readZip: (
    source: AsyncIterable<Uint8Array>,
    context: ValidationContext,
  ) => Promise<Result<import("./zip").RestrictedZip>>;
  inspect: (
    bytes: Uint8Array,
    declaration: ImageDeclaration,
    context: ImageInspectionContext,
    resourceIndex: number,
  ) => Promise<Result<ImageFacts>>;
  beforeStructure?: (manifest: unknown, content: unknown) => void;
  parsed?: (
    manifest: import("./manifest").QuizPackManifest,
    content: QuizPackContent,
    files: ReadonlyMap<string, Buffer>,
  ) => void;
  propagate: (
    error: unknown,
    report: QuizPackValidationReport,
    active: keyof QuizPackValidationReport["checks"],
  ) => boolean;
}

/** Existing P1 entry keeps its parser, policy, callback timing and issue semantics. */
export async function validateQuizPackCore(
  source: AsyncIterable<Uint8Array>,
  context: ValidationContext,
  execution: P1CoreExecution,
): Promise<QuizPackValidationReport> {
  return runValidationCore<
    ValidationContext,
    {
      manifest: import("./manifest").QuizPackManifest;
      content: QuizPackContent;
    },
    QuizPackValidationReport
  >(
    source,
    context,
    {
      // Resolve each hook on the original object only at its invocation stage.
      execute: (work) => execution.execute(work),
      checkpoint: (signal) => execution.checkpoint(signal),
      readZip: (input, value) => execution.readZip(input, value),
      inspect: (...args) => execution.inspect(...args),
      beforeStructure: (manifest, content) =>
        execution.beforeStructure?.(manifest, content),
      propagate: (error, report, active) =>
        execution.propagate(error, report, active),
      parsed: (pack, files) =>
        execution.parsed?.(pack.manifest, pack.content, files),
    },
    {
      report: createValidationReport(
        context.targetProductId,
        "quizpack-validation.v1",
        QUIZPACK_VALIDATOR_VERSION,
        QUIZPACK_POLICY_ID,
      ),
      snapshot: (value) => {
        const snapshot = snapshotValidationContext(value);
        return {
          context: snapshot,
          compatibilityHash: hashBytes(
            canonicalPackJson(snapshot.compatibilityPolicy),
          ),
        };
      },
      parse: (rawManifest, rawContent) => {
        const manifest = parseQuizPackManifest(rawManifest);
        const content = parseQuizPackContent(rawContent);
        if (!manifest.ok || !content.ok)
          return {
            ok: false,
            issues: [
              ...(!manifest.ok ? manifest.issues : []),
              ...(!content.ok ? content.issues : []),
            ],
          };
        return {
          ok: true,
          value: { manifest: manifest.value, content: content.value },
        };
      },
      references: (pack, target) => ({
        issues: validateContentReferences(pack.manifest, pack.content, target),
        issuesTruncated: false,
      }),
      compatibility: (pack, snapshot) =>
        checkCompatibility(pack.manifest, snapshot.compatibilityPolicy!),
      consumeTruncation: false,
    },
  );
}
