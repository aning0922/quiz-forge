import { createHash } from "node:crypto";
import type {
  PackIssue,
  QuizPackValidationReport,
  TrustedCompatibilityPolicy,
  ValidationContext,
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
import { inspectImage } from "./media";
import { validateContentReferences } from "./references";
import {
  PackToolError,
  packIssue,
  readBoundedBytes,
  readRestrictedZip,
  throwIfAborted,
  withPackDeadline,
} from "./zip";

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
const UNVERIFIED = [
  "deterministic-scoring-and-witness-reachability",
  "resource-license-and-approval-claims",
  "human-content-and-visual-review",
  "runtime-component-rendering",
  "database-import-and-publication",
];
/** Snapshot policies synchronously; then receive, parse and decode under one deadline. */
export async function validateQuizPack(
  source: AsyncIterable<Uint8Array>,
  context: ValidationContext,
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
    await withPackDeadline(context, async (signal, limits) => {
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
      throwIfAborted(signal);
      const archive = await readBoundedBytes(
        source,
        limits.archiveBytes,
        signal,
      );
      report.archiveSha256 = hashBytes(archive);
      throwIfAborted(signal);
      const zip = await readRestrictedZip(
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
      const manifest = parseQuizPackManifest(
        parsePackJson(manifestBytes, limits.jsonDepth),
      );
      const content = parseQuizPackContent(
        parsePackJson(contentBytes, limits.jsonDepth),
      );
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
      throwIfAborted(signal);
      report.checks.structure = "passed";
      active = "integrity";
      const expected = new Set(["manifest.json"]);
      const integrity: PackIssue[] = [];
      manifest.value.files.forEach((file, i) => {
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
        else if (
          bytes.length !== file.bytes ||
          hashBytes(bytes) !== file.sha256
        )
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
      throwIfAborted(signal);
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
        throwIfAborted(signal);
        const bytes = files.get(resource.path);
        if (!bytes) {
          mediaIssues.push({
            ...packIssue("MEDIA_FILE_MISSING"),
            path: ["resources", i],
          });
          continue;
        }
        const inspected = await inspectImage(bytes, resource, {
          signal,
          limits,
        });
        throwIfAborted(signal);
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
      throwIfAborted(signal);
      report.candidateValid =
        Object.values(report.checks).every((state) => state === "passed") &&
        report.issues.length === 0;
    });
  } catch (error) {
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
