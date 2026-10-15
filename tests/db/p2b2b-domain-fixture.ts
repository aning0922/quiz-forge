import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { importsDirectory } from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { createHash, randomUUID } from "node:crypto";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { createSyntheticFixture } from "@/features/quizpack/v1/fixtures/synthetic";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
import {
  P1_UNVERIFIED,
  sealP1Report,
} from "@/features/quizpack/server/validation/report";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import {
  archivePolicySha256,
  ARCHIVE_POLICY_VERSION,
} from "@/features/quizpack/validation/policy";
import {
  validationKey,
  serializeValidationAttempts,
  parseValidationAttempts,
  type ValidationFileStopProof,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import type {
  FrozenCandidate,
  EvidenceProjection,
} from "@/features/quizpack/validation/transactions-contract";
import {
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { acknowledgeValidationFileStop } from "@/features/quizpack/validation/transactions";
export const hash = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
/** Synthetic DB structure only: this does not certify filesystem or service stopping. */
export function syntheticFileStopProof(
  row: ValidationRow,
  mediaStopped: "confirmed" | "not-started",
): ValidationFileStopProof {
  const attempt = parseValidationAttempts(row.attempts_text).find(
    (a) => a.attemptId === row.current_attempt_id,
  )!;
  return {
    schemaVersion: "quizpack-validation-file-stop-proof.v1",
    protocol: "candidate-receipt-db-ack.v1",
    validationId: row.id,
    attemptId: attempt.attemptId,
    fence: attempt.fence,
    ownerPid: attempt.ownerPid,
    ownerNonce: attempt.ownerNonce,
    receiptSha256: hash("Synthetic DB proof; no filesystem authority"),
    scope: "files-and-media",
    mediaStopped,
    relatedIo: "settled",
  };
}
export async function acknowledgeDomainStop(
  db: TestDatabase,
  fixture: Awaited<ReturnType<typeof domainFixture>>,
  row: ValidationRow,
  mediaStopped: "confirmed" | "not-started" = "confirmed",
) {
  return acknowledgeValidationFileStop(
    db.app,
    fixture.auth.credentials,
    fixture.scope,
    {
      authority: {
        validationId: row.id,
        expectedStateRevision: row.state_revision,
        fence: row.fence,
        attemptId: row.current_attempt_id,
      },
      proof: syntheticFileStopProof(row, mediaStopped),
    },
  );
}
export function domainSettledAttempt(row: ValidationRow) {
  const attempt = parseValidationAttempts(row.attempts_text).find(
    (a) => a.attemptId === row.current_attempt_id,
  )!;
  if (!attempt.fileStopProof) throw new Error("TEST_DURABLE_ACK_REQUIRED");
  return {
    attemptId: attempt.attemptId,
    mediaStop: attempt.fileStopProof.mediaStopped,
    fileStopProof: attempt.fileStopProof,
  };
}
/** This fixture supplies synthetic DB evidence only; it never asserts executed P1 or actual archive files. */
export async function domainFixture(db: TestDatabase, prefix = false) {
  const auth = await authenticateTestOperator(db);
  const fixture = await createSyntheticFixture();
  if (prefix) {
    const rename = (text: string) =>
      text.replaceAll("neutral-cover", "a").replaceAll("portrait-1", "a-cover");
    fixture.content = JSON.parse(
      rename(JSON.stringify(fixture.content)),
    ) as typeof fixture.content;
    fixture.contentBytes = Buffer.from(JSON.stringify(fixture.content));
    fixture.manifest = JSON.parse(
      rename(JSON.stringify(fixture.manifest)),
    ) as typeof fixture.manifest;
    fixture.assets = fixture.assets.map((a) => ({
      ...a,
      path: rename(a.path),
    }));
    const contentFile = fixture.manifest.files.find(
      (f) => f.path === "content.json",
    )!;
    contentFile.bytes = fixture.contentBytes.length;
    contentFile.sha256 = hash(fixture.contentBytes);
  }

  const productId = fixture.content.product.productId;
  const importId = randomUUID();
  const archiveSha256 = hash("Synthetic DB archive");
  const archiveBytes = 100;
  const payload = {
    schemaVersion: "quizpack-validation-identity.v1",
    validatorVersion: "1.0.0",
    policyId: "quizpack-local-p1.v1",
    validatorBundleSha256: "a".repeat(64),
    compatibilityPolicyHash: "a".repeat(64),
    effectiveLimitsHash: "a".repeat(64),
    persistencePolicyVersion: "quizpack-persistence-policy.v1",
    persistencePolicyHash: "a".repeat(64),
    reportSchemaVersion: "quizpack-validation.v1",
    reportSchemaHash: "a".repeat(64),
    runtime: {
      schema: "quizpack-media-runtime-binding.v1",
      platform: "darwin-arm64",
      componentId: "a".repeat(64),
      deploymentId: "a".repeat(64),
      runtimeBundleHash: "a".repeat(64),
      limitsHash: "a".repeat(64),
    },
  };
  const identity = {
    ...payload,
    identitySha256: hash(canonicalP1Json(payload)),
  };
  const identityText = canonicalP1Json(identity);
  const manifestText = JSON.stringify(fixture.manifest);
  const manifestSha256 = hash(manifestText);
  const contentSha256 = hash(fixture.contentBytes);
  const result = sealCandidateResultEvidence({
    outcome: "accepted",
    evidence: {
      schemaVersion: "quizpack-candidate-evidence.v1",
      input: {
        status: "snapshotted",
        archiveSha256,
        archiveBytes,
        targetProductId: productId,
      },
      identity: { status: "bound", value: identity },
      report: sealP1Report({
        schemaVersion: "quizpack-validation.v1",
        targetProductId: productId,
        validatorVersion: "1.0.0",
        policyId: "quizpack-local-p1.v1",
        archiveSha256,
        manifestSha256,
        contentSha256,
        compatibilityPolicyHash: "a".repeat(64),
        effectiveLimitsHash: "a".repeat(64),
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
      policy: { status: "passed" },
      media: fixture.content.resources.map((r, resourceIndex) => ({
        resourceIndex,
        result: {
          outcome: "decoded",
          runId: randomUUID(),
          profileId: "a".repeat(64),
          stopped: "confirmed",
          facts: {
            mediaType: r.mediaType,
            width: r.width,
            height: r.height,
            frames: 1,
            mediaDecoded: true,
          },
        },
      })),
      completion: {
        mediaStopped: "confirmed",
        relatedIo: "settled",
        maintenanceRequired: false,
      },
      runtimeFailure: null,
    },
  });
  if (result.outcome !== "accepted") throw new Error("TEST_EVIDENCE_INVALID");
  const files = new Map<string, Uint8Array>([
    ["manifest.json", Buffer.from(manifestText)],
    ["content.json", fixture.contentBytes],
    ...fixture.assets.map((a) => [a.path, a.bytes] as const),
  ]);
  const facts = issuePrivateCandidate(result, files).facts;
  const assetSetText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId,
    resources: facts.resources.map((r) => ({
      resourceId: r.declaration.id,
      resourceVersion: r.declaration.version,
      productId,
      blobSha256: r.blobSha256,
      declarationSha256: r.declarationSha256,
    })),
  });
  const candidate: FrozenCandidate = {
    facts: { ...facts, assetSetText },
    manifestSha256,
    contentSha256,
  };
  const binding = {
    identityText,
    identitySha256: identity.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
    validationKey: validationKey({
      productId,
      importId,
      archiveSha256,
      archiveBytes,
      identitySha256: identity.identitySha256,
      archivePolicyVersion: ARCHIVE_POLICY_VERSION,
      archivePolicySha256,
    }),
  };
  await safe(
    () =>
      db.admin
        .sql`INSERT INTO qf.product(id,slug,title,updated_at) VALUES(${productId},${productId},'Synthetic database product',clock_timestamp())`,
  );
  await safe(
    () =>
      db.admin
        .sql`INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,state_revision,updated_at,storage_condition,fence,attempts,actual_archive_sha256,actual_archive_bytes,archive_storage_key,received_at) VALUES(${importId},${productId},${auth.id},${randomUUID()},${hash("Synthetic request")},${archiveSha256},${archiveBytes},'new-draft',clock_timestamp(),'received',1,clock_timestamp(),'clean',0,'[]',${archiveSha256},${archiveBytes},${`imports/${importId}/archive.quizpack`},clock_timestamp())`,
  );
  const projection = (
    row: ValidationRow,
    resultValue = result,
  ): EvidenceProjection => {
    const result = resultValue;
    const controls = JSON.parse(row.attempts_text) as Parameters<
      typeof serializeValidationAttempts
    >[0];
    const attemptsControlText = serializeValidationAttempts(
      controls.map((a) =>
        a.attemptId === row.current_attempt_id
          ? { ...a, mediaStop: "confirmed" }
          : a,
      ),
    );
    const envelope = {
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [{ attempt: controls.length, result }],
    };
    const evidenceText = canonicalP1Json(envelope);
    const report = result.evidence.report;
    if (report.status !== "sealed") throw new Error("TEST_EVIDENCE_INVALID");
    const metadata = {
      ...envelope,
      attempts: [
        {
          attempt: controls.length,
          result: {
            ...result,
            evidence: {
              ...result.evidence,
              report: { ...report, value: null },
            },
          },
        },
      ],
    };
    return {
      evidenceText,
      evidenceSha256: hash(evidenceText),
      reportTexts: [canonicalP1Json(report.value)],
      metadataText: canonicalP1Json(metadata),
      attemptsControlText,
    };
  };
  return {
    auth,
    scope: { productId, importId },
    binding,
    candidate,
    result,
    files,
    projection,
    owner: { ownerPid: process.pid, ownerNonce: "a".repeat(43) },
    blobs: facts.resources.map((r) => ({
      sha256: r.blobSha256,
      bytes: r.bytes,
      mediaType: r.declaration.mediaType,
      width: r.declaration.width,
      height: r.declaration.height,
      frames: 1 as const,
    })),
  };
}

/** Domain fixtures can discard only their own no-file synthetic attempts, never actual validation IO. */
export async function resetDomainDatabase(db: TestDatabase) {
  if (db.config.purpose !== "test" && db.config.purpose !== "ci")
    throw new Error("P2A_TEST_DATABASE_REQUIRED");
  const lock = await StorageLock.acquire(db.config);
  try {
    const uploads = path.dirname(importsDirectory(db.config));
    const roots = await readdir(uploads, { withFileTypes: true }).catch(
      (e: unknown) => {
        if ((e as { code?: string }).code === "ENOENT") return [];
        throw new Error("TEST_DOMAIN_NO_FILE_INSTANCE_REQUIRED");
      },
    );
    if (
      roots.length > 3 ||
      roots.some(
        (e) =>
          !e.isDirectory() ||
          !["imports", "validation", "blobs"].includes(e.name),
      )
    )
      throw new Error("TEST_DOMAIN_NO_FILE_INSTANCE_REQUIRED");
    for (const entry of roots) {
      const root = path.join(uploads, entry.name);
      const stat = await lstat(root);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("TEST_DOMAIN_NO_FILE_INSTANCE_REQUIRED");
      if ((await readdir(root)).length > 0)
        throw new Error("TEST_DOMAIN_NO_FILE_INSTANCE_REQUIRED");
    }
    const rows = await safe(
      () =>
        db.admin.sql<
          { attempts_text: string }[]
        >`SELECT attempts_text FROM qf.quizpack_validation LIMIT 1025`,
    );
    if (
      rows.length > 1024 ||
      rows.some((r) =>
        (
          JSON.parse(r.attempts_text) as {
            ownerPid: number;
            ownerNonce: string;
          }[]
        ).some((a) => a.ownerNonce !== "a".repeat(43)),
      )
    )
      throw new Error("TEST_DOMAIN_SYNTHETIC_OWNER_REQUIRED");
    await lock.check();
    await safe(
      () =>
        db.admin
          .sql`TRUNCATE qf.draft_application,qf.draft_revision,qf.product_draft,qf.product_asset,qf.asset_blob,qf.quizpack_validation,qf.quizpack_import,qf.product_tag,qf.product,qf.category,qf.tag,qf.operator_session,qf.audit_event,qf.operator`,
    );
  } finally {
    await lock.close();
  }
}
