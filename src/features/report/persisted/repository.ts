import "server-only";
import {
  assertConsumerTx,
  assertLockWitness,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import type { LockedAccessKey } from "@/features/fulfillment/access/repository";
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
};
async function detail(row: ReportRow): Promise<PersistedReportDetail> {
  if (
    Buffer.byteLength(row.binding_text) > L.operationRequestBytes ||
    Buffer.byteLength(row.snapshot_text) > L.reportSnapshotBytes
  )
    throw new ConsumerError("UNAVAILABLE");
  const binding = JSON.parse(row.binding_text),
    snapshot: unknown = JSON.parse(row.snapshot_text);
  if (
    consumerCompleteBindingText(binding) !== row.binding_text ||
    persistedReportSnapshotText(snapshot) !== row.snapshot_text
  )
    throw new ConsumerError("UNAVAILABLE");
  const value = await verifyPersistedReportDetail({
    receipt: {
      schemaVersion: "quizforge.consumer-report-receipt.v1",
      reportId: row.id,
      binding,
      bindingSha256: row.binding_sha256,
      completedAt: iso(row.completed_at),
      reportSnapshotSha256: row.snapshot_sha256,
      displaySha256: row.display_sha256,
    },
    snapshot,
  });
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
    b.progressSha256 !== row.progress_sha256
  )
    throw new ConsumerError("UNAVAILABLE");
  return value;
}
export async function readPersistedReport(tx: ConsumerTx, keyId: string) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    ReportRow[]
  >`SELECT * FROM qf.quiz_report WHERE key_id=${keyId}`;
  return row ? detail(row) : null;
}
export async function insertPersistedReport(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: LockedConsumerSession,
  snapshot: PersistedReportSnapshot,
) {
  const b = snapshot.binding,
    s = b.session;
  assertLockWitness(tx, key, "key", s.keyId);
  assertLockWitness(tx, session, "session", s.sessionId);
  const id = snapshot.view.reportId,
    completedAt = snapshot.view.completedAt;
  const bindingText = consumerCompleteBindingText(b),
    bindingSha = await consumerCompleteBindingSha256(b),
    snapshotText = persistedReportSnapshotText(snapshot),
    snapshotSha = await persistedReportSnapshotSha256(snapshot),
    displaySha = await persistedReportDisplaySha256(snapshot.view);
  const [row] = await tx.sql<
    ReportRow[]
  >`INSERT INTO qf.quiz_report(id,key_id,session_id,product_id,play_version_id,play_snapshot_sha256,state_revision,consumer_state_answers_sha256,progress_sha256,completion_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,display_sha256,completed_at) VALUES(${id},${s.keyId},${s.sessionId},${s.productId},${s.playVersionId},${s.playSnapshotSha256},${b.expectedStateRevision},${b.consumerStateAnswersSha256},${b.progressSha256},${b.completionKey},${bindingText},${bindingSha},${snapshotText},${snapshotSha},${displaySha},${completedAt}::timestamptz) RETURNING *`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return detail(row);
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
