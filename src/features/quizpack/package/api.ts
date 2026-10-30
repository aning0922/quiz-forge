import type { QuizPackContentV2 } from "../content/v2";
import type { QuizPackContentV3 } from "../content/v3";
import type { z } from "zod";
import type { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import type {
  BuildInput,
  PackIssue,
  QuizPackValidationReport,
  Result,
} from "../v1/api";
import type { QuizPackContent } from "../v1/content";
import type { PackLimits } from "../v1/limits";
import type { QuizPackManifest } from "../v1/manifest";
import type { P1CoreExecution } from "../v1/validate-core";

/** Explicit supported entry points. Existing P1 types retain their v1 meaning. */
export type ContentSchemaVersion =
  "quizpack-content.v1" | "quizpack-content.v2" | "quizpack-content.v3";
export type SupportedManifestV2 = Omit<
  QuizPackManifest,
  "contentSchemaVersion"
> & { contentSchemaVersion: "quizpack-content.v2" };
export type SupportedManifestV3 = Omit<
  QuizPackManifest,
  "contentSchemaVersion" | "engine"
> & {
  contentSchemaVersion: "quizpack-content.v3";
  engine: z.infer<typeof engineDeclarationV2Schema>;
};
export type SupportedManifest =
  QuizPackManifest | SupportedManifestV2 | SupportedManifestV3;
export type SupportedParsedPack =
  | {
      contentSchemaVersion: "quizpack-content.v1";
      manifest: QuizPackManifest;
      content: QuizPackContent;
    }
  | {
      contentSchemaVersion: "quizpack-content.v2";
      manifest: SupportedManifestV2;
      content: QuizPackContentV2;
    }
  | {
      contentSchemaVersion: "quizpack-content.v3";
      manifest: SupportedManifestV3;
      content: QuizPackContentV3;
    };
export type IssueBatch = {
  issues: PackIssue[];
  issuesTruncated: boolean;
};
export type SupportedValidationReportV2 = Omit<
  QuizPackValidationReport,
  "schemaVersion" | "validatorVersion" | "policyId"
> & {
  schemaVersion: "quizpack-validation.v2";
  validatorVersion: "2.0.0";
  policyId: "quizpack-local-supported.v1";
};
export type PackageValidationReport =
  | QuizPackValidationReport
  | SupportedValidationReportV2
  | SupportedValidationReportV3;
export type SupportedValidationReportV3 = Omit<
  SupportedValidationReportV2,
  "schemaVersion" | "validatorVersion" | "policyId"
> & {
  schemaVersion: "quizpack-validation.v3";
  validatorVersion: "3.0.0";
  policyId: "quizpack-local-supported.v2";
};
export type SupportedValidationContext = {
  targetProductId: string;
  signal?: AbortSignal;
  /** Only lower fixed production limits; no caller-defined compatibility policy. */
  limits?: Partial<PackLimits>;
};
export type SupportedCoreSelection =
  | {
      kind: "expected-version";
      expectedContentVersion: ContentSchemaVersion;
    }
  | { kind: "backend-matrix" };
/** Trusted composition only; never deserialize an execution or selection from a pack. */
export type SupportedCoreExecution = Omit<
  P1CoreExecution,
  "parsed" | "propagate"
> & {
  parsed?: (
    pack: SupportedParsedPack,
    files: ReadonlyMap<string, Buffer>,
  ) => void;
  propagate: (
    error: unknown,
    report: SupportedValidationReportV2 | SupportedValidationReportV3,
    active: keyof SupportedValidationReportV2["checks"],
  ) => boolean;
};
export type SupportedBuildResult = Result<{
  archive: Uint8Array;
  report: SupportedValidationReportV2 | SupportedValidationReportV3;
}> & { issuesTruncated?: boolean };

/** Callable contracts for implementations delivered by the package workstream. */
export type ValidateSupportedQuizPack = (
  source: AsyncIterable<Uint8Array>,
  context: SupportedValidationContext,
  expectedContentVersion: ContentSchemaVersion,
) => Promise<SupportedValidationReportV2 | SupportedValidationReportV3>;
export type BuildSupportedQuizPack = (
  input: BuildInput,
  context: SupportedValidationContext,
  expectedContentVersion: ContentSchemaVersion,
) => Promise<SupportedBuildResult>;
export type ValidateSupportedQuizPackCore = (
  source: AsyncIterable<Uint8Array>,
  context: SupportedValidationContext,
  execution: SupportedCoreExecution,
  selection: SupportedCoreSelection,
) => Promise<SupportedValidationReportV2 | SupportedValidationReportV3>;
