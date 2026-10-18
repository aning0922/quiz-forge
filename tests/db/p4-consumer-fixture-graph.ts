import type postgres from "postgres";
import { runInConsumerTransaction } from "@/lib/db/consumer-transaction";
import { readInternalPlayById } from "@/features/product/internal-play/repository";
import { readKeyFact } from "@/features/fulfillment/access/repository";
import { readConsumerSession } from "@/features/fulfillment/consumer-session/repository";
import { readPersistedReport } from "@/features/report/persisted/repository";
import { verifyAccessKeyDetail } from "@/features/fulfillment/access/contracts";
import { iso } from "@/features/product/workspace/repository";
import { internalCanonicalText } from "@/features/product/internal-versions/contracts";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionDetail,
} from "@/features/product/internal-versions/integrity";
import { readFrozenDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { buildInternalSnapshot } from "@/features/product/internal-versions/snapshot";
import { digestToken } from "@/lib/security/p2a-tokens";
import {
  fixtureAuditAllowed,
  type FixtureAuditTarget,
} from "./p2b2b-maintenance";
import type {
  ConsumerFixture,
  ConsumerFixtureObservations,
} from "./p4-consumer-fixture-contract";

export const consumerFixtureFailure = () =>
  Error("CONSUMER_FIXTURE_UNKNOWN_PRESERVED");
const fail = consumerFixtureFailure;
const same = (a: unknown, b: unknown) =>
  internalCanonicalText(a) === internalCanonicalText(b);
type Table = ConsumerFixture["rows"][number]["table"];
type Raw = { body: Record<string, unknown>; sha256: string };
const scoped: readonly Table[] = [
  "quizpack_import",
  "quizpack_validation",
  "product_asset",
  "product_draft",
  "draft_application",
  "draft_revision",
  "draft_review",
  "product_version",
  "internal_play_version",
  "access_key",
  "consumer_session",
  "quiz_report",
];
const identity = (table: Table, r: Raw["body"]) => {
  if (table === "asset_blob") return String(r.sha256);
  if (table === "product_asset")
    return `${r.product_id}/${r.resource_id}/${r.resource_version}`;
  if (table === "draft_revision") return `${r.draft_id}/${r.revision}`;
  if (table === "consumer_grant") return `${r.key_id}/${r.slot}`;
  return String(r.id);
};
/** Finite tables and exact full PostgreSQL row text. No Date/JSON round trip is used for the hash. */
export async function consumerFixtureGraph(
  tx: postgres.TransactionSql,
  value: ConsumerFixture,
) {
  const actors = [value.operator.identifier, value.readOnly.identifier],
    graph = new Map<Table, Raw[]>();
  const columns = tx`to_jsonb(t) AS body, encode(sha256(convert_to(row_to_json(t)::text,'UTF8')),'hex') AS sha256`;
  for (const table of scoped) {
    const rows = await tx<
      Raw[]
    >`SELECT ${columns} FROM ${tx(`qf.${table}`)} t WHERE product_id=${value.productId} LIMIT 8193`;
    graph.set(table, rows);
  }
  graph.set(
    "product",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.product t WHERE id=${value.productId} LIMIT 2`,
  );
  graph.set(
    "operator",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.operator t WHERE id=ANY(${tx.array(actors)}::uuid[]) LIMIT 3`,
  );
  graph.set(
    "operator_session",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.operator_session t WHERE operator_id=ANY(${tx.array(actors)}::uuid[]) LIMIT 1025`,
  );
  graph.set(
    "audit_event",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.audit_event t WHERE actor_id=ANY(${tx.array(actors)}::uuid[]) LIMIT 8193`,
  );
  graph.set(
    "asset_blob",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.asset_blob t WHERE sha256=ANY(${tx.array(value.blobs.map((b) => b.sha256))}::text[]) LIMIT 6`,
  );
  graph.set(
    "consumer_grant",
    await tx<
      Raw[]
    >`SELECT ${columns} FROM qf.consumer_grant t WHERE key_id IN(SELECT id FROM qf.access_key WHERE product_id=${value.productId}) LIMIT 1025`,
  );
  const rows = [...graph]
    .flatMap(([table, rs]) =>
      rs.map((r) => ({
        table,
        key: identity(table, r.body),
        sha256: r.sha256,
      })),
    )
    .sort((a, b) => `${a.table}/${a.key}`.localeCompare(`${b.table}/${b.key}`));
  if (
    rows.length > 8192 ||
    (graph.get("operator_session")?.length ?? 0) > 1024 ||
    (graph.get("consumer_grant")?.length ?? 0) > 1024
  )
    throw fail();
  return { graph, rows };
}

export async function verifyConsumerFixtureGraph(
  tx: postgres.TransactionSql,
  value: ConsumerFixture,
  observations: ConsumerFixtureObservations | null,
) {
  if (
    !value.parent ||
    !value.review ||
    !value.source ||
    !value.target ||
    !value.initial
  )
    throw fail();
  await verifyInternalVersionDetail(value.parent);
  await verifyInternalReviewReceipt(value.review);
  const proof = await readFrozenDraftSourceEvidenceReadonly(
    tx,
    value.source.scope,
    {
      expectedValidationStateRevision:
        value.source.expectedValidationStateRevision,
      expectedCandidateSha256: value.source.expectedCandidateSha256,
    },
  );
  if (
    buildInternalSnapshot(value.parent.version.binding, value.review, proof)
      .text !== internalCanonicalText(value.parent.snapshot)
  )
    throw fail();
  const result = await consumerFixtureGraph(tx, value),
    { graph } = result;
  for (const [table, count] of [
    ["product", 1],
    ["operator", 2],
    ["quizpack_import", 1],
    ["quizpack_validation", 1],
    ["product_draft", 1],
    ["draft_application", 1],
    ["draft_revision", 1],
    ["draft_review", 1],
    ["product_version", 1],
    ["product_asset", 5],
    ["asset_blob", 5],
  ] as const)
    if (graph.get(table)?.length !== count) throw fail();
  const root = graph.get("product_draft")![0]!.body;
  if (
    root.id !== value.target.draftId ||
    root.current_revision !== 1 ||
    root.created_by !== value.operator.identifier
  )
    throw fail();
  const review = graph.get("draft_review")![0]!.body,
    parent = graph.get("product_version")![0]!.body;
  if (
    review.id !== value.review.id ||
    review.review_sha256 !== value.review.reviewSha256 ||
    parent.id !== value.parent.version.id ||
    parent.snapshot_sha256 !== value.parent.version.snapshotSha256 ||
    parent.created_by !== value.operator.identifier ||
    review.recorded_by !== value.operator.identifier
  )
    throw fail();
  const actors = [value.operator.identifier, value.readOnly.identifier];
  for (const row of graph.get("operator")!) {
    const operator = row.body.id === value.operator.identifier,
      actor = operator ? value.operator : value.readOnly;
    if (
      row.body.label !==
        `p4-e2e-${value.runId}-${operator ? "operator" : "read-only"}` ||
      row.body.role !== (operator ? "operator" : "read-only") ||
      row.body.credential_digest !== digestToken(actor.secret, "credential")
    )
      throw fail();
  }
  // Source/parent rows must be the exact preparation facts. Mutable auth and current consumer rows are handled separately.
  const mutable = new Set<Table>([
    "operator_session",
    "audit_event",
    "internal_play_version",
    "access_key",
    "consumer_session",
    "consumer_grant",
    "quiz_report",
  ]);
  for (const old of value.rows) {
    if (mutable.has(old.table)) continue;
    if (
      !result.rows.some(
        (r) =>
          r.table === old.table && r.key === old.key && r.sha256 === old.sha256,
      )
    )
      throw fail();
  }
  const [foreign] = await tx<{ present: boolean }[]>`SELECT
    EXISTS(SELECT 1 FROM qf.draft_application WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.product_draft WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.draft_revision WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.product_tag WHERE product_id=${value.productId})
    OR EXISTS(SELECT 1 FROM qf.quizpack_import WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.draft_review WHERE recorded_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.product_version WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.internal_play_version WHERE created_by=ANY(${tx.array(actors)}::uuid[]) AND product_id<>${value.productId})
    OR EXISTS(SELECT 1 FROM qf.access_key WHERE (issued_by=ANY(${tx.array(actors)}::uuid[]) OR voided_by=ANY(${tx.array(actors)}::uuid[])) AND product_id<>${value.productId}) AS present`;
  if (foreign?.present !== false) throw fail();
  const expected = observations ?? {
    plays: [],
    keys: [],
    states: [],
    reports: [],
    grants: [],
  };
  for (const [table, ids] of [
    ["internal_play_version", expected.plays.map((x) => x.id)],
    ["access_key", expected.keys.map((x) => x.issue.binding.keyId)],
    ["consumer_session", expected.states.map((x) => x.session.sessionId)],
    ["quiz_report", expected.reports.map((x) => x.reportId)],
  ] as const) {
    const actual = graph.get(table)!;
    if (
      actual.length !== ids.length ||
      actual.some((r) => !ids.includes(String(r.body.id)))
    )
      throw fail();
  }
  await runInConsumerTransaction(
    tx,
    () => {},
    async (context) => {
      for (const p of expected.plays) {
        const actual = await readInternalPlayById(
          context,
          value.productId,
          p.id,
        );
        if (
          !actual ||
          !same(actual.play, p) ||
          p.createdBy !== value.operator.identifier ||
          p.binding.parent.versionId !== value.parent!.version.id ||
          p.binding.parent.snapshotSha256 !==
            value.parent!.version.snapshotSha256 ||
          !same(actual.snapshot.parentSnapshot, value.parent!.snapshot) ||
          !same(p.binding.renderer, value.consumerRenderer)
        )
          throw fail();
      }
      for (const k of expected.keys) {
        await verifyAccessKeyDetail(k);
        const actual = await readKeyFact(
          context,
          value.productId,
          k.issue.binding.keyId,
        );
        if (
          !actual ||
          !same(actual.issue, k.issue) ||
          !same(actual.voidReceipt, k.current.voidReceipt) ||
          k.issue.issuedBy !== value.operator.identifier ||
          (actual.voidReceipt &&
            actual.voidReceipt.voidedBy !== value.operator.identifier)
        )
          throw fail();
        const state = await readConsumerSession(context, k.issue.binding.keyId),
          report = await readPersistedReport(context, k.issue.binding.keyId);
        const claim = state
            ? { sessionId: state.session.sessionId, claimedAt: state.createdAt }
            : null,
          completion = report
            ? {
                reportId: report.receipt.reportId,
                completedAt: report.receipt.completedAt,
              }
            : null;
        if (
          !same(claim, k.current.claim) ||
          !same(completion, k.current.completion)
        )
          throw fail();
        if (state && !expected.states.some((s) => same(s, state))) throw fail();
        if (report && !expected.reports.some((r) => same(r, report.receipt)))
          throw fail();
      }
    },
  );
  for (const row of graph.get("consumer_grant")!) {
    const r = row.body,
      g = expected.grants.find((g) => g.grantId === r.grant_id);
    if (
      !g ||
      g.session.keyId !== r.key_id ||
      g.session.sessionId !== r.session_id ||
      g.credentialDigest !== r.credential_digest ||
      g.issuedAt !== iso(r.issued_at as string) ||
      g.expiresAt !== iso(r.expires_at as string) ||
      g.logoutObserved !== (r.revoked_at !== null)
    )
      throw fail();
  }
  const sessions = new Set(
    graph.get("operator_session")!.map((r) => String(r.body.id)),
  );
  const [foreignAudit] = await tx<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.audit_event WHERE session_id=ANY(${tx.array([...sessions])}::uuid[]) AND (actor_id IS NULL OR NOT actor_id=ANY(${tx.array(actors)}::uuid[]))) AS present`;
  if (foreignAudit?.present !== false) throw fail();
  const targets = [
    value.productId,
    value.target.draftId,
    value.review.id,
    value.parent.version.id,
    value.source.scope.sourceImportId,
    value.source.scope.sourceValidationId,
    ...expected.plays.map((p) => p.id),
    ...expected.keys.map((k) => k.issue.binding.keyId),
  ];
  const [foreignTarget] = await tx<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.audit_event WHERE target_id=ANY(${tx.array(targets)}::text[]) AND (actor_id IS NULL OR NOT actor_id=ANY(${tx.array(actors)}::uuid[]))) AS present`;
  if (foreignTarget?.present !== false) throw fail();
  for (const row of graph.get("audit_event")!) {
    const e = row.body as unknown as FixtureAuditTarget;
    if (
      ["draft", "review", "version", "play", "access-key"].includes(
        e.target_kind ?? "",
      )
    ) {
      if (
        e.actor_id !== value.operator.identifier ||
        !sessions.has(String(e.session_id))
      )
        throw fail();
      const valid =
        e.target_kind === "draft"
          ? e.action === "draft_applied" &&
            e.target_id === value.target.draftId &&
            e.target_revision === 1
          : e.target_kind === "review"
            ? e.action === "draft_baseline_recorded" &&
              e.target_id === value.review.id &&
              e.target_revision === 1
            : e.target_kind === "version"
              ? e.action === "internal_version_sealed" &&
                e.target_id === value.parent.version.id &&
                e.target_revision === 1
              : e.target_kind === "play"
                ? e.action === "internal_play_created" &&
                  expected.plays.some(
                    (p) => p.id === e.target_id && p.slot === e.target_revision,
                  )
                : e.target_revision === 1 &&
                  expected.keys.some(
                    (k) =>
                      k.issue.binding.keyId === e.target_id &&
                      (e.action === "access_key_issued" ||
                        (e.action === "access_key_voided" &&
                          k.current.voidReceipt)),
                  );
      if (!valid) throw fail();
    } else if (
      !fixtureAuditAllowed(e, {
        productId: value.productId,
        importIds: new Set([value.source.scope.sourceImportId]),
        validationIds: new Set([value.source.scope.sourceValidationId]),
        actorIds: new Set(actors),
        sessionIds: sessions,
      })
    )
      throw fail();
  }
  return result;
}
