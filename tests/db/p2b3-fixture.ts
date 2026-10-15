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
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import type { FrozenCandidate } from "@/features/quizpack/validation/transactions-contract";
import { safeTestOperation as safe, type TestDatabase } from "./p2a-fixture";
import {
  acknowledgeValidationFileStop,
  claimValidation,
  appendValidationEvidence,
  beginArchiving,
  completeValidation,
} from "@/features/quizpack/validation/transactions";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { productIdSchema } from "@/features/product/workspace/contracts";
import {
  quizPackContentSchema,
  type QuizPackContent,
} from "@/features/quizpack/v1/content";
import { validateContentReferences } from "@/features/quizpack/v1/references";
import { quizPackManifestSchema } from "@/features/quizpack/v1/manifest";
import { freezeJson } from "@/features/quizpack/server/validation/report";
import { computeCandidateSha256 } from "@/features/quizpack/server/validation/candidate-hash";
import { serializeEvidenceSqlProjection } from "@/features/quizpack/server/validation/sql-projection";
import { syntheticFileStopProof } from "./p2b2b-domain-fixture";

const hash = (text: string | Uint8Array) =>
  createHash("sha256").update(text).digest("hex");
export type P2b3SourceOptions = {
  engine?: "dimensions" | "archetype";
  largeContent?: boolean;
  transformContent?: (content: QuizPackContent) => void;
};
/** SQL-only synthetic snapshot. It never certifies decoder, archive IO or commercial approval.
 * Large/transformed snapshots model existing persisted data, not issuance of >1MiB P1 input.
 */
export async function prepareP2b3Source(
  productIdInput: string,
  options: P2b3SourceOptions = {},
) {
  const productId = productIdSchema.parse(productIdInput);
  const fixture = await createSyntheticFixture(options.engine);
  const previousProductId = fixture.content.product.productId;
  fixture.content = quizPackContentSchema.parse(
    JSON.parse(
      JSON.stringify(fixture.content).replaceAll(
        JSON.stringify(previousProductId),
        JSON.stringify(productId),
      ),
    ),
  );
  fixture.contentBytes = Buffer.from(
    canonicalP1Json(fixture.content, "content"),
  );
  fixture.manifest = quizPackManifestSchema.parse({
    ...fixture.manifest,
    productId,
    packId: productId,
    files: fixture.manifest.files.map((f) =>
      f.path === "content.json"
        ? {
            ...f,
            bytes: fixture.contentBytes.length,
            sha256: hash(fixture.contentBytes),
          }
        : f,
    ),
  });
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
  let result = sealCandidateResultEvidence({
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
  let facts = issuePrivateCandidate(result, files).facts;
  if (options.largeContent || options.transformContent) {
    const content = structuredClone(fixture.content);
    if (options.largeContent) {
      const text = String.fromCharCode(92, 34).repeat(1500);
      for (const template of content.reportTemplates)
        template.baseline = {
          title: text,
          summary: text,
          strengths: Array(8).fill(text),
          tensions: Array(8).fill(text),
          reflection: text,
          disclaimer: text,
        };
      const baseQuestion = content.questions[0]!;
      for (let i = 0; i < 30; i++) {
        const question = {
          ...structuredClone(baseQuestion),
          id: `large-question-${i}`,
          prompt: text,
          options: baseQuestion.options.map((o, j) => ({
            ...structuredClone(o),
            id: `large-option-${i}-${j}`,
            label: text,
            contributions: o.contributions.map((c) => ({ ...c, value: 0 })),
          })),
        };
        content.questions.push(question);
        for (const result of content.results)
          result.witness.answers.push({
            questionRef: {
              id: question.id,
              productId,
              version: question.version,
            },
            optionRef: {
              id: question.options[0]!.id,
              productId,
              version: question.version,
            },
          });
      }
    }
    options.transformContent?.(content);
    const parsed = quizPackContentSchema.parse(content);
    if (
      canonicalP1Json(parsed.resources) !==
      canonicalP1Json(fixture.content.resources)
    )
      throw new Error("P2B3_SYNTHETIC_RESOURCE_TRANSFORM_FORBIDDEN");
    const canonicalContentText = canonicalP1Json(parsed, "content");
    const canonicalContentSha256 = hash(canonicalContentText);
    const manifest = quizPackManifestSchema.parse({
      ...fixture.manifest,
      files: fixture.manifest.files.map((f) =>
        f.path === "content.json"
          ? {
              ...f,
              bytes: Buffer.byteLength(canonicalContentText),
              sha256: canonicalContentSha256,
            }
          : f,
      ),
    });
    const issues = validateContentReferences(manifest, parsed, productId);
    // Only the historical SQL snapshot's raw-content byte budget is outside current issuance.
    if (
      issues.some((i) => i.code !== "CONTENT_FILE_DECLARATION") ||
      (Buffer.byteLength(canonicalContentText) <= 1048576 && issues.length)
    )
      throw new Error("P2B3_SYNTHETIC_CONTENT_INVALID");
    const canonicalManifestText = canonicalP1Json(manifest, "manifest");
    const canonicalManifestSha256 = hash(canonicalManifestText);
    if (result.evidence.report.status !== "sealed")
      throw new Error("P2B3_SYNTHETIC_REPORT_REQUIRED");
    result = sealCandidateResultEvidence({
      ...result,
      evidence: {
        ...result.evidence,
        report: sealP1Report({
          ...result.evidence.report.value,
          manifestSha256: canonicalManifestSha256,
          contentSha256: canonicalContentSha256,
        }),
      },
    });
    facts = freezeJson({
      ...facts,
      content: parsed,
      manifest,
      canonicalContentText,
      canonicalContentSha256,
      canonicalManifestText,
      canonicalManifestSha256,
      candidateSha256: computeCandidateSha256({
        archiveSha256,
        canonicalManifestSha256,
        canonicalContentSha256,
        assetSetSha256: facts.assetSetSha256,
        identitySha256: identity.identitySha256,
      }),
    });
  }
  const candidate: FrozenCandidate = {
    facts,
    manifestSha256:
      options.largeContent || options.transformContent
        ? facts.canonicalManifestSha256
        : manifestSha256,
    contentSha256:
      options.largeContent || options.transformContent
        ? facts.canonicalContentSha256
        : contentSha256,
  };
  return freezeJson({
    productId,
    archiveSha256,
    archiveBytes,
    identityText,
    identitySha256: identity.identitySha256,
    candidate,
    result,
    owner: { ownerPid: process.pid, ownerNonce: "a".repeat(43) },
    blobs: facts.resources.map((r) => ({
      sha256: r.blobSha256,
      bytes: r.bytes,
      mediaType: r.declaration.mediaType,
      width: r.declaration.width,
      height: r.declaration.height,
      frames: 1 as const,
    })),
  });
}

export type PreparedP2b3Source = Awaited<ReturnType<typeof prepareP2b3Source>>;
const authority = (r: ValidationRow) => ({
  validationId: r.id,
  expectedStateRevision: r.state_revision,
  fence: r.fence,
  attemptId: r.current_attempt_id,
});
/** Actual PG transitions, synthetic no-file facts. Reuse prepared for a same-Product alias. */
export async function seedReadyP2b3Source(
  db: TestDatabase,
  auth: { id: string; credentials: StudioWriteCredentials },
  prepared: PreparedP2b3Source,
  options: { createProduct?: boolean } = {},
) {
  if (db.config.purpose !== "test" && db.config.purpose !== "ci")
    throw new Error("P2B3_TEST_DATABASE_REQUIRED");
  const { productId, archiveSha256, archiveBytes } = prepared;
  const importId = randomUUID();
  const scope = { productId, importId };
  const binding = {
    identityText: prepared.identityText,
    identitySha256: prepared.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
    validationKey: validationKey({
      productId,
      importId,
      archiveSha256,
      archiveBytes,
      identitySha256: prepared.identitySha256,
      archivePolicyVersion: ARCHIVE_POLICY_VERSION,
      archivePolicySha256,
    }),
  };
  if (options.createProduct !== false)
    await safe(
      () => db.admin.sql`
    INSERT INTO qf.product(id,slug,title,updated_at)
    VALUES(${productId},${productId},'B3 synthetic SQL product',clock_timestamp())`,
    );
  await safe(
    () => db.admin.sql`
    INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,
      expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,state_revision,
      updated_at,storage_condition,fence,attempts,actual_archive_sha256,actual_archive_bytes,
      archive_storage_key,received_at)
    VALUES(${importId},${productId},${auth.id},${randomUUID()},${hash("B3 synthetic request")},
      ${archiveSha256},${archiveBytes},'new-draft',clock_timestamp(),'received',1,
      clock_timestamp(),'clean',0,'[]',${archiveSha256},${archiveBytes},
      ${`imports/${importId}/archive.quizpack`},clock_timestamp())`,
  );
  let row = (
    await safe(() =>
      claimValidation(db.app, auth.credentials, scope, {
        expectedImportStateRevision: 1,
        expectedValidationKey: binding.validationKey,
        binding,
        owner: prepared.owner,
      }),
    )
  ).row;
  const attempts = parseValidationAttempts(row.attempts_text);
  const projection = serializeEvidenceSqlProjection(
    {
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [{ attempt: attempts.length, result: prepared.result }],
    },
    serializeValidationAttempts(
      attempts.map((a) =>
        a.attemptId === row.current_attempt_id
          ? { ...a, mediaStop: "confirmed" as const }
          : a,
      ),
    ),
  );
  if (!projection.ok) throw new Error("P2B3_SYNTHETIC_EVIDENCE_INVALID");
  row = await safe(() =>
    appendValidationEvidence(db.app, auth.credentials, scope, {
      authority: authority(row),
      projection: projection.value,
      mediaStop: "confirmed",
      candidate: prepared.candidate,
      outcome: "accepted",
      errorCode: null,
    }),
  );
  row = await safe(() =>
    beginArchiving(db.app, auth.credentials, scope, authority(row)),
  );
  row = await safe(() =>
    acknowledgeValidationFileStop(db.app, auth.credentials, scope, {
      authority: authority(row),
      proof: syntheticFileStopProof(row, "confirmed"),
    }),
  );
  row = await safe(() =>
    completeValidation(db.app, auth.credentials, scope, {
      authority: authority(row),
      blobs: prepared.blobs,
      accountedBytes: 0,
    }),
  );
  if (row.status !== "ready")
    throw new Error("P2B3_SYNTHETIC_SOURCE_NOT_READY");
  return {
    scope: { productId, sourceImportId: importId, sourceValidationId: row.id },
    binding,
    row,
    input: {
      idempotencyKey: randomUUID(),
      expectedValidationStateRevision: row.state_revision,
      expectedCandidateSha256: prepared.candidate.facts.candidateSha256,
      target: { kind: "new-draft" as const },
    },
  };
}
