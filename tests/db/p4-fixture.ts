import { randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import { withStudioWrite } from "@/lib/auth/write";
import { authenticateTestOperator, type TestDatabase } from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import { prepareP3eSource } from "./p3e-source-fixture";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import { readReadyDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
} from "@/features/product/internal-versions/contracts";
import {
  insertReview,
  insertVersion,
  versionById,
  versionDetail,
} from "@/features/product/internal-versions/repository";
import { buildInternalSnapshot } from "@/features/product/internal-versions/snapshot";
import { internalPlayFixture } from "@/features/product/internal-play/contracts.test-support";
import {
  internalPlayBindingText,
  internalPlaySnapshotText,
  type InternalPlayDetail,
  type InternalPlaySnapshot,
} from "@/features/product/internal-play/contracts";
import {
  consumerMappingSha256,
  CONSUMER_PROTOCOLS_V1,
} from "@/lib/consumer-contract/v1/identities";
import {
  consumerAnswersText,
  consumerProgressText,
  consumerSaveBindingText,
  type ConsumerSaveBinding,
} from "@/lib/consumer-contract/v1/state";
import {
  issueAccessKeyBindingText,
  voidUnusedAccessKeyBindingText,
} from "@/features/fulfillment/access/contracts";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { importsDirectory } from "@/features/quizpack/import/storage";
import { iso } from "@/features/product/workspace/repository";
import type { DatabaseTime } from "@/lib/auth/internal";
import { parseSupportedContent } from "@/features/quizpack/content/supported";
import {
  prepareContentForScoring,
  scorePreparedContent,
  contentScoreSchema,
} from "@/features/quizpack/content/scoring-adapter";
import { projectContentScoreForDisplay } from "@/features/theme/preview/result-projection";
import {
  consumerCompleteBindingText,
  persistedReportDisplaySha256,
  type PersistedReportDisplay,
} from "@/features/report/persisted/view-contracts";
import { persistedReportSnapshotText } from "@/features/report/persisted/snapshot-contract";

export const p4Hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");
type Row = Record<string, unknown>;
export async function readP4OldGraph(sql: postgres.Sql | postgres.ReservedSql) {
  const names = await sql<
    { name: string }[]
  >`SELECT relname AS name FROM pg_class WHERE relnamespace='qf'::regnamespace AND relkind='r' AND relname NOT IN ('internal_play_version','access_key','consumer_session','consumer_grant','quiz_report','consumer_exchange_budget') ORDER BY relname`;
  const result: Record<string, string[]> = {};
  for (const { name } of names) {
    const rows = await sql.unsafe<{ body: string }[]>(
      `SELECT row_to_json(t)::text AS body FROM qf.${name} t`,
    );
    result[name] = rows.map((x) => x.body).sort();
  }
  return result;
}
/** DB-only synthetic graph. No raw credential/native/physical asset or new renderer availability is asserted. */
export async function p4Fixture(
  db: TestDatabase,
  createPlay = true,
  appendRevision = false,
) {
  if (createPlay && appendRevision) throw Error("P4_TEST_HEAD_SETUP_INVALID");
  await resetDomainDatabase(db);
  const auth = await authenticateTestOperator(db);
  const source = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP3eSource(randomUUID()),
  );
  const initial = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
  const fixed = await withStudioWrite(
    db.app,
    auth.credentials,
    "version:seal-internal",
    async (tx, actor) => {
      const evidence = await readReadyDraftSourceEvidenceReadonly(
        tx,
        source.scope,
        {
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision,
          expectedCandidateSha256: source.input.expectedCandidateSha256,
        },
      );
      const baseline = matchRegisteredBaseline(evidence, db.config.purpose);
      if (!baseline) throw Error("P4_TEST_BASELINE_MISSING");
      const target = {
        draftId: initial.application.draftId,
        revision: 1,
        canonicalContentSha256: evidence.canonicalContentSha256,
        assetSetSha256: evidence.assetSetSha256,
        canonicalManifestSha256: evidence.canonicalManifestSha256,
      };
      const binding = {
        schemaVersion: "quizforge.review-record.v1" as const,
        productId: evidence.productId,
        idempotencyKey: randomUUID(),
        target,
        baseline: baseline.identity,
      };
      const review = await insertReview(
        tx,
        binding,
        {
          schemaVersion: "quizforge.internal-review-facts.v1",
          productId: evidence.productId,
          target,
          baseline: baseline.identity,
          purpose: "internal-test",
          approval: baseline.descriptor.approval,
        },
        evidence,
        actor,
      );
      const seal = {
        schemaVersion: "quizforge.internal-version-seal.v1" as const,
        productId: evidence.productId,
        idempotencyKey: randomUUID(),
        target,
        reviewId: review.id,
        reviewSha256: review.reviewSha256,
        renderer: rendererIdentitySchema.parse(
          implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
        ),
        engine: engineIdentitySchema.parse(
          implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[0]!),
        ),
      };
      const built = buildInternalSnapshot(seal, review, evidence);
      const receipt = await insertVersion(tx, seal, built.snapshot, 1, actor);
      const row = await versionById(tx, evidence.productId, receipt.id);
      if (!row) throw Error("P4_TEST_PARENT_MISSING");
      return { parent: await versionDetail(row), review, evidence };
    },
  );
  const sources = [source];
  if (appendRevision) {
    const next = await seedReadyP2b3Source(
      db,
      auth,
      await prepareP3eSource(randomUUID(), 2),
      { createProduct: false },
    );
    sources.push(next);
    await createProductDraftRevisionService().appendReadyValidation(
      db.app,
      auth.credentials,
      next.scope,
      {
        idempotencyKey: next.input.idempotencyKey,
        expectedValidationStateRevision:
          next.input.expectedValidationStateRevision,
        expectedCandidateSha256: next.input.expectedCandidateSha256,
        target: {
          kind: "append-revision",
          draftId: initial.application.draftId,
          expectedRevision: 1,
          expectedCanonicalContentSha256:
            initial.application.canonicalContentSha256,
          expectedAssetSetSha256: initial.application.assetSetSha256,
        },
      },
    );
  }
  const ownedImports = await db.admin.sql<
    { id: string }[]
  >`SELECT id FROM qf.quizpack_import ORDER BY id`;
  const ownedValidations = await db.admin.sql<
    { id: string }[]
  >`SELECT id FROM qf.quizpack_validation ORDER BY id`;
  if (
    JSON.stringify(ownedImports.map((x) => x.id)) !==
      JSON.stringify(sources.map((x) => x.scope.sourceImportId).sort()) ||
    JSON.stringify(ownedValidations.map((x) => x.id)) !==
      JSON.stringify(sources.map((x) => x.scope.sourceValidationId).sort())
  )
    throw Error("P4_TEST_SOURCE_OWNER_CHANGED");
  const expectedOldGraph = await readP4OldGraph(db.admin.sql);
  const base = await internalPlayFixture();
  const binding = {
    schemaVersion: "quizforge.internal-play-create.v1" as const,
    operationKey: randomUUID(),
    parent: {
      productId: fixed.evidence.productId,
      versionId: fixed.parent.version.id,
      snapshotSha256: fixed.parent.version.snapshotSha256,
    },
    renderer: base.play.snapshot.renderer,
  };
  const snapshot: InternalPlaySnapshot = {
    schemaVersion: "quizforge.internal-play-snapshot.v1",
    purpose: "internal-test",
    publicationApproved: false,
    parent: binding.parent,
    parentSnapshot: fixed.parent.snapshot,
    renderer: binding.renderer,
    mapping: base.play.snapshot.mapping,
    mappingSha256: await consumerMappingSha256(base.play.snapshot.mapping),
    resources: JSON.parse(fixed.evidence.assetSetText),
    protocols: { ...CONSUMER_PROTOCOLS_V1 },
  };
  const playId = randomUUID();
  const b = internalPlayBindingText(binding),
    s = internalPlaySnapshotText(snapshot);
  const expected = new Map<string, Map<string, string>>();
  const tables = [
    "internal_play_version",
    "access_key",
    "consumer_session",
    "consumer_grant",
    "quiz_report",
  ];
  const key = (table: string, row: Row) =>
    table === "consumer_grant" ? `${row.key_id}/${row.slot}` : String(row.id);
  const remember = (table: string, row: Row) => {
    const rows = expected.get(table) ?? new Map();
    const proof = row.__p4_row_text;
    if (typeof proof !== "string") throw Error("P4_TEST_ROW_PROOF_MISSING");
    delete row.__p4_row_text;
    rows.set(key(table, row), proof);
    expected.set(table, rows);
    return row;
  };
  let play: InternalPlayDetail | undefined;
  if (createPlay) {
    const [r] = await db.app.sql<
      Row[]
    >`INSERT INTO qf.internal_play_version(id,product_id,slot,parent_version_id,parent_snapshot_sha256,operation_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,created_by,created_at) VALUES(${playId},${fixed.evidence.productId},1,${fixed.parent.version.id},${fixed.parent.version.snapshotSha256},${binding.operationKey},${b},${p4Hash(b)},${s},${p4Hash(s)},${auth.id},date_trunc('milliseconds',clock_timestamp())) RETURNING *,row_to_json(internal_play_version)::text AS __p4_row_text`;
    if (!r) throw Error("P4_TEST_PLAY_MISSING");
    remember("internal_play_version", r);
    play = {
      snapshot,
      play: {
        schemaVersion: "quizforge.internal-play-receipt.v1",
        id: playId,
        slot: 1,
        binding,
        bindingSha256: p4Hash(b),
        snapshotSha256: p4Hash(s),
        createdBy: auth.id,
        createdAt: iso(r.created_at as DatabaseTime),
        purpose: "internal-test",
        publicationApproved: false,
      },
    };
  }
  const playRef = {
    productId: fixed.evidence.productId,
    playVersionId: playId,
    playSnapshotSha256: p4Hash(s),
  };
  async function issue() {
    const binding = {
      schemaVersion: "quizforge.access-key-issue.v1" as const,
      operationKey: randomUUID(),
      keyId: randomUUID(),
      play: playRef,
      credentialDigest: p4Hash(`synthetic-digest-${randomUUID()}`),
      validForSeconds: 3600,
    };
    const text = issueAccessKeyBindingText(binding);
    const [row] = await db.app.sql<
      Row[]
    >`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${binding.keyId},${playRef.productId},${playId},${playRef.playSnapshotSha256},${binding.credentialDigest},${binding.operationKey},${text},${p4Hash(text)},3600,${auth.id},clock_timestamp(),clock_timestamp()) RETURNING *,row_to_json(access_key)::text AS __p4_row_text`;
    if (!row) throw Error("P4_TEST_KEY_MISSING");
    remember("access_key", row);
    return row;
  }
  async function claim(
    key: Row,
    sql: postgres.Sql | postgres.TransactionSql = db.app.sql,
  ) {
    const id = randomUUID(),
      a = consumerAnswersText([]),
      p = consumerProgressText({ questionId: null });
    const [row] = await sql<
      Row[]
    >`INSERT INTO qf.consumer_session(id,key_id,product_id,play_version_id,play_snapshot_sha256,created_at,state_revision,answers_text,consumer_state_answers_sha256,progress_text,progress_sha256) VALUES(${id},${String(key.id)},${playRef.productId},${playId},${playRef.playSnapshotSha256},date_trunc('milliseconds',clock_timestamp()),0,${a},${p4Hash(a)},${p},${p4Hash(p)}) RETURNING *,row_to_json(consumer_session)::text AS __p4_row_text`;
    if (!row) throw Error("P4_TEST_SESSION_MISSING");
    remember("consumer_session", row);
    return row;
  }
  async function voidKey(
    key: Row,
    sql: postgres.Sql | postgres.TransactionSql = db.app.sql,
  ) {
    const binding = {
      schemaVersion: "quizforge.access-key-void-unused.v1" as const,
      productId: playRef.productId,
      operationKey: randomUUID(),
      keyId: String(key.id),
      issueBindingSha256: String(key.issue_binding_sha256),
    };
    const text = voidUnusedAccessKeyBindingText(binding);
    const [row] = await sql<
      Row[]
    >`UPDATE qf.access_key SET revoked_at=clock_timestamp(),void_operation_key=${binding.operationKey},void_binding_text=${text},void_binding_sha256=${p4Hash(text)},voided_by=${auth.id} WHERE id=${String(key.id)} RETURNING *,row_to_json(access_key)::text AS __p4_row_text`;
    if (!row) throw Error("P4_TEST_VOID_MISSING");
    remember("access_key", row);
    return row;
  }
  async function save(
    session: Row,
    answers: { questionId: string; optionId: string }[],
  ) {
    const a = consumerAnswersText(answers),
      p = consumerProgressText({ questionId: null });
    const binding: ConsumerSaveBinding = {
      schemaVersion: "quizforge.consumer-save.v1",
      session: {
        ...playRef,
        keyId: String(session.key_id),
        sessionId: String(session.id),
      },
      expectedStateRevision: Number(session.state_revision),
      consumerStateAnswersSha256: p4Hash(a),
      progressSha256: p4Hash(p),
    };
    const b = consumerSaveBindingText(binding);
    const receipt = {
      schemaVersion: "quizforge.consumer-save-receipt.v1",
      binding,
      bindingSha256: p4Hash(b),
      appliedStateRevision: Number(session.state_revision) + 1,
      savedAt: new Date().toISOString(),
    };
    const r = consumerCanonicalText(receipt, 8192);
    const [row] = await db.app.sql<
      Row[]
    >`UPDATE qf.consumer_session SET state_revision=state_revision+1,answers_text=${a},consumer_state_answers_sha256=${p4Hash(a)},progress_text=${p},progress_sha256=${p4Hash(p)},last_binding_text=${b},last_binding_sha256=${p4Hash(b)},last_receipt_text=${r},last_receipt_sha256=${p4Hash(r)} WHERE id=${String(session.id)} AND state_revision=${Number(session.state_revision)} RETURNING *,row_to_json(consumer_session)::text AS __p4_row_text`;
    if (!row) throw Error("P4_TEST_SAVE_MISSING");
    remember("consumer_session", row);
    return row;
  }
  async function complete(session: Row) {
    if (!play) throw Error("P4_TEST_PLAY_MISSING");
    const parsed = parseSupportedContent(
      JSON.parse(fixed.evidence.canonicalContentText),
    );
    if (!parsed.ok || parsed.value.schemaVersion !== "quizpack-content.v2")
      throw Error("P4_TEST_SOURCE_INVALID");
    const answers = JSON.parse(String(session.answers_text)).answers as {
      questionId: string;
      optionId: string;
    }[];
    const progress = JSON.parse(String(session.progress_text)).progress as {
      questionId: string | null;
    };
    const prepared = prepareContentForScoring(parsed.value);
    if (!prepared.ok) throw Error("P4_TEST_PREPARE_INVALID");
    const score = scorePreparedContent(prepared.value, answers);
    if (!score.ok) throw Error("P4_TEST_SCORE_INVALID");
    const projection = projectContentScoreForDisplay(parsed.value, score.value);
    if (!projection.ok) throw Error("P4_TEST_DISPLAY_INVALID");
    const binding = {
      schemaVersion: "quizforge.consumer-complete.v1" as const,
      session: {
        ...playRef,
        keyId: String(session.key_id),
        sessionId: String(session.id),
      },
      expectedStateRevision: Number(session.state_revision),
      consumerStateAnswersSha256: String(session.consumer_state_answers_sha256),
      progressSha256: String(session.progress_sha256),
      completionKey: randomUUID(),
    };
    const text = consumerCompleteBindingText(binding),
      reportId = randomUUID(),
      completedAt = new Date().toISOString();
    const view: PersistedReportDisplay = {
      schemaVersion: "quizforge.consumer-report-display.v1",
      reportId,
      session: binding.session,
      completedAt,
      completionBindingSha256: p4Hash(text),
      parent: play.snapshot.parent,
      renderer: play.snapshot.renderer,
      font: play.snapshot.parentSnapshot.font,
      mapping: play.snapshot.mapping,
      mappingSha256: play.snapshot.mappingSha256,
      display: projection.value,
    };
    const snapshot = {
      schemaVersion: "quizforge.consumer-report-snapshot.v1",
      binding,
      play,
      answers,
      progress,
      score: contentScoreSchema.parse(score.value),
      view,
    };
    const body = persistedReportSnapshotText(snapshot);
    const displaySha = await persistedReportDisplaySha256(view);
    const [row] = await db.app.sql<
      Row[]
    >`INSERT INTO qf.quiz_report(id,key_id,session_id,product_id,play_version_id,play_snapshot_sha256,state_revision,consumer_state_answers_sha256,progress_sha256,completion_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,display_sha256,completed_at) VALUES(${reportId},${binding.session.keyId},${binding.session.sessionId},${playRef.productId},${playId},${playRef.playSnapshotSha256},${binding.expectedStateRevision},${binding.consumerStateAnswersSha256},${binding.progressSha256},${binding.completionKey},${text},${p4Hash(text)},${body},${p4Hash(body)},${displaySha},${completedAt}) RETURNING *,row_to_json(quiz_report)::text AS __p4_row_text`;
    if (!row) throw Error("P4_TEST_REPORT_MISSING");
    remember("quiz_report", row);
    return row;
  }
  async function cleanup() {
    const lock = await StorageLock.acquire(db.config);
    try {
      const uploads = path.dirname(importsDirectory(db.config));
      const dirs = await readdir(uploads, { withFileTypes: true }).catch(
        (e: unknown) => {
          if ((e as { code?: string }).code === "ENOENT") return [];
          throw e;
        },
      );
      for (const d of dirs) {
        if (
          !d.isDirectory() ||
          !["imports", "validation", "blobs"].includes(d.name)
        )
          throw Error("P4_TEST_NOT_NO_FILE");
        const file = path.join(uploads, d.name);
        const stat = await lstat(file);
        if (stat.isSymbolicLink() || (await readdir(file)).length)
          throw Error("P4_TEST_NOT_NO_FILE");
      }
      // Full graph proof precedes the FIRST delete, including fixture-owned ledgers. Unknown rows are retained.
      if (
        JSON.stringify(await readP4OldGraph(lock.connection)) !==
        JSON.stringify(expectedOldGraph)
      )
        throw Error("P4_TEST_OLD_GRAPH_CHANGED");
      for (const table of tables) {
        const rows = await lock.query(() =>
          lock.connection.unsafe<{ body: string }[]>(
            `SELECT row_to_json(t)::text AS body FROM qf.${table} t ORDER BY row_to_json(t)::text`,
          ),
        );
        const known = expected.get(table) ?? new Map();
        if (
          rows.length !== known.size ||
          rows.some(
            (r) => known.get(key(table, JSON.parse(r.body) as Row)) !== r.body,
          )
        )
          throw Error("P4_TEST_GRAPH_CHANGED");
      }
      await lock.check();
      await db.admin.sql.begin(async (tx) => {
        for (const table of [...tables].reverse()) {
          const rows = expected.get(table);
          if (!rows?.size) continue;
          for (const rowText of rows.values()) {
            const row = JSON.parse(rowText) as Row;
            if (table === "consumer_grant")
              await tx`DELETE FROM qf.consumer_grant WHERE key_id=${String(row.key_id)} AND slot=${Number(row.slot)} AND grant_id=${String(row.grant_id)}`;
            else
              await tx.unsafe(`DELETE FROM qf.${table} WHERE id=$1`, [
                String(row.id),
              ]);
          }
        }
        await tx`DELETE FROM qf.product_version WHERE id=${fixed.parent.version.id} AND snapshot_sha256=${fixed.parent.version.snapshotSha256}`;
        await tx`DELETE FROM qf.draft_review WHERE id=${fixed.review.id} AND review_sha256=${fixed.review.reviewSha256}`;
      });
    } finally {
      await lock.close();
    }
    await resetDomainDatabase(db);
  }
  return {
    auth,
    source,
    initial,
    ...fixed,
    play,
    playRef,
    issue,
    claim,
    voidKey,
    save,
    complete,
    remember,
    cleanup,
  };
}
