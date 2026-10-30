import { readConsumerFixedSource } from "@/features/quizpack/consumer-fixed-source";
import "server-only";
import {
  assertConsumerTx,
  assertLockWitness,
  assertConsumerMutationDeadline,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import type {
  LockedAccessKey,
  GrantFact,
} from "@/features/fulfillment/access/repository";
import type { LockedConsumerSession } from "@/features/fulfillment/consumer-session/repository";
import type { DatabaseTime } from "@/lib/auth/internal";
import { iso } from "@/features/product/workspace/repository";
import {
  consumerCompleteBindingText,
  consumerCompleteBindingSha256,
  persistedReportDisplaySha256,
} from "./view-contracts";
import {
  persistedReportSnapshotText,
  persistedReportSnapshotSha256,
  verifyPersistedReportDetail,
  type PersistedReportSnapshot,
  type PersistedReportDetail,
} from "./snapshot-contract";
import { readFixedInternalPlay } from "@/features/product/internal-play/repository";
import {
  consumerCompleteBindingTextV2,
  consumerCompleteBindingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import { persistedReportDisplaySha256V2 } from "./view-contracts-v2";
import {
  persistedReportSnapshotTextV2,
  persistedReportSnapshotSha256V2,
  verifyPersistedReportDetailV2,
  type PersistedReportSnapshotV2,
  type PersistedReportDetailV2,
} from "./snapshot-contract-v2";
type ReportRow = {
  id: string;
  key_id: string;
  session_id: string;
  product_id: string;
  play_version_id: string;
  play_snapshot_sha256: string;
  state_revision: number;
  consumer_state_answers_sha256: string;
  progress_sha256: string;
  completion_key: string;
  binding_text: string;
  binding_sha256: string;
  snapshot_text: string;
  snapshot_sha256: string;
  display_sha256: string;
  completed_at: DatabaseTime;
  matching_context_sha256: string | null;
};
export type CurrentPersistedReportDetail =
  PersistedReportDetail | PersistedReportDetailV2;
async function detail(
  tx: ConsumerTx,
  row: ReportRow,
): Promise<CurrentPersistedReportDetail> {
  const play = await readFixedInternalPlay(tx, {
    productId: row.product_id,
    playVersionId: row.play_version_id,
    playSnapshotSha256: row.play_snapshot_sha256,
  });
  const v2 =
    play.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2";
  if (
    v2
      ? row.matching_context_sha256 === null
      : row.matching_context_sha256 !== null
  )
    throw new ConsumerError("UNAVAILABLE");
  if (
    Buffer.byteLength(row.binding_text) > L.operationRequestBytes ||
    Buffer.byteLength(row.snapshot_text) > L.reportSnapshotBytes
  )
    throw new ConsumerError("UNAVAILABLE");
  const binding = JSON.parse(row.binding_text),
    snapshot: unknown = JSON.parse(row.snapshot_text);
  if (
    (v2
      ? consumerCompleteBindingTextV2(binding)
      : consumerCompleteBindingText(binding)) !== row.binding_text ||
    (v2
      ? persistedReportSnapshotTextV2(snapshot)
      : persistedReportSnapshotText(snapshot)) !== row.snapshot_text
  )
    throw new ConsumerError("UNAVAILABLE");
  const facts = {
    receipt: {
      schemaVersion: v2
        ? "quizforge.consumer-report-receipt.v2"
        : "quizforge.consumer-report-receipt.v1",
      reportId: row.id,
      binding,
      bindingSha256: row.binding_sha256,
      completedAt: iso(row.completed_at),
      reportSnapshotSha256: row.snapshot_sha256,
      displaySha256: row.display_sha256,
    },
    snapshot,
  };
  const value = v2
    ? await verifyPersistedReportDetailV2(facts)
    : await verifyPersistedReportDetail(facts);
  if (
    value.snapshot.view.display.contentSchemaVersion ===
      "quizpack-content.v3" &&
    value.snapshot.view.display.assets.some(
      (a) => a.approval === "private-test-only",
    )
  ) {
    await readConsumerFixedSource(tx, play.snapshot.parentSnapshot);
  }
  const b = value.receipt.binding,
    s = b.session;
  if (
    s.keyId !== row.key_id ||
    s.sessionId !== row.session_id ||
    s.productId !== row.product_id ||
    s.playVersionId !== row.play_version_id ||
    s.playSnapshotSha256 !== row.play_snapshot_sha256 ||
    b.completionKey !== row.completion_key ||
    b.expectedStateRevision !== row.state_revision ||
    b.consumerStateAnswersSha256 !== row.consumer_state_answers_sha256 ||
    b.progressSha256 !== row.progress_sha256 ||
    ("matchingContextSha256" in b &&
      b.matchingContextSha256 !== row.matching_context_sha256)
  )
    throw new ConsumerError("UNAVAILABLE");
  return value;
}
export async function readPersistedReport(tx: ConsumerTx, keyId: string) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    ReportRow[]
  >`SELECT * FROM qf.quiz_report WHERE key_id=${keyId}`;
  return row ? detail(tx, row) : null;
}
export async function insertPersistedReport(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: LockedConsumerSession,
  grant: GrantFact,
  snapshot: PersistedReportSnapshot | PersistedReportSnapshotV2,
) {
  const b = snapshot.binding,
    s = b.session;
  assertLockWitness(tx, key, "key", s.keyId);
  assertLockWitness(tx, session, "session", s.sessionId);
  assertLockWitness(tx, grant, "grant", grant.grantId);
  if (
    grant.keyId !== s.keyId ||
    grant.sessionId !== s.sessionId ||
    grant.revokedAt !== null
  )
    throw new ConsumerError("ACCESS_DENIED");
  const v2 = session.state.schemaVersion === "quizforge.consumer-state.v2";
  if (
    v2 !==
    (snapshot.schemaVersion === "quizforge.consumer-report-snapshot.v2")
  )
    throw new ConsumerError("INVALID_REQUEST");
  const id = snapshot.view.reportId,
    completedAt = snapshot.view.completedAt;
  const bindingText = v2
      ? consumerCompleteBindingTextV2(b)
      : consumerCompleteBindingText(b),
    bindingSha = v2
      ? await consumerCompleteBindingSha256V2(b)
      : await consumerCompleteBindingSha256(b),
    snapshotText = v2
      ? persistedReportSnapshotTextV2(snapshot)
      : persistedReportSnapshotText(snapshot),
    snapshotSha = v2
      ? await persistedReportSnapshotSha256V2(snapshot)
      : await persistedReportSnapshotSha256(snapshot),
    displaySha = v2
      ? await persistedReportDisplaySha256V2(snapshot.view)
      : await persistedReportDisplaySha256(snapshot.view),
    matchingSha = "matchingContextSha256" in b ? b.matchingContextSha256 : null;
  const [row] = await tx.sql<
    ReportRow[]
  >`WITH moment AS MATERIALIZED(SELECT clock_timestamp() AS at)
    INSERT INTO qf.quiz_report(id,key_id,session_id,product_id,play_version_id,play_snapshot_sha256,state_revision,consumer_state_answers_sha256,progress_sha256,matching_context_sha256,completion_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,display_sha256,completed_at)
    SELECT ${id},${s.keyId},${s.sessionId},${s.productId},${s.playVersionId},${s.playSnapshotSha256},${b.expectedStateRevision},${b.consumerStateAnswersSha256},${b.progressSha256},${matchingSha},${b.completionKey},${bindingText},${bindingSha},${snapshotText},${snapshotSha},${displaySha},${completedAt}::timestamptz FROM moment m
    WHERE m.at<${key.issue.expiresAt}::timestamptz AND m.at<${grant.expiresAt}::timestamptz RETURNING *`;
  if (!row) {
    await assertConsumerMutationDeadline(
      tx,
      key.issue.expiresAt,
      grant.expiresAt,
    );
    throw new ConsumerError("UNAVAILABLE");
  }
  return detail(tx, row);
}
export async function readCompletionMetadata(
  tx: ConsumerTx,
  keyIds: readonly string[],
) {
  assertConsumerTx(tx);
  if (keyIds.length > L.keysPerPage) throw new ConsumerError("INVALID_REQUEST");
  const rows = await tx.sql<
    { key_id: string; id: string; completed_at: DatabaseTime }[]
  >`SELECT key_id,id,completed_at FROM qf.quiz_report WHERE key_id=ANY(${tx.sql.array([...keyIds])}::uuid[]) LIMIT 51`;
  return rows.map((row) => ({
    keyId: row.key_id,
    reportId: row.id,
    completedAt: iso(row.completed_at),
  }));
}
