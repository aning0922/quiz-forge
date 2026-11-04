import "server-only";
import { z } from "zod";
import {
  assertConsumerTx,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import {
  consumerUuidSchema as uuid,
  consumerSha256Schema as sha,
  consumerIdSchema as id,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerAnswersText,
  consumerProgressText,
  consumerSaveBindingText,
  type ConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerSaveBindingTextV2,
  consumerMatchingTextV2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerProductActivationBindingText,
  type ActivateConsumerProductBinding,
} from "@/features/product/internal-play/activation-contracts";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
const selectorSchema = z.strictObject({
  productId: id,
  keyId: uuid,
  sessionId: uuid,
  grantId: uuid,
  credentialDigest: sha,
});
export type PolicyGrantSelector = z.infer<typeof selectorSchema>;
// Server-only database rows. These are not a public DTO or a TS lock witness;
// existing domain integrity decoders must validate them before service handoff.
type Row = Record<string, unknown>;
const rowsSchema = z.strictObject({
  head: z.record(z.string(), z.unknown()).nullable(),
  key: z.record(z.string(), z.unknown()),
  session: z.record(z.string(), z.unknown()),
  grant: z.record(z.string(), z.unknown()),
});
export async function lockPolicyAuthority(
  tx: ConsumerTx,
  input: PolicyGrantSelector,
) {
  assertConsumerTx(tx);
  const s = selectorSchema.parse(input);
  const [row] = await tx.sql<
    { value: unknown }[]
  >`SELECT qf.consumer_lock_authority(${s.productId},${s.keyId},${s.sessionId},${s.grantId},${s.credentialDigest}) value`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return rowsSchema.parse(row.value);
}
export async function readAttemptMetadata(
  tx: ConsumerTx,
  input: { productId: string; keyId: string; sessionId: string },
) {
  assertConsumerTx(tx);
  const s = z
    .strictObject({ productId: id, keyId: uuid, sessionId: uuid })
    .parse(input);
  const [row] = await tx.sql<
    Row[]
  >`SELECT id,key_id,product_id,activation_generation,play_version_id,play_snapshot_sha256,key_bound_play_version_id,key_bound_play_snapshot_sha256 FROM qf.consumer_session WHERE product_id=${s.productId} AND key_id=${s.keyId} AND id=${s.sessionId}`;
  return row ?? null;
}
export async function readGenerationAttemptMetadata(
  tx: ConsumerTx,
  input: {
    productId: string;
    keyId: string;
    generation: number;
    playVersionId: string;
    playSnapshotSha256: string;
  },
) {
  assertConsumerTx(tx);
  const s = z
    .strictObject({
      productId: id,
      keyId: uuid,
      generation: z.number().int().positive().max(2147483647),
      playVersionId: uuid,
      playSnapshotSha256: sha,
    })
    .parse(input);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_session WHERE product_id=${s.productId} AND key_id=${s.keyId} AND activation_generation=${s.generation} AND play_version_id=${s.playVersionId} AND play_snapshot_sha256=${s.playSnapshotSha256}`;
  return row ?? null;
}
export async function readReportAttemptMetadata(
  tx: ConsumerTx,
  input: { productId: string; keyId: string },
) {
  assertConsumerTx(tx);
  const s = z.strictObject({ productId: id, keyId: uuid }).parse(input);
  const [row] = await tx.sql<
    Row[]
  >`SELECT s.* FROM qf.quiz_report r JOIN qf.consumer_session s ON (s.id,s.key_id,s.product_id,s.play_version_id,s.play_snapshot_sha256)=(r.session_id,r.key_id,r.product_id,r.play_version_id,r.play_snapshot_sha256) WHERE r.product_id=${s.productId} AND r.key_id=${s.keyId}`;
  return row ?? null;
}
export async function revokePolicyGrant(
  tx: ConsumerTx,
  input: PolicyGrantSelector,
) {
  assertConsumerTx(tx);
  const s = selectorSchema.parse(input);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_revoke_grant(${s.productId},${s.keyId},${s.sessionId},${s.grantId},${s.credentialDigest})`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return row;
}
export async function rotatePolicyGrant(
  tx: ConsumerTx,
  input: {
    productId: string;
    keyId: string;
    keyDigest: string;
    sessionId: string;
    freshGrantId: string;
    freshDigest: string;
  },
) {
  assertConsumerTx(tx);
  const s = z
    .strictObject({
      productId: id,
      keyId: uuid,
      keyDigest: sha,
      sessionId: uuid,
      freshGrantId: uuid,
      freshDigest: sha,
    })
    .parse(input);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_rotate_grant(${s.productId},${s.keyId},${s.keyDigest},${s.sessionId},${s.freshGrantId},${s.freshDigest})`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return row;
}
export async function activatePolicyProduct(
  tx: ConsumerTx,
  binding: ActivateConsumerProductBinding,
  operatorDigest: string,
  requestId: string,
) {
  assertConsumerTx(tx);
  const text = consumerProductActivationBindingText(binding);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_activate_product(${text},${sha.parse(operatorDigest)},${uuid.parse(requestId)})`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return row;
}
export async function readActivationOperation(
  tx: ConsumerTx,
  productId: string,
  operationKey: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_product_activation WHERE product_id=${id.parse(productId)} AND operation_key=${uuid.parse(operationKey)}`;
  return row ?? null;
}
export async function readPolicyHead(tx: ConsumerTx, productId: string) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_product_head WHERE product_id=${id.parse(productId)}`;
  return row ?? null;
}
export async function savePolicyAttempt(
  tx: ConsumerTx,
  selector: PolicyGrantSelector,
  input: ConsumerSaveInput | ConsumerSaveInputV2,
) {
  assertConsumerTx(tx);
  const s = selectorSchema.parse(selector);
  if (
    input.binding.session.sessionId !== s.sessionId ||
    input.binding.session.keyId !== s.keyId ||
    input.binding.session.productId !== s.productId
  )
    throw new ConsumerError("ACCESS_DENIED");
  const binding =
    "matchingContext" in input
      ? consumerSaveBindingTextV2(input.binding)
      : consumerSaveBindingText(input.binding);
  const context =
    "matchingContext" in input
      ? consumerMatchingTextV2(input.matchingContext)
      : null;
  const [row] = await tx.sql<
    Row[]
  >`SELECT * FROM qf.consumer_save_attempt(${s.productId},${s.keyId},${s.sessionId},${s.grantId},${s.credentialDigest},${input.binding.expectedStateRevision},${binding},${consumerAnswersText(input.answers)},${consumerProgressText(input.progress)},${context})`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return row;
}

export async function exchangePolicyAttempt(
  tx: ConsumerTx,
  input: {
    productId: string;
    keyDigest: string;
    freshGrantId: string;
    freshDigest: string;
  },
) {
  assertConsumerTx(tx);
  const s = z
    .strictObject({
      productId: id,
      keyDigest: sha,
      freshGrantId: uuid,
      freshDigest: sha,
    })
    .parse(input);
  const [row] = await tx.sql<
    { value: unknown }[]
  >`SELECT qf.consumer_exchange_attempt(${s.productId},${s.keyDigest},${s.freshGrantId},${s.freshDigest}) value`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return z
    .strictObject({
      session: z.record(z.string(), z.unknown()),
      grant: z.record(z.string(), z.unknown()),
      destination: z.enum(["play", "report"]),
    })
    .parse(row.value);
}
