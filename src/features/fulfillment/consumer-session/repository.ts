import "server-only";
import { randomUUID } from "node:crypto";
import {
  assertConsumerTx,
  assertLockWitness,
  lockWitness,
  assertConsumerMutationDeadline,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
} from "@/lib/consumer-contract/v1/integrity";
import {
  consumerAnswersText,
  consumerAnswersSha256,
  consumerProgressText,
  consumerProgressSha256,
  consumerSaveBindingText,
  consumerSaveBindingSha256,
  verifyConsumerState,
  type ConsumerSaveInput,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import type { LockedAccessKey, GrantFact } from "../access/repository";
import type { DatabaseTime } from "@/lib/auth/internal";
import { iso } from "@/features/product/workspace/repository";
import { readFixedInternalPlay } from "@/features/product/internal-play/repository";
import {
  consumerMatchingTextV2,
  consumerMatchingSha256V2,
  consumerSaveBindingTextV2,
  consumerSaveBindingSha256V2,
  verifyConsumerStateV2,
  type ConsumerStateV2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
type SessionRow = {
  id: string;
  key_id: string;
  product_id: string;
  play_version_id: string;
  play_snapshot_sha256: string;
  created_at: DatabaseTime;
  state_revision: number;
  answers_text: string;
  consumer_state_answers_sha256: string;
  progress_text: string;
  progress_sha256: string;
  last_binding_text: string | null;
  last_binding_sha256: string | null;
  last_receipt_text: string | null;
  last_receipt_sha256: string | null;
  matching_context_text: string | null;
  matching_context_sha256: string | null;
};
export type CurrentConsumerState = ConsumerState | ConsumerStateV2;
export type LockedConsumerSession = Readonly<{ state: CurrentConsumerState }>;
async function state(
  tx: ConsumerTx,
  row: SessionRow,
): Promise<CurrentConsumerState> {
  const play = await readFixedInternalPlay(tx, {
    productId: row.product_id,
    playVersionId: row.play_version_id,
    playSnapshotSha256: row.play_snapshot_sha256,
  });
  const v2 =
    play.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2";
  if (
    v2
      ? row.matching_context_text === null ||
        row.matching_context_sha256 === null
      : row.matching_context_text !== null ||
        row.matching_context_sha256 !== null
  )
    throw new ConsumerError("UNAVAILABLE");
  if (
    Buffer.byteLength(row.answers_text) > L.answersBytes ||
    Buffer.byteLength(row.progress_text) > L.progressBytes ||
    (row.last_receipt_text !== null &&
      Buffer.byteLength(row.last_receipt_text) > L.lastSaveReceiptBytes)
  )
    throw new ConsumerError("UNAVAILABLE");
  const answers = JSON.parse(row.answers_text) as { answers: unknown },
    progress = JSON.parse(row.progress_text) as { progress: unknown };
  if (
    consumerAnswersText(answers.answers) !== row.answers_text ||
    consumerProgressText(progress.progress) !== row.progress_text
  )
    throw new ConsumerError("UNAVAILABLE");
  const lastSave =
    row.last_receipt_text === null ? null : JSON.parse(row.last_receipt_text);
  if (lastSave !== null) {
    if (
      consumerCanonicalText(lastSave, L.lastSaveReceiptBytes) !==
        row.last_receipt_text ||
      (v2
        ? consumerSaveBindingTextV2(lastSave.binding)
        : consumerSaveBindingText(lastSave.binding)) !==
        row.last_binding_text ||
      (await consumerTextSha256(row.last_receipt_text!)) !==
        row.last_receipt_sha256 ||
      lastSave.bindingSha256 !== row.last_binding_sha256
    )
      throw new ConsumerError("UNAVAILABLE");
  } else if (
    [
      row.last_binding_text,
      row.last_binding_sha256,
      row.last_receipt_sha256,
    ].some((v) => v !== null)
  )
    throw new ConsumerError("UNAVAILABLE");
  const facts = {
    session: {
      productId: row.product_id,
      playVersionId: row.play_version_id,
      playSnapshotSha256: row.play_snapshot_sha256,
      keyId: row.key_id,
      sessionId: row.id,
    },
    createdAt: iso(row.created_at),
    stateRevision: row.state_revision,
    answers: answers.answers,
    progress: progress.progress,
    consumerStateAnswersSha256: row.consumer_state_answers_sha256,
    progressSha256: row.progress_sha256,
    lastSave,
  };
  if (!v2)
    return verifyConsumerState({
      schemaVersion: "quizforge.consumer-state.v1",
      ...facts,
    });
  if (Buffer.byteLength(row.matching_context_text!) > 4096)
    throw new ConsumerError("UNAVAILABLE");
  const matchingContext: unknown = JSON.parse(row.matching_context_text!);
  if (consumerMatchingTextV2(matchingContext) !== row.matching_context_text)
    throw new ConsumerError("UNAVAILABLE");
  return verifyConsumerStateV2({
    schemaVersion: "quizforge.consumer-state.v2",
    ...facts,
    matchingContext,
    matchingContextSha256: row.matching_context_sha256,
  });
}
export async function readConsumerSession(tx: ConsumerTx, keyId: string) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    SessionRow[]
  >`SELECT * FROM qf.consumer_session WHERE key_id=${keyId}`;
  return row ? state(tx, row) : null;
}
export async function lockConsumerSession(
  tx: ConsumerTx,
  key: LockedAccessKey,
  expectedId?: string,
): Promise<LockedConsumerSession | null> {
  assertLockWitness(tx, key, "key", key.issue.binding.keyId);
  const [row] = await tx.sql<
    SessionRow[]
  >`SELECT * FROM qf.consumer_session WHERE key_id=${key.issue.binding.keyId} ${expectedId ? tx.sql`AND id=${expectedId}` : tx.sql``} FOR UPDATE`;
  return row
    ? lockWitness(tx, "session", row.id, { state: await state(tx, row) })
    : null;
}
export async function createConsumerSession(
  tx: ConsumerTx,
  key: LockedAccessKey,
): Promise<LockedConsumerSession> {
  assertLockWitness(tx, key, "key", key.issue.binding.keyId);
  const a = consumerAnswersText([]),
    p = consumerProgressText({ questionId: null }),
    ah = await consumerAnswersSha256([]),
    ph = await consumerProgressSha256({ questionId: null });
  const ref = key.issue.binding.play;
  const play = await readFixedInternalPlay(tx, ref);
  const v2 =
    play.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2";
  const contextText = v2 ? consumerMatchingTextV2(null) : null,
    contextSha = v2 ? await consumerMatchingSha256V2(null) : null;
  const [row] = await tx.sql<
    SessionRow[]
  >`INSERT INTO qf.consumer_session(id,key_id,product_id,play_version_id,play_snapshot_sha256,created_at,state_revision,answers_text,consumer_state_answers_sha256,progress_text,progress_sha256,matching_context_text,matching_context_sha256) VALUES(${randomUUID()},${key.issue.binding.keyId},${ref.productId},${ref.playVersionId},${ref.playSnapshotSha256},date_trunc('milliseconds',clock_timestamp()),0,${a},${ah},${p},${ph},${contextText},${contextSha}) RETURNING *`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return lockWitness(tx, "session", row.id, { state: await state(tx, row) });
}
/** Application already validated every answer/progress member against the fixed content source. */
export async function saveConsumerSession(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: LockedConsumerSession,
  grant: GrantFact,
  input: ConsumerSaveInput | ConsumerSaveInputV2,
  savedAt: string,
) {
  assertLockWitness(tx, key, "key", input.binding.session.keyId);
  assertLockWitness(tx, session, "session", input.binding.session.sessionId);
  assertLockWitness(tx, grant, "grant", grant.grantId);
  if (
    grant.keyId !== input.binding.session.keyId ||
    grant.sessionId !== input.binding.session.sessionId ||
    grant.revokedAt !== null
  )
    throw new ConsumerError("ACCESS_DENIED");
  if (
    !sameConsumerFact(
      session.state.session,
      input.binding.session,
      L.operationRequestBytes,
    ) ||
    session.state.stateRevision !== input.binding.expectedStateRevision
  )
    throw new ConsumerError("STATE_CONFLICT");
  if (session.state.stateRevision >= L.maximumStateRevision)
    throw new ConsumerError("STATE_LIMIT");
  const v2 = session.state.schemaVersion === "quizforge.consumer-state.v2";
  if (v2 !== (input.binding.schemaVersion === "quizforge.consumer-save.v2"))
    throw new ConsumerError("INVALID_REQUEST");
  const bindingText = v2
      ? consumerSaveBindingTextV2(input.binding)
      : consumerSaveBindingText(input.binding),
    bindingSha = v2
      ? await consumerSaveBindingSha256V2(input.binding)
      : await consumerSaveBindingSha256(input.binding);
  const receipt = {
    schemaVersion: v2
      ? "quizforge.consumer-save-receipt.v2"
      : "quizforge.consumer-save-receipt.v1",
    binding: input.binding,
    bindingSha256: bindingSha,
    appliedStateRevision: session.state.stateRevision + 1,
    savedAt,
  };
  const receiptText = consumerCanonicalText(receipt, L.lastSaveReceiptBytes),
    receiptSha = await consumerTextSha256(receiptText);
  const a = consumerAnswersText(input.answers),
    p = consumerProgressText(input.progress);
  const matchingText =
      "matchingContext" in input
        ? consumerMatchingTextV2(input.matchingContext)
        : null,
    matchingSha =
      "matchingContextSha256" in input.binding
        ? input.binding.matchingContextSha256
        : null;
  const [row] = await tx.sql<
    SessionRow[]
  >`WITH moment AS MATERIALIZED(SELECT clock_timestamp() AS at)
    UPDATE qf.consumer_session SET state_revision=state_revision+1,answers_text=${a},consumer_state_answers_sha256=${input.binding.consumerStateAnswersSha256},progress_text=${p},progress_sha256=${input.binding.progressSha256},matching_context_text=${matchingText},matching_context_sha256=${matchingSha},last_binding_text=${bindingText},last_binding_sha256=${bindingSha},last_receipt_text=${receiptText},last_receipt_sha256=${receiptSha} FROM moment m
    WHERE id=${input.binding.session.sessionId} AND key_id=${input.binding.session.keyId} AND state_revision=${input.binding.expectedStateRevision} AND m.at<${key.issue.expiresAt}::timestamptz AND m.at<${grant.expiresAt}::timestamptz RETURNING qf.consumer_session.*`;
  if (!row) {
    await assertConsumerMutationDeadline(
      tx,
      key.issue.expiresAt,
      grant.expiresAt,
    );
    throw new ConsumerError("STATE_CONFLICT");
  }
  return state(tx, row);
}
export async function readClaimMetadata(
  tx: ConsumerTx,
  keyIds: readonly string[],
) {
  assertConsumerTx(tx);
  if (keyIds.length > L.keysPerPage) throw new ConsumerError("INVALID_REQUEST");
  const rows = await tx.sql<
    { key_id: string; id: string; created_at: DatabaseTime }[]
  >`SELECT key_id,id,created_at FROM qf.consumer_session WHERE key_id=ANY(${tx.sql.array([...keyIds])}::uuid[]) LIMIT 51`;
  return rows.map((row) => ({
    keyId: row.key_id,
    sessionId: row.id,
    claimedAt: iso(row.created_at),
  }));
}
