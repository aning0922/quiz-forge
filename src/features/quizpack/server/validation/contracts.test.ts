import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalP1Json } from "../../v1/canonical";
import { P1_UNVERIFIED, sealP1Report } from "./report";
import {
  sealCandidateResultEvidence,
  sealEvidenceEnvelope,
  validationIdentitySchema,
} from "./contracts";
import { EvidenceError } from "./unicode";
import {
  PrivateArchiveCandidate,
  copyCandidateResourceBytes,
} from "./private-candidate";

const hash = "a".repeat(64);
function identity() {
  const payload = {
    schemaVersion: "quizpack-validation-identity.v1" as const,
    validatorVersion: "1.0.0" as const,
    policyId: "quizpack-local-p1.v1" as const,
    validatorBundleSha256: hash,
    compatibilityPolicyHash: hash,
    effectiveLimitsHash: hash,
    persistencePolicyVersion: "quizpack-persistence-policy.v1" as const,
    persistencePolicyHash: hash,
    reportSchemaVersion: "quizpack-validation.v1" as const,
    reportSchemaHash: hash,
    runtime: {
      schema: "quizpack-media-runtime-binding.v1" as const,
      platform: "darwin-arm64" as const,
      componentId: hash,
      deploymentId: hash,
      runtimeBundleHash: hash,
      limitsHash: hash,
    },
  };
  return {
    ...payload,
    identitySha256: createHash("sha256")
      .update(canonicalP1Json(payload))
      .digest("hex"),
  };
}
function accepted() {
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
      identity: { status: "bound" as const, value: identity() },
      report: sealP1Report({
        schemaVersion: "quizpack-validation.v1",
        targetProductId: "synthetic-product",
        validatorVersion: "1.0.0",
        policyId: "quizpack-local-p1.v1",
        archiveSha256: hash,
        manifestSha256: hash,
        contentSha256: hash,
        compatibilityPolicyHash: hash,
        effectiveLimitsHash: hash,
        checks: {
          container: "passed",
          structure: "passed",
          integrity: "passed",
          media: "passed",
          references: "passed",
          compatibility: "passed",
        },
        candidateValid: true,
        importable: false,
        publishable: false,
        issues: [],
        issuesTruncated: false,
        unverified: [...P1_UNVERIFIED],
      }),
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

describe("complete candidate evidence contract", () => {
  it("seals strict accepted evidence without candidate serialization", () => {
    const sealed = sealCandidateResultEvidence(accepted());
    expect(sealed.outcome).toBe("accepted");
    expect(Object.isFrozen(sealed.evidence)).toBe(true);
    expect(sealed).not.toHaveProperty("candidate");
    expect(() =>
      sealCandidateResultEvidence({ ...accepted(), candidate: {} }),
    ).toThrow(EvidenceError);
  });
  it("rejects changed identity hash/runtime bundle and mismatched report bindings", () => {
    const value = identity();
    expect(
      validationIdentitySchema.safeParse({
        ...value,
        identitySha256: "b".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      validationIdentitySchema.safeParse({
        ...value,
        validatorBundleSha256: "b".repeat(64),
      }).success,
    ).toBe(false);
    const original = accepted();
    const evidence = {
      ...original.evidence,
      input: { ...original.evidence.input, archiveSha256: "b".repeat(64) },
    };
    expect(() =>
      sealCandidateResultEvidence({ ...original, evidence }),
    ).toThrow(EvidenceError);
  });
  it("accurately represents authored precheck rejection without fake P1 report", () => {
    const result = accepted();
    const rejected = {
      outcome: "rejected",
      code: "AUTHORED_NOT_SUPPORTED",
      evidence: {
        ...result.evidence,
        report: { status: "not-run", reason: "BACKEND_POLICY_REJECTED" },
        policy: { status: "rejected", code: "AUTHORED_NOT_SUPPORTED" },
      },
    };
    expect(sealCandidateResultEvidence(rejected).outcome).toBe("rejected");
    expect(() =>
      sealCandidateResultEvidence({ ...rejected, code: "P1_REJECTED" }),
    ).toThrow(EvidenceError);
  });
  it("retains unobserved launcher stop uncertainty and forbids rejection/acceptance", () => {
    const result = accepted();
    const interrupted = {
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      evidence: {
        ...result.evidence,
        runtimeFailure: "STOP_UNCONFIRMED",
        completion: {
          mediaStopped: "unknown",
          relatedIo: "settled",
          maintenanceRequired: true,
        },
      },
    };
    expect(sealCandidateResultEvidence(interrupted).outcome).toBe(
      "interrupted",
    );
    expect(() =>
      sealCandidateResultEvidence({ ...interrupted, outcome: "accepted" }),
    ).toThrow(EvidenceError);
    expect(() =>
      sealCandidateResultEvidence({
        ...interrupted,
        outcome: "rejected",
        code: "P1_REJECTED",
      }),
    ).toThrow(EvidenceError);
  });
  it("keeps reports once and enforces attempt sequence/same-byte identities", () => {
    const result = accepted();
    const envelope = {
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [1, 2, 3].map((attempt) => ({ attempt, result })),
    };
    expect(sealEvidenceEnvelope(envelope).attempts).toHaveLength(3);
    expect(JSON.stringify(sealEvidenceEnvelope(envelope))).not.toContain(
      "canonicalText",
    );
    expect(() =>
      sealEvidenceEnvelope({
        ...envelope,
        attempts: [...envelope.attempts, envelope.attempts[0]],
      }),
    ).toThrow(EvidenceError);
    expect(() =>
      sealEvidenceEnvelope({
        ...envelope,
        attempts: [envelope.attempts[1], envelope.attempts[0]],
      }),
    ).toThrow(EvidenceError);
  });
  it("requires all unknown related IO to request maintenance", () => {
    const result = accepted();
    expect(() =>
      sealCandidateResultEvidence({
        ...result,
        evidence: {
          ...result.evidence,
          completion: {
            mediaStopped: "not-started",
            relatedIo: "unconfirmed",
            maintenanceRequired: false,
          },
        },
      }),
    ).toThrow(EvidenceError);
  });
  it.each(["MEDIA_STOP_UNCONFIRMED", "RELATED_IO_UNCONFIRMED"])(
    "rejects %s with falsely completed evidence",
    (code) => {
      const value = accepted();
      expect(() =>
        sealCandidateResultEvidence({
          outcome: "interrupted",
          code,
          evidence: value.evidence,
        }),
      ).toThrow(EvidenceError);
    },
  );
  it.each(["decoded", "failed"] as const)(
    "bounds three attempts of 64 maximum %s media facts",
    (outcome) => {
      const envelope = {
        schemaVersion: "quizpack-evidence-envelope.v1",
        attempts: [1, 2, 3].map((attempt) => {
          const result = accepted();
          const media = Array.from({ length: 64 }, (_, resourceIndex) => ({
            resourceIndex,
            result:
              outcome === "decoded"
                ? {
                    outcome: "decoded",
                    runId: `00000000-0000-4000-8000-${(attempt * 64 + resourceIndex).toString(16).padStart(12, "0")}`,
                    profileId: hash,
                    facts: {
                      mediaType: "image/jpeg",
                      width: 8192,
                      height: 1953,
                      frames: 1,
                      mediaDecoded: true,
                    },
                    stopped: "confirmed",
                  }
                : {
                    outcome: "failed",
                    runId: `00000000-0000-4000-8000-${(attempt * 64 + resourceIndex).toString(16).padStart(12, "0")}`,
                    profileId: hash,
                    code: "STOP_UNCONFIRMED",
                    stopped: "unknown",
                  },
          }));
          return {
            attempt,
            result:
              outcome === "decoded"
                ? {
                    ...result,
                    evidence: {
                      ...result.evidence,
                      media,
                      completion: {
                        mediaStopped: "confirmed",
                        relatedIo: "settled",
                        maintenanceRequired: false,
                      },
                    },
                  }
                : {
                    outcome: "interrupted",
                    code: "MEDIA_STOP_UNCONFIRMED",
                    evidence: {
                      ...result.evidence,
                      media,
                      runtimeFailure: "STOP_UNCONFIRMED",
                      completion: {
                        mediaStopped: "unknown",
                        relatedIo: "settled",
                        maintenanceRequired: true,
                      },
                    },
                  },
          };
        }),
      };
      const sealed = sealEvidenceEnvelope(envelope);
      const metadata = {
        ...sealed,
        attempts: sealed.attempts.map(({ attempt, result }) => ({
          attempt,
          result: {
            ...result,
            evidence: {
              ...result.evidence,
              report:
                result.evidence.report.status === "sealed"
                  ? { ...result.evidence.report, value: null }
                  : result.evidence.report,
            },
          },
        })),
      };
      const metadataBytes = Buffer.byteLength(
        canonicalP1Json(metadata),
        "utf8",
      );
      const envelopeBytes = Buffer.byteLength(canonicalP1Json(sealed), "utf8");
      expect(metadataBytes).toBeLessThanOrEqual(64 * 1024);
      expect(envelopeBytes).toBeLessThanOrEqual(1024 * 1024);
      expect({ outcome, metadataBytes, envelopeBytes }).toMatchSnapshot();
    },
  );
});

describe("private candidate authority", () => {
  it("rejects direct construction and forged prototype getters/resource reads", () => {
    expect(() => new PrivateArchiveCandidate({})).toThrow(EvidenceError);
    const forged = Object.create(
      PrivateArchiveCandidate.prototype,
    ) as PrivateArchiveCandidate;
    expect(() => forged.facts).toThrow(EvidenceError);
    expect(() => JSON.stringify(forged)).toThrow(EvidenceError);
    expect(() => copyCandidateResourceBytes(forged, 0)).toThrow(EvidenceError);
  });
});
