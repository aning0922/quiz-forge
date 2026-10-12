import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  domainFixture,
  hash,
  resetDomainDatabase,
} from "./p2b2b-domain-fixture";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  sealCandidateResultEvidence,
  type CandidateResultEvidence,
} from "@/features/quizpack/server/validation/contracts";
import {
  claimValidation,
  appendValidationEvidence,
  recoverValidationClaim,
  retryValidationClaim,
} from "@/features/quizpack/validation/transactions";
import {
  parseValidationAttempts,
  serializeValidationAttempts,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import type { EvidenceProjection } from "@/features/quizpack/validation/transactions-contract";
let db: TestDatabase;
let f: Awaited<ReturnType<typeof domainFixture>>;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  f = await domainFixture(db);
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
const authority = (r: ValidationRow) => ({
  validationId: r.id,
  expectedStateRevision: r.state_revision,
  fence: r.fence,
  attemptId: r.current_attempt_id,
});
const claim = () =>
  claimValidation(db.app, f.auth.credentials, f.scope, {
    expectedImportStateRevision: 1,
    expectedValidationKey: f.binding.validationKey,
    binding: f.binding,
    owner: f.owner,
  });
function interrupted(kind: "identity" | "media" | "input") {
  return sealCandidateResultEvidence({
    outcome: "interrupted",
    code:
      kind === "identity"
        ? "RUNTIME_IDENTITY_UNAVAILABLE"
        : kind === "media"
          ? "MEDIA_STOP_UNCONFIRMED"
          : "INVALID_INPUT",
    evidence: {
      ...f.result.evidence,
      input:
        kind === "input"
          ? { status: "unavailable", code: "INVALID_INPUT" }
          : f.result.evidence.input,
      identity: { status: "unavailable", code: "RUNTIME_IDENTITY_UNAVAILABLE" },
      report: {
        status: "not-run",
        reason:
          kind === "input"
            ? "OPERATION_INTERRUPTED_BEFORE_P1"
            : "IDENTITY_UNAVAILABLE",
      },
      policy: { status: "not-run" },
      media: [],
      runtimeFailure: kind === "media" ? "STOP_UNCONFIRMED" : null,
      completion: {
        mediaStopped: kind === "media" ? "unknown" : "not-started",
        relatedIo: kind === "media" ? "unconfirmed" : "settled",
        maintenanceRequired: kind === "media",
      },
    },
  });
}
function projection(
  row: ValidationRow,
  results: readonly CandidateResultEvidence[],
  mediaStop: "not-started" | "confirmed" | "unconfirmed",
): EvidenceProjection {
  const attemptsControlText = serializeValidationAttempts(
    parseValidationAttempts(row.attempts_text).map((a) =>
      a.attemptId === row.current_attempt_id ? { ...a, mediaStop } : a,
    ),
  );
  const envelope = {
    schemaVersion: "quizpack-evidence-envelope.v1",
    attempts: results.map((result, index) => ({ attempt: index + 1, result })),
  };
  const evidenceText = canonicalP1Json(envelope);
  const reports = results.flatMap((r) =>
    r.evidence.report.status === "sealed"
      ? [canonicalP1Json(r.evidence.report.value)]
      : [],
  );
  const metadata = {
    ...envelope,
    attempts: envelope.attempts.map(({ attempt, result }) => ({
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
  return {
    evidenceText,
    evidenceSha256: hash(evidenceText),
    reportTexts: reports,
    metadataText: canonicalP1Json(metadata),
    attemptsControlText,
  };
}
describe("SQL preserves strict unavailable interruption facts without fabricating binding", () => {
  for (const kind of ["identity", "media", "input"] as const)
    it(`stores A strict ${kind} interruption while immutable claim identity remains`, async () => {
      const claimed = (await claim()).row;
      const result = interrupted(kind);
      const mediaStop = kind === "media" ? "unconfirmed" : "not-started";
      const row = await appendValidationEvidence(
        db.app,
        f.auth.credentials,
        f.scope,
        {
          authority: authority(claimed),
          projection: projection(claimed, [result], mediaStop),
          mediaStop,
          candidate: null,
          outcome: "interrupted",
          errorCode:
            kind === "media"
              ? "VALIDATION_RECOVERY_REQUIRED"
              : "MEDIA_UNAVAILABLE",
        },
      );
      expect(row.status).toBe("retryable-failed");
      expect(row.identity_text).toBe(claimed.identity_text);
      expect(Number(row.reserved_bytes)).toBe(134283264);
      expect(parseValidationAttempts(row.attempts_text)[0]!.disposition).toBe(
        "held",
      );
      expect(parseValidationAttempts(row.attempts_text)[0]!.mediaStop).toBe(
        mediaStop,
      );
      expect(
        (
          JSON.parse(row.evidence_text!) as {
            attempts: {
              result: { evidence: { identity: { status: string } } };
            }[];
          }
        ).attempts[0]!.result.evidence.identity.status,
      ).toBe("unavailable");
    });
  it("accepted retry retains preceding unavailable evidence when candidate freezes", async () => {
    const claimed = (await claim()).row;
    const old = interrupted("identity");
    const failed = await appendValidationEvidence(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(claimed),
        projection: projection(claimed, [old], "not-started"),
        mediaStop: "not-started",
        candidate: null,
        outcome: "interrupted",
        errorCode: "MEDIA_UNAVAILABLE",
      },
    );
    const recovered = await recoverValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(failed),
        settledAttempts: [
          { attemptId: failed.current_attempt_id, mediaStop: "not-started" },
        ],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: null,
      },
    );
    const retry = await retryValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      recovered.id,
      {
        expectedStateRevision: recovered.state_revision,
        binding: f.binding,
        owner: f.owner,
      },
    );
    const accepted = await appendValidationEvidence(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(retry),
        projection: projection(retry, [old, f.result], "confirmed"),
        mediaStop: "confirmed",
        candidate: f.candidate,
        outcome: "accepted",
        errorCode: null,
      },
    );
    expect(accepted.status).toBe("validated");
    expect(accepted.validated_at).not.toBe(null);
    expect(accepted.report_texts).toHaveLength(1);
    expect(
      (JSON.parse(accepted.evidence_text!) as { attempts: unknown[] })
        .attempts[0],
    ).toEqual({ attempt: 1, result: old });
  });
});
