import type { PackIssue, ValidationContext } from "../v1/api";
import {
  readContentMetadata,
  loweredCurrentContentIssues,
  type CurrentContent,
} from "../content/current";
import type {
  SupportedManifest,
  PackageValidationReport,
  IssueBatch,
} from "./api";
import type { P1CoreExecution } from "../v1/validate-core";
import { hashBytes, checkArchiveIntegrity } from "../v1/core-support";
import { PACK_LIMITS, type PackLimits } from "../v1/limits";
import { packIdSchema } from "../v1/manifest";
import { canonicalPackJson, parsePackJson } from "../v1/io";
import { PackToolError, packIssue, readBoundedBytes } from "../v1/zip";
type Parsed = { manifest: SupportedManifest; content: CurrentContent };
type Snapshot = ValidationContext & { limits: Readonly<PackLimits> };
type ParsedResult<P> =
  | { ok: true; value: P }
  | ({ ok: false } & Partial<Pick<IssueBatch, "issuesTruncated">> & {
        issues: PackIssue[];
      });
export interface CoreProfile<
  C,
  P extends Parsed,
  R extends PackageValidationReport,
> {
  report: R;
  snapshot(
    context: C & { signal: AbortSignal; limits: Readonly<PackLimits> },
  ): { context: Snapshot; compatibilityHash: string };
  parse(manifest: unknown, content: unknown): ParsedResult<P>;
  references(pack: P, target: string): IssueBatch;
  compatibility(pack: P, context: Snapshot): PackIssue[];
  consumeTruncation: boolean;
}
export type CoreExecution<P, R extends PackageValidationReport> = Omit<
  P1CoreExecution,
  "parsed" | "propagate"
> & {
  parsed?: (pack: P, files: ReadonlyMap<string, Buffer>) => void;
  propagate: (error: unknown, report: R, active: keyof R["checks"]) => boolean;
};
const UNVERIFIED = [
  "deterministic-scoring-and-witness-reachability",
  "resource-license-and-approval-claims",
  "human-content-and-visual-review",
  "runtime-component-rendering",
  "database-import-and-publication",
];

export function createValidationReport<
  S extends PackageValidationReport["schemaVersion"],
  V extends PackageValidationReport["validatorVersion"],
  I extends PackageValidationReport["policyId"],
>(
  targetProductId: string,
  schemaVersion: S,
  validatorVersion: V,
  policyId: I,
): Omit<
  import("../v1/api").QuizPackValidationReport,
  "schemaVersion" | "validatorVersion" | "policyId"
> & { schemaVersion: S; validatorVersion: V; policyId: I } {
  return {
    schemaVersion,
    targetProductId: packIdSchema.safeParse(targetProductId).success
      ? targetProductId
      : "",
    validatorVersion,
    policyId,
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
}
/** Shared execution order; parser and policy are selected only by trusted entry points. */
export async function runValidationCore<
  C extends { targetProductId: string },
  P extends Parsed,
  R extends PackageValidationReport,
>(
  source: AsyncIterable<Uint8Array>,
  context: C,
  execution: CoreExecution<P, R>,
  profile: CoreProfile<C, P, R>,
): Promise<R> {
  const report = profile.report;
  let issueLimit = PACK_LIMITS.issues;
  const add = (issues: PackIssue[], upstreamTruncated = false) => {
    if (profile.consumeTruncation && upstreamTruncated)
      report.issuesTruncated = true;
    for (const issue of issues) {
      if (profile.consumeTruncation && issue.code === "ISSUES_TRUNCATED") {
        report.issuesTruncated = true;
        continue;
      }
      if (report.issues.length < issueLimit) report.issues.push(issue);
      else report.issuesTruncated = true;
    }
  };
  let active: keyof typeof report.checks = "container";
  try {
    await execution.execute(async (signal, limits) => {
      const resolved = profile.snapshot({
        ...context,
        signal,
        limits,
      });
      const snapshot = resolved.context;
      issueLimit = snapshot.limits.issues;
      report.compatibilityPolicyHash = resolved.compatibilityHash;
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
      const parsed = profile.parse(rawManifest, rawContent);
      if (!parsed.ok) {
        report.checks.structure = "failed";
        add(parsed.issues, parsed.issuesTruncated);
        return;
      }
      const pack = parsed.value;
      const contentIssues = loweredCurrentContentIssues(pack.content, limits);
      if (contentIssues.length) {
        report.checks.structure = "failed";
        add(contentIssues);
        return;
      }
      execution.checkpoint(signal);
      report.checks.structure = "passed";
      active = "integrity";
      const integrity = checkArchiveIntegrity(pack.manifest, files);
      execution.checkpoint(signal);
      if (integrity.length) {
        report.checks.integrity = "failed";
        add(integrity);
        return;
      }
      report.checks.integrity = "passed";
      active = "media";
      // Confirm three-way closure before passing any declaration to a decoder.
      const referenceIssues = profile.references(
        pack,
        snapshot.targetProductId,
      );
      const mediaIssues: PackIssue[] = [];
      for (const [i, resource] of readContentMetadata(
        pack.content,
      ).resources.entries()) {
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
      report.checks.references =
        referenceIssues.issues.length || referenceIssues.issuesTruncated
          ? "failed"
          : "passed";
      add(referenceIssues.issues, referenceIssues.issuesTruncated);
      active = "compatibility";
      const compatibility = profile.compatibility(pack, snapshot);
      report.checks.compatibility = compatibility.length ? "failed" : "passed";
      add(compatibility);
      execution.checkpoint(signal);
      execution.parsed?.(pack, files);
      report.candidateValid =
        Object.values(report.checks).every((state) => state === "passed") &&
        report.issues.length === 0 &&
        (!profile.consumeTruncation || !report.issuesTruncated);
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
