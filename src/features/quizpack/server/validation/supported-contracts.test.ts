import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalP1Json } from "../../v1/canonical";
import {
  candidateResultEvidenceSchema,
  validationIdentitySchema,
  legacyValidationIdentitySchema,
  sealCandidateResultEvidence,
} from "./contracts";
import { runtimeIdentity, supportedRuntimeIdentity } from "./identity";
import {
  P1_UNVERIFIED,
  REPORT_SCHEMA_HASH,
  SUPPORTED_REPORT_SCHEMA_HASH,
  sealP1Report,
  sealSupportedReport,
  serializeSealedReport,
  strictP1ReportSchema,
  strictSupportedReportSchema,
} from "./report";

import {
  matchesSupportedArchiveIdentity,
  supportedArchivePolicySha256,
  SUPPORTED_ARCHIVE_POLICY_VERSION,
} from "../../validation/policy";

const hash = "a".repeat(64);
const binding = {
  schema: "quizpack-media-runtime-binding.v1" as const,
  platform: "darwin-arm64" as const,
  componentId: hash,
  deploymentId: hash,
  runtimeBundleHash: hash,
  limitsHash: hash,
};
function report(supported = true) {
  const id = supported
    ? supportedRuntimeIdentity(binding)
    : runtimeIdentity(binding);
  return {
    schemaVersion: id.reportSchemaVersion,
    validatorVersion: id.validatorVersion,
    policyId: id.policyId,
    targetProductId: "synthetic-product",
    archiveSha256: hash,
    manifestSha256: hash,
    contentSha256: hash,
    compatibilityPolicyHash: id.compatibilityPolicyHash,
    effectiveLimitsHash: id.effectiveLimitsHash,
    checks: {
      container: "passed",
      structure: "passed",
      references: "passed",
      integrity: "passed",
      media: "passed",
      compatibility: "passed",
    },
    candidateValid: true,
    importable: false,
    publishable: false,
    issues: [],
    issuesTruncated: false,
    unverified: [...P1_UNVERIFIED],
  };
}
function accepted(supported = true) {
  return {
    outcome: "accepted" as const,
    evidence: {
      schemaVersion: "quizpack-candidate-evidence.v1" as const,
      input: {
        status: "snapshotted" as const,
        archiveSha256: hash,
        archiveBytes: 100,
        targetProductId: "synthetic-product",
      },
      identity: {
        status: "bound" as const,
        value: supported
          ? supportedRuntimeIdentity(binding)
          : runtimeIdentity(binding),
      },
      report: supported
        ? sealSupportedReport(report())
        : sealP1Report(report(false)),
      policy: { status: "passed" as const },
      media: [],
      completion: {
        mediaStopped: "not-started" as const,
        relatedIo: "settled" as const,
        maintenanceRequired: false,
      },
      runtimeFailure: null,
    },
  };
}
function rehash<T extends { identitySha256: string }>(input: T): T {
  const { identitySha256: _, ...payload } = input;
  void _;
  return {
    ...payload,
    identitySha256: createHash("sha256")
      .update(canonicalP1Json(payload))
      .digest("hex"),
  } as T;
}
const presentationIssue = {
  code: "PRESENTATION_REFERENCE_MISMATCH",
  path: ["visualPresentation", "coverSceneRef"],
  message: "Content must use the exact declared presentation reference graph.",
};

describe("supported report and identity evidence", () => {
  it("preserves the original report Schema hash and strict v1 API", () => {
    expect(REPORT_SCHEMA_HASH).toBe(
      "7a81463d5a8a54d4fa10802d467b74542fd1a074ddef624e134263247751ce2a",
    );
    expect(SUPPORTED_REPORT_SCHEMA_HASH).not.toBe(REPORT_SCHEMA_HASH);
    expect(strictP1ReportSchema.safeParse(report(false)).success).toBe(true);
    expect(() => sealP1Report(report())).toThrow();
    expect(() => sealSupportedReport(report(false))).toThrow();
    expect(
      legacyValidationIdentitySchema.safeParse(
        supportedRuntimeIdentity(binding),
      ).success,
    ).toBe(false);
  });
  it.each([false, true])(
    "seals, copies and serializes a complete supported=%s tuple",
    (supported) => {
      const raw = accepted(supported),
        sealed = sealCandidateResultEvidence(raw);
      raw.evidence.input.targetProductId = "other-product";
      expect(sealed.evidence.input.status).toBe("snapshotted");
      if (
        sealed.evidence.input.status !== "snapshotted" ||
        sealed.evidence.report.status !== "sealed"
      )
        throw Error("fixture");
      expect(sealed.evidence.input.targetProductId).toBe("synthetic-product");
      expect(Object.isFrozen(sealed.evidence.report.value)).toBe(true);
      expect(
        JSON.parse(serializeSealedReport(sealed.evidence.report)).schemaVersion,
      ).toBe(supported ? "quizpack-validation.v2" : "quizpack-validation.v1");
    },
  );
  it("retains an upstream truncation with fewer than 100 actual issues only in v2", () => {
    const partial = {
      ...report(),
      candidateValid: false,
      checks: { ...report().checks, references: "failed" },
      issues: Array.from({ length: 31 }, () => presentationIssue),
      issuesTruncated: true,
    };
    expect(sealSupportedReport(partial).value.issuesTruncated).toBe(true);
    const old = {
      ...report(false),
      candidateValid: false,
      issues: [
        {
          code: "CONTENT_STRUCTURE",
          path: [],
          message: "Value does not satisfy the quizpack-content.v1 contract.",
        },
      ],
      issuesTruncated: true,
    };
    expect(
      strictP1ReportSchema.safeParse({ ...old, issuesTruncated: false })
        .success,
    ).toBe(true);
    expect(strictP1ReportSchema.safeParse(old).success).toBe(false);
    expect(() =>
      sealSupportedReport({ ...partial, candidateValid: true }),
    ).toThrow();
  });
  it("rejects a truncation marker or arbitrary code/message as a business issue", () => {
    for (const issue of [
      {
        code: "ISSUES_TRUNCATED",
        path: [],
        message: "Additional content issues were omitted.",
      },
      { ...presentationIssue, code: "CALLER_INVENTED" },
      { ...presentationIssue, message: "caller-controlled content" },
    ])
      expect(
        strictSupportedReportSchema.safeParse({
          ...report(),
          candidateValid: false,
          issues: [issue],
        }).success,
      ).toBe(false);
  });
  it.each([false, true])(
    "rejects mixed identity/report versions from supported=%s",
    (supported) => {
      const mixed = accepted(supported);
      mixed.evidence.report = accepted(!supported).evidence.report;
      expect(candidateResultEvidenceSchema.safeParse(mixed).success).toBe(
        false,
      );
    },
  );
  it("binds the report Schema hash rather than accepting a freshly self-hashed false claim", () => {
    const old = accepted(false);
    old.evidence.identity.value = rehash({
      ...old.evidence.identity.value,
      reportSchemaHash: hash,
    });
    expect(candidateResultEvidenceSchema.safeParse(old).success).toBe(false);
    const current = supportedRuntimeIdentity(binding);
    for (const change of [
      { reportSchemaHash: hash },
      { compatibilityPolicyHash: hash },
      { effectiveLimitsHash: hash },
      { persistencePolicyHash: hash },
    ])
      expect(
        validationIdentitySchema.safeParse(rehash({ ...current, ...change }))
          .success,
      ).toBe(false);
  });
  it("rejects archive v3 paired with legacy identity or the wrong exact policy hash", () => {
    expect(
      matchesSupportedArchiveIdentity(
        SUPPORTED_ARCHIVE_POLICY_VERSION,
        supportedArchivePolicySha256,
        supportedRuntimeIdentity(binding),
      ),
    ).toBe(true);
    expect(
      matchesSupportedArchiveIdentity(
        SUPPORTED_ARCHIVE_POLICY_VERSION,
        supportedArchivePolicySha256,
        runtimeIdentity(binding),
      ),
    ).toBe(false);
    expect(
      matchesSupportedArchiveIdentity(
        "quizpack-private-archive.v2",
        supportedArchivePolicySha256,
        supportedRuntimeIdentity(binding),
      ),
    ).toBe(false);
    expect(
      matchesSupportedArchiveIdentity(
        SUPPORTED_ARCHIVE_POLICY_VERSION,
        hash,
        supportedRuntimeIdentity(binding),
      ),
    ).toBe(false);
  });
  it("rejects unknown fields and altered sealed bytes", () => {
    expect(
      strictSupportedReportSchema.safeParse({ ...report(), approved: true })
        .success,
    ).toBe(false);
    const sealed = sealSupportedReport(report());
    expect(() => serializeSealedReport({ ...sealed, sha256: hash })).toThrow();
    expect(() =>
      serializeSealedReport({
        ...sealed,
        canonicalBytes: sealed.canonicalBytes + 1,
      }),
    ).toThrow();
  });
});
