import "server-only";
import { randomUUID } from "node:crypto";
import {
  assertConsumerTx,
  lockWitness,
  assertLockWitness,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type {
  InternalPlayRef,
  InternalParentVersionRef,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { iso, nullableIso, productRow } from "../workspace/repository";
import type { DatabaseTime } from "@/lib/auth/internal";
import { versionById, versionDetail } from "../internal-versions/repository";
import { draftRoot, revisionMetadata } from "../drafts/repository";
import type { InternalVersionDetail } from "../internal-versions/contracts";
import {
  internalPlayBindingText,
  internalPlayBindingSha256,
  internalPlaySnapshotText,
  internalPlaySnapshotSha256,
  verifyInternalPlayDetail,
  type InternalPlayDetail,
  type InternalPlaySnapshot,
  type CreateInternalPlayBinding,
} from "./contracts";
type PlayRow = {
  id: string;
  product_id: string;
  slot: number;
  parent_version_id: string;
  parent_snapshot_sha256: string;
  operation_key: string;
  binding_text: string;
  binding_sha256: string;
  snapshot_text: string;
  snapshot_sha256: string;
  created_by: string;
  created_at: DatabaseTime;
};
export type LockedConsumerProduct = Readonly<{
  productId: string;
  archivedAt: string | null;
}>;
export async function readConsumerProduct(tx: ConsumerTx, productId: string) {
  assertConsumerTx(tx);
  const row = await productRow(tx.sql, productId);
  return { productId, archivedAt: nullableIso(row.archived_at) };
}
export async function lockConsumerProduct(
  tx: ConsumerTx,
  productId: string,
): Promise<LockedConsumerProduct> {
  assertConsumerTx(tx);
  const row = await productRow(tx.sql, productId, true);
  return lockWitness(tx, "product", productId, {
    productId,
    archivedAt: nullableIso(row.archived_at),
  });
}
export async function readConsumerParent(
  tx: ConsumerTx,
  ref: InternalParentVersionRef,
) {
  assertConsumerTx(tx);
  const row = await versionById(tx.sql, ref.productId, ref.versionId);
  if (!row) throw new ConsumerError("NOT_FOUND");
  const parent = await versionDetail(row);
  if (parent.version.snapshotSha256 !== ref.snapshotSha256)
    throw new ConsumerError("SOURCE_OBSOLETE");
  return parent;
}
export async function assertConsumerParentSource(
  tx: ConsumerTx,
  parent: InternalVersionDetail,
  requireHead: boolean,
): Promise<void> {
  assertConsumerTx(tx);
  const p = parent.snapshot,
    t = p.target;
  const row = await revisionMetadata(
    tx.sql,
    p.productId,
    t.draftId,
    t.revision,
  );
  if (
    !row ||
    row.canonical_content_sha256 !== t.canonicalContentSha256 ||
    row.asset_set_sha256 !== t.assetSetSha256 ||
    row.canonical_manifest_sha256 !== t.canonicalManifestSha256 ||
    row.source_import_id !== p.validation.sourceImportId ||
    row.source_validation_id !== p.validation.sourceValidationId ||
    row.source_validation_state_revision !==
      p.validation.sourceValidationStateRevision ||
    row.candidate_sha256 !== p.validation.candidateSha256
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  if (requireHead) {
    const root = await draftRoot(tx.sql, p.productId);
    if (!root || root.id !== t.draftId || root.current_revision !== t.revision)
      throw new ConsumerError("SOURCE_OBSOLETE");
  }
}
async function detail(row: PlayRow): Promise<InternalPlayDetail> {
  if (
    Buffer.byteLength(row.binding_text) > L.playRequestBytes ||
    Buffer.byteLength(row.snapshot_text) > L.playSnapshotBytes
  )
    throw new ConsumerError("UNAVAILABLE");
  const binding: unknown = JSON.parse(row.binding_text),
    snapshot: unknown = JSON.parse(row.snapshot_text);
  if (
    internalPlayBindingText(binding) !== row.binding_text ||
    internalPlaySnapshotText(snapshot) !== row.snapshot_text
  )
    throw new ConsumerError("UNAVAILABLE");
  const value = await verifyInternalPlayDetail({
    play: {
      schemaVersion: "quizforge.internal-play-receipt.v1",
      id: row.id,
      slot: row.slot,
      binding,
      bindingSha256: row.binding_sha256,
      snapshotSha256: row.snapshot_sha256,
      createdBy: row.created_by,
      createdAt: iso(row.created_at),
      purpose: "internal-test",
      publicationApproved: false,
    },
    snapshot,
  });
  if (
    value.play.binding.parent.productId !== row.product_id ||
    value.play.binding.parent.versionId !== row.parent_version_id ||
    value.play.binding.parent.snapshotSha256 !== row.parent_snapshot_sha256 ||
    value.play.binding.operationKey !== row.operation_key
  )
    throw new ConsumerError("UNAVAILABLE");
  return value;
}
export async function findInternalPlayOperation(
  tx: ConsumerTx,
  productId: string,
  operationKey: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    PlayRow[]
  >`SELECT * FROM qf.internal_play_version WHERE product_id=${productId} AND operation_key=${operationKey}`;
  return row ? await detail(row) : null;
}
export async function readInternalPlayById(
  tx: ConsumerTx,
  productId: string,
  id: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    PlayRow[]
  >`SELECT * FROM qf.internal_play_version WHERE product_id=${productId} AND id=${id}`;
  return row ? await detail(row) : null;
}
export async function readFixedInternalPlay(
  tx: ConsumerTx,
  ref: InternalPlayRef,
) {
  const value = await readInternalPlayById(
    tx,
    ref.productId,
    ref.playVersionId,
  );
  if (!value) throw new ConsumerError("NOT_FOUND");
  if (value.play.snapshotSha256 !== ref.playSnapshotSha256)
    throw new ConsumerError("SOURCE_OBSOLETE");
  return value;
}
export async function listInternalPlayFacts(tx: ConsumerTx, productId: string) {
  assertConsumerTx(tx);
  const rows = await tx.sql<
    PlayRow[]
  >`SELECT * FROM qf.internal_play_version WHERE product_id=${productId} ORDER BY slot DESC LIMIT 101`;
  if (rows.length > L.playVersionsPerProduct)
    throw new ConsumerError("UNAVAILABLE");
  return Promise.all(rows.map(async (row) => (await detail(row)).play));
}
export async function insertInternalPlay(
  tx: ConsumerTx,
  product: LockedConsumerProduct,
  binding: CreateInternalPlayBinding,
  snapshot: InternalPlaySnapshot,
  actorId: string,
) {
  assertLockWitness(tx, product, "product", binding.parent.productId);
  const slots = await tx.sql<
    { slot: number }[]
  >`SELECT slot FROM qf.internal_play_version WHERE product_id=${product.productId} ORDER BY slot DESC LIMIT 101`;
  if (slots.length > L.playVersionsPerProduct)
    throw new ConsumerError("UNAVAILABLE");
  const slot = (slots[0]?.slot ?? 0) + 1;
  if (slot > L.playVersionsPerProduct) throw new ConsumerError("PLAY_LIMIT");
  const bindingText = internalPlayBindingText(binding),
    snapshotText = internalPlaySnapshotText(snapshot);
  const bindingSha = await internalPlayBindingSha256(binding),
    snapshotSha = await internalPlaySnapshotSha256(snapshot);
  const [row] = await tx.sql<
    PlayRow[]
  >`INSERT INTO qf.internal_play_version(id,product_id,slot,parent_version_id,parent_snapshot_sha256,operation_key,binding_text,binding_sha256,snapshot_text,snapshot_sha256,created_by,created_at) VALUES(${randomUUID()},${product.productId},${slot},${binding.parent.versionId},${binding.parent.snapshotSha256},${binding.operationKey},${bindingText},${bindingSha},${snapshotText},${snapshotSha},${actorId},date_trunc('milliseconds',clock_timestamp())) RETURNING *`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return detail(row);
}
