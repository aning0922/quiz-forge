import { createHash } from "node:crypto";
import type {
  PackIssue,
  QuizPackValidationReport,
  TrustedCompatibilityPolicy,
  ValidationContext,
  ImageDeclaration,
  ImageFacts,
  ImageInspectionContext,
  Result,
} from "./api";
import {
  checkCompatibility,
  DEFAULT_COMPATIBILITY_POLICY,
} from "./compatibility";
import { parseQuizPackContent, type QuizPackContent } from "./content";
import { canonicalPackJson, parsePackJson } from "./io";
import {
  PACK_LIMITS,
  QUIZPACK_POLICY_ID,
  QUIZPACK_VALIDATOR_VERSION,
  resolvePackLimits,
  type PackLimits,
} from "./limits";
import { packIdSchema, parseQuizPackManifest } from "./manifest";
import { validateContentReferences } from "./references";
import { PackToolError, packIssue, readBoundedBytes } from "./zip";

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

export const hashBytes = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
export function snapshotValidationContext(
  context: ValidationContext,
): ValidationContext & {
  compatibilityPolicy: TrustedCompatibilityPolicy;
  limits: Readonly<PackLimits>;
} {
  if (!packIdSchema.safeParse(context.targetProductId).success)
    throw new PackToolError("INVALID_TARGET_PRODUCT");
  const resolved = resolvePackLimits(context.limits);
  if (!resolved.ok) throw new PackToolError("INVALID_LIMITS");
  const policy = JSON.parse(
    canonicalPackJson(
      context.compatibilityPolicy ?? DEFAULT_COMPATIBILITY_POLICY,
    ),
  ) as TrustedCompatibilityPolicy;
  const strings = (input: unknown) =>
    Array.isArray(input) &&
    input.length <= 128 &&
    input.every((value) => typeof value === "string" && value.length <= 128);
  const declarations = (input: unknown, keys: string[]) =>
    Array.isArray(input) &&
    input.length <= 128 &&
    input.every(
      (value) =>
        value &&
        typeof value === "object" &&
        Object.keys(value).sort().join() === [...keys].sort().join() &&
        Object.values(value).every(
          (field) => typeof field === "string" && field.length <= 128,
        ),
    );
  if (
    !policy ||
    Object.keys(policy).sort().join() !==
      "components,contentSchemaVersions,engines" ||
    !strings(policy.contentSchemaVersions) ||
    !declarations(policy.engines, ["id", "version"]) ||
    !declarations(policy.components, ["id", "version", "propsSchemaVersion"])
  )
    throw new PackToolError("INVALID_COMPATIBILITY_POLICY");
  return {
    targetProductId: context.targetProductId,
    compatibilityPolicy: policy,
    limits: resolved.value,
    ...(context.signal ? { signal: context.signal } : {}),
  };
}
function loweredContentIssues(
  content: QuizPackContent,
  limits: Readonly<PackLimits>,
): PackIssue[] {
  const issues: PackIssue[] = [];
  const test = (actual: number, max: number, path: (string | number)[]) => {
    if (actual > max) issues.push({ ...packIssue("CONTENT_LIMIT"), path });
  };
  test(content.questions.length, limits.questions, ["questions"]);
  test(content.dimensions.length, limits.dimensions, ["dimensions"]);
  test(content.results.length, limits.results, ["results"]);
  test(content.resources.length, limits.resources, ["resources"]);
  content.questions.forEach((question, i) =>
    test(question.options.length, limits.optionsPerQuestion, [
      "questions",
      i,
      "options",
    ]),
  );
  content.resources.forEach((resource, i) => {
    test(resource.bytes, limits.resourceBytes, ["resources", i, "bytes"]);
    test(resource.width, limits.imageDimension, ["resources", i, "width"]);
    test(resource.height, limits.imageDimension, ["resources", i, "height"]);
    test(resource.width * resource.height, limits.imagePixels, [
      "resources",
      i,
    ]);
  });
  return issues;
}
/** Same restricted archive/manifest integrity closure for validation and trusted restoration. */
export function checkArchiveIntegrity(
  manifest: Readonly<{
    files: readonly Readonly<
      import("./manifest").QuizPackManifest["files"][number]
    >[];
  }>,
  files: ReadonlyMap<string, Uint8Array>,
): PackIssue[] {
  const expected = new Set(["manifest.json"]);
  const integrity: PackIssue[] = [];
  manifest.files.forEach((file, i) => {
    if (expected.has(file.path))
      integrity.push({
        ...packIssue("DUPLICATE_MANIFEST_PATH"),
        path: ["files", i],
      });
    expected.add(file.path);
    const bytes = files.get(file.path);
    if (!bytes)
      integrity.push({
        ...packIssue("MANIFEST_FILE_MISSING"),
        path: ["files", i],
      });
    else if (bytes.length !== file.bytes || hashBytes(bytes) !== file.sha256)
      integrity.push({
        ...packIssue("FILE_INTEGRITY_MISMATCH"),
        path: ["files", i],
      });
  });
  if ([...files.keys()].some((path) => !expected.has(path)))
    integrity.push({
      ...packIssue("UNDECLARED_ARCHIVE_FILE"),
      path: ["files"],
    });
  return integrity;
}
const UNVERIFIED = [
  "deterministic-scoring-and-witness-reachability",
  "resource-license-and-approval-claims",
  "human-content-and-visual-review",
  "runtime-component-rendering",
  "database-import-and-publication",
];
/** Snapshot policies synchronously; then receive, parse and decode under one deadline. */
export async function validateQuizPackCore(
  source: AsyncIterable<Uint8Array>,
  context: ValidationContext,
  execution: P1CoreExecution,
): Promise<QuizPackValidationReport> {
  const report: QuizPackValidationReport = {
    schemaVersion: "quizpack-validation.v1",
    targetProductId: packIdSchema.safeParse(context.targetProductId).success
      ? context.targetProductId
      : "",
    validatorVersion: QUIZPACK_VALIDATOR_VERSION,
    policyId: QUIZPACK_POLICY_ID,
    compatibilityPolicyHash: hashBytes("null"),
    effectiveLimitsHash: hashBytes("null"),
    checks: {
      container: "not-run",
      structure: "not-run",
      references: "not-run",
      integrity: "not-run",
      media: "not-run",
      compatibility: "not-run",
    },
    candidateValid: false,
    importable: false,
    publishable: false,
    issues: [],
    issuesTruncated: false,
    unverified: [...UNVERIFIED],
  };
  let issueLimit = PACK_LIMITS.issues;
  const add = (issues: PackIssue[]) => {
    for (const issue of issues) {
      if (report.issues.length < issueLimit) report.issues.push(issue);
      else report.issuesTruncated = true;
    }
  };
  let active: keyof typeof report.checks = "container";
  try {
    await execution.execute(async (signal, limits) => {
      const snapshot = snapshotValidationContext({
        ...context,
        signal,
        limits,
      });
      issueLimit = snapshot.limits.issues;
      report.compatibilityPolicyHash = hashBytes(
        canonicalPackJson(snapshot.compatibilityPolicy),
      );
      report.effectiveLimitsHash = hashBytes(
        canonicalPackJson(snapshot.limits),
      );
      execution.checkpoint(signal);
      const archive = await readBoundedBytes(
        source,
        limits.archiveBytes,
        signal,
      );
      report.archiveSha256 = hashBytes(archive);
      execution.checkpoint(signal);
      const zip = await execution.readZip(
        (async function* () {
          yield archive;
        })(),
        { ...snapshot, signal },
      );
      if (!zip.ok) {
        report.checks.container = "failed";
        add(zip.issues);
        return;
      }
      report.checks.container = "passed";
      active = "structure";
      const files = zip.value.files;
      const manifestBytes = files.get("manifest.json");
      const contentBytes = files.get("content.json");
      if (!manifestBytes || !contentBytes)
        throw new PackToolError("MISSING_REQUIRED_JSON");
      report.manifestSha256 = hashBytes(manifestBytes);
      report.contentSha256 = hashBytes(contentBytes);
      const rawManifest = parsePackJson(manifestBytes, limits.jsonDepth);
      const rawContent = parsePackJson(contentBytes, limits.jsonDepth);
      execution.beforeStructure?.(rawManifest, rawContent);
      const manifest = parseQuizPackManifest(rawManifest);
      const content = parseQuizPackContent(rawContent);
      if (!manifest.ok || !content.ok) {
        report.checks.structure = "failed";
        if (!manifest.ok) add(manifest.issues);
        if (!content.ok) add(content.issues);
        return;
      }
      const contentIssues = loweredContentIssues(content.value, limits);
      if (contentIssues.length) {
        report.checks.structure = "failed";
        add(contentIssues);
        return;
      }
      execution.checkpoint(signal);
      report.checks.structure = "passed";
      active = "integrity";
      const integrity = checkArchiveIntegrity(manifest.value, files);
      execution.checkpoint(signal);
      if (integrity.length) {
        report.checks.integrity = "failed";
        add(integrity);
        return;
      }
      report.checks.integrity = "passed";
      active = "media";
      // Confirm three-way closure before passing any declaration to a decoder.
      const referenceIssues = validateContentReferences(
        manifest.value,
        content.value,
        snapshot.targetProductId,
      );
      const mediaIssues: PackIssue[] = [];
      for (const [i, resource] of content.value.resources.entries()) {
        execution.checkpoint(signal);
        const bytes = files.get(resource.path);
        if (!bytes) {
          mediaIssues.push({
            ...packIssue("MEDIA_FILE_MISSING"),
            path: ["resources", i],
          });
          continue;
        }
        const inspected = await execution.inspect(
          bytes,
          resource,
          {
            signal,
            limits,
          },
          i,
        );
        execution.checkpoint(signal);
        if (!inspected.ok)
          mediaIssues.push(
            ...inspected.issues.map((issue) => ({
              ...issue,
              path: ["resources", i, ...issue.path],
            })),
          );
      }
      report.checks.media = mediaIssues.length ? "failed" : "passed";
      add(mediaIssues);
      active = "references";
      report.checks.references = referenceIssues.length ? "failed" : "passed";
      add(referenceIssues);
      active = "compatibility";
      const compatibility = checkCompatibility(
        manifest.value,
        snapshot.compatibilityPolicy,
      );
      report.checks.compatibility = compatibility.length ? "failed" : "passed";
      add(compatibility);
      execution.checkpoint(signal);
      execution.parsed?.(manifest.value, content.value, files);
      report.candidateValid =
        Object.values(report.checks).every((state) => state === "passed") &&
        report.issues.length === 0;
    });
  } catch (error) {
    if (execution.propagate(error, report, active)) throw error;
    report.checks[active] = "failed";
    report.candidateValid = false;
    add([
      packIssue(
        error instanceof PackToolError ? error.code : "VALIDATION_FAILED",
      ),
    ]);
  }
  return report;
}
