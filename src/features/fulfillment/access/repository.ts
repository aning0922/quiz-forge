import "server-only";
import {
  assertConsumerTx,
  lockWitness,
  assertLockWitness,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import type { ConsumerState } from "@/lib/consumer-contract/v1/state";
import type { DatabaseTime } from "@/lib/auth/internal";
import { iso, nullableIso } from "@/features/product/workspace/repository";
import type { LockedConsumerProduct } from "@/features/product/internal-play/repository";
import {
  issueAccessKeyBindingText,
  issueAccessKeyBindingSha256,
  voidUnusedAccessKeyBindingText,
  voidUnusedAccessKeyBindingSha256,
  verifyIssueAccessKeyReceipt,
  verifyVoidUnusedAccessKeyReceipt,
  type IssueAccessKeyBinding,
  type IssueAccessKeyReceipt,
  type VoidUnusedAccessKeyBinding,
  type VoidUnusedAccessKeyReceipt,
  type AccessKeyCursor,
} from "./contracts";
type KeyRow = {
  id: string;
  product_id: string;
  play_version_id: string;
  play_snapshot_sha256: string;
  credential_digest: string;
  issue_operation_key: string;
  issue_binding_text: string;
  issue_binding_sha256: string;
  valid_for_seconds: number;
  issued_by: string;
  issued_at: DatabaseTime;
  expires_at: DatabaseTime;
  revoked_at: DatabaseTime | null;
  void_operation_key: string | null;
  void_binding_text: string | null;
  void_binding_sha256: string | null;
  voided_by: string | null;
};
export type AccessKeyFact = Readonly<{
  issue: IssueAccessKeyReceipt;
  voidReceipt: VoidUnusedAccessKeyReceipt | null;
}>;
export type LockedAccessKey = AccessKeyFact;
export type GrantFact = Readonly<{
  keyId: string;
  sessionId: string;
  slot: number;
  grantId: string;
  credentialDigest: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}>;
export type GrantLocator = Pick<
  GrantFact,
  "keyId" | "sessionId" | "grantId" | "credentialDigest"
>;
type GrantRow = {
  key_id: string;
  session_id: string;
  slot: number;
  grant_id: string;
  credential_digest: string;
  issued_at: DatabaseTime;
  expires_at: DatabaseTime;
  revoked_at: DatabaseTime | null;
};
async function fact(row: KeyRow): Promise<AccessKeyFact> {
  if (
    Buffer.byteLength(row.issue_binding_text) > L.operationRequestBytes ||
    (row.void_binding_text !== null &&
      Buffer.byteLength(row.void_binding_text) > L.operationRequestBytes)
  )
    throw new ConsumerError("UNAVAILABLE");
  const binding: IssueAccessKeyBinding = JSON.parse(row.issue_binding_text);
  if (
    issueAccessKeyBindingText(binding) !== row.issue_binding_text ||
    binding.keyId !== row.id ||
    binding.play.productId !== row.product_id ||
    binding.play.playVersionId !== row.play_version_id ||
    binding.play.playSnapshotSha256 !== row.play_snapshot_sha256 ||
    binding.operationKey !== row.issue_operation_key ||
    binding.credentialDigest !== row.credential_digest ||
    binding.validForSeconds !== row.valid_for_seconds
  )
    throw new ConsumerError("UNAVAILABLE");
  const issue = await verifyIssueAccessKeyReceipt({
    schemaVersion: "quizforge.access-key-issue-receipt.v1",
    binding,
    bindingSha256: row.issue_binding_sha256,
    issuedBy: row.issued_by,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
  });
  let voidReceipt: VoidUnusedAccessKeyReceipt | null = null;
  if (row.void_binding_text !== null) {
    const voidBinding: VoidUnusedAccessKeyBinding = JSON.parse(
      row.void_binding_text,
    );
    if (
      !row.revoked_at ||
      !row.voided_by ||
      voidUnusedAccessKeyBindingText(voidBinding) !== row.void_binding_text ||
      voidBinding.productId !== row.product_id ||
      voidBinding.keyId !== row.id ||
      voidBinding.issueBindingSha256 !== row.issue_binding_sha256 ||
      voidBinding.operationKey !== row.void_operation_key
    )
      throw new ConsumerError("UNAVAILABLE");
    voidReceipt = await verifyVoidUnusedAccessKeyReceipt({
      schemaVersion: "quizforge.access-key-void-unused-receipt.v1",
      binding: voidBinding,
      bindingSha256: row.void_binding_sha256,
      voidedBy: row.voided_by,
      revokedAt: iso(row.revoked_at),
    });
  } else if (
    [
      row.revoked_at,
      row.voided_by,
      row.void_operation_key,
      row.void_binding_sha256,
    ].some((v) => v !== null)
  )
    throw new ConsumerError("UNAVAILABLE");
  return Object.freeze({ issue, voidReceipt });
}
export async function findKeyIssueOperation(
  tx: ConsumerTx,
  productId: string,
  operationKey: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    KeyRow[]
  >`SELECT * FROM qf.access_key WHERE product_id=${productId} AND issue_operation_key=${operationKey}`;
  return row ? fact(row) : null;
}
export async function findKeyVoidOperation(
  tx: ConsumerTx,
  productId: string,
  operationKey: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    KeyRow[]
  >`SELECT * FROM qf.access_key WHERE product_id=${productId} AND void_operation_key=${operationKey}`;
  return row ? fact(row) : null;
}
export async function readKeyFact(
  tx: ConsumerTx,
  productId: string,
  keyId: string,
) {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    KeyRow[]
  >`SELECT * FROM qf.access_key WHERE product_id=${productId} AND id=${keyId}`;
  return row ? fact(row) : null;
}
export async function lockAccessKey(
  tx: ConsumerTx,
  selector: { keyId: string } | { credentialDigest: string },
): Promise<LockedAccessKey | null> {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    KeyRow[]
  >`SELECT * FROM qf.access_key WHERE ${"keyId" in selector ? tx.sql`id=${selector.keyId}` : tx.sql`credential_digest=${selector.credentialDigest}`} FOR UPDATE`;
  return row ? lockWitness(tx, "key", row.id, await fact(row)) : null;
}
export async function listKeyIssueFacts(
  tx: ConsumerTx,
  productId: string,
  cursor: AccessKeyCursor | null,
) {
  assertConsumerTx(tx);
  const rows = await tx.sql<
    KeyRow[]
  >`SELECT * FROM qf.access_key WHERE product_id=${productId} ${cursor ? tx.sql`AND (issued_at,id)<(${cursor.issuedAt}::timestamptz,${cursor.keyId}::uuid)` : tx.sql``} ORDER BY issued_at DESC,id DESC LIMIT 51`;
  const keys = await Promise.all(rows.slice(0, L.keysPerPage).map(fact)),
    last = keys.at(-1)?.issue;
  return {
    keys,
    nextCursor:
      rows.length > L.keysPerPage && last
        ? { productId, issuedAt: last.issuedAt, keyId: last.binding.keyId }
        : null,
  };
}
export async function insertAccessKey(
  tx: ConsumerTx,
  product: LockedConsumerProduct,
  binding: IssueAccessKeyBinding,
  issuerId: string,
) {
  assertLockWitness(tx, product, "product", binding.play.productId);
  const body = issueAccessKeyBindingText(binding),
    sha = await issueAccessKeyBindingSha256(binding);
  const [row] = await tx.sql<
    KeyRow[]
  >`INSERT INTO qf.access_key(id,product_id,play_version_id,play_snapshot_sha256,credential_digest,issue_operation_key,issue_binding_text,issue_binding_sha256,valid_for_seconds,issued_by,issued_at,expires_at) VALUES(${binding.keyId},${binding.play.productId},${binding.play.playVersionId},${binding.play.playSnapshotSha256},${binding.credentialDigest},${binding.operationKey},${body},${sha},${binding.validForSeconds},${issuerId},date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',clock_timestamp())) RETURNING *`;
  if (!row) throw new ConsumerError("UNAVAILABLE");
  return fact(row);
}
/** App coordinator checks permanent claim/report through their explicit ports BEFORE this call. */
export async function voidUnusedKey(
  tx: ConsumerTx,
  key: LockedAccessKey,
  binding: VoidUnusedAccessKeyBinding,
  actorId: string,
) {
  assertLockWitness(tx, key, "key", binding.keyId);
  if (
    key.issue.binding.play.productId !== binding.productId ||
    key.issue.bindingSha256 !== binding.issueBindingSha256
  )
    throw new ConsumerError("OPERATION_CONFLICT");
  const body = voidUnusedAccessKeyBindingText(binding),
    sha = await voidUnusedAccessKeyBindingSha256(binding);
  const [row] = await tx.sql<
    KeyRow[]
  >`UPDATE qf.access_key SET revoked_at=date_trunc('milliseconds',clock_timestamp()),void_operation_key=${binding.operationKey},void_binding_text=${body},void_binding_sha256=${sha},voided_by=${actorId} WHERE id=${binding.keyId} AND revoked_at IS NULL RETURNING *`;
  if (!row) throw new ConsumerError("OPERATION_CONFLICT");
  return fact(row);
}
function grantFact(row: GrantRow): GrantFact {
  return Object.freeze({
    keyId: row.key_id,
    sessionId: row.session_id,
    slot: row.slot,
    grantId: row.grant_id,
    credentialDigest: row.credential_digest,
    issuedAt: iso(row.issued_at),
    expiresAt: iso(row.expires_at),
    revokedAt: nullableIso(row.revoked_at),
  });
}
export async function locateGrant(
  tx: ConsumerTx,
  digest: string,
): Promise<GrantLocator | null> {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    GrantRow[]
  >`SELECT * FROM qf.consumer_grant WHERE credential_digest=${digest}`;
  if (!row) return null;
  const g = grantFact(row);
  return {
    keyId: g.keyId,
    sessionId: g.sessionId,
    grantId: g.grantId,
    credentialDigest: g.credentialDigest,
  };
}
export async function readFreshGrant(
  tx: ConsumerTx,
  locator: GrantLocator,
): Promise<GrantFact | null> {
  assertConsumerTx(tx);
  const [row] = await tx.sql<
    GrantRow[]
  >`SELECT * FROM qf.consumer_grant WHERE key_id=${locator.keyId} AND session_id=${locator.sessionId} AND grant_id=${locator.grantId} AND credential_digest=${locator.credentialDigest} AND revoked_at IS NULL AND expires_at>clock_timestamp()`;
  return row ? grantFact(row) : null;
}
export async function readCurrentGrants(tx: ConsumerTx, key: LockedAccessKey) {
  assertLockWitness(tx, key, "key", key.issue.binding.keyId);
  const rows = await tx.sql<
    GrantRow[]
  >`SELECT * FROM qf.consumer_grant WHERE key_id=${key.issue.binding.keyId} ORDER BY slot LIMIT 17`;
  if (rows.length > L.currentGrantsPerKey)
    throw new ConsumerError("UNAVAILABLE");
  return rows.map(grantFact);
}
export async function verifyLockedGrant(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: Readonly<{ state: ConsumerState }>,
  locator: GrantLocator,
) {
  assertLockWitness(tx, key, "key", locator.keyId);
  assertLockWitness(tx, session, "session", locator.sessionId);
  if (session.state.session.keyId !== locator.keyId)
    throw new ConsumerError("ACCESS_DENIED");
  const grant = await readFreshGrant(tx, locator);
  if (!grant) throw new ConsumerError("ACCESS_DENIED");
  return lockWitness(tx, "grant", grant.grantId, grant);
}
export async function rotateConsumerGrant(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: Readonly<{ state: ConsumerState }>,
  fresh: { grantId: string; credentialDigest: string },
  at: string,
) {
  assertLockWitness(tx, key, "key", key.issue.binding.keyId);
  assertLockWitness(tx, session, "session", session.state.session.sessionId);
  if (session.state.session.keyId !== key.issue.binding.keyId)
    throw new ConsumerError("ACCESS_DENIED");
  const grants = await readCurrentGrants(tx, key);
  const expired = grants.find((g) => g.revokedAt !== null || g.expiresAt <= at),
    unused = Array.from(
      { length: L.currentGrantsPerKey },
      (_, i) => i + 1,
    ).find((slot) => !grants.some((g) => g.slot === slot));
  const oldest = [...grants].sort((a, b) =>
    a.issuedAt < b.issuedAt
      ? -1
      : a.issuedAt > b.issuedAt
        ? 1
        : a.slot - b.slot,
  )[0];
  const slot = expired?.slot ?? unused ?? oldest?.slot;
  if (!slot) throw new ConsumerError("UNAVAILABLE");
  const current = grants.find((g) => g.slot === slot),
    keyId = key.issue.binding.keyId;
  const rows = current
    ? await tx.sql<
        GrantRow[]
      >`UPDATE qf.consumer_grant SET grant_id=${fresh.grantId},credential_digest=${fresh.credentialDigest},issued_at=${at}::timestamptz,expires_at=${at}::timestamptz+interval '8 hours',revoked_at=NULL WHERE key_id=${keyId} AND slot=${slot} RETURNING *`
    : await tx.sql<
        GrantRow[]
      >`INSERT INTO qf.consumer_grant(key_id,slot,session_id,grant_id,credential_digest,issued_at,expires_at) VALUES(${keyId},${slot},${session.state.session.sessionId},${fresh.grantId},${fresh.credentialDigest},${at}::timestamptz,${at}::timestamptz+interval '8 hours') RETURNING *`;
  if (!rows[0]) throw new ConsumerError("UNAVAILABLE");
  return grantFact(rows[0]);
}
export async function revokeExactGrant(
  tx: ConsumerTx,
  key: LockedAccessKey,
  session: Readonly<{ state: ConsumerState }>,
  grant: GrantFact,
  at: string,
): Promise<void> {
  assertLockWitness(tx, key, "key", grant.keyId);
  assertLockWitness(tx, session, "session", grant.sessionId);
  assertLockWitness(tx, grant, "grant", grant.grantId);
  const rows =
    await tx.sql`UPDATE qf.consumer_grant SET revoked_at=${at}::timestamptz WHERE key_id=${grant.keyId} AND slot=${grant.slot} AND session_id=${grant.sessionId} AND grant_id=${grant.grantId} AND credential_digest=${grant.credentialDigest} AND revoked_at IS NULL AND expires_at>clock_timestamp() RETURNING grant_id`;
  if (rows.length !== 1) throw new ConsumerError("ACCESS_DENIED");
}

/** Independent short transaction only. No Key lookup or domain lock may precede this reservation. */
export async function reserveConsumerExchange(tx: ConsumerTx): Promise<void> {
  assertConsumerTx(tx);
  let rows;
  try {
    rows = await tx.sql<
      { singleton: boolean }[]
    >`SELECT singleton FROM qf.consumer_exchange_budget WHERE singleton IS TRUE FOR UPDATE NOWAIT`;
  } catch (error) {
    if ((error as { code?: string })?.code === "55P03")
      throw new ConsumerError("RATE_LIMITED");
    throw error;
  }
  if (rows.length !== 1 || rows[0]?.singleton !== true)
    throw new ConsumerError("UNAVAILABLE");
  const changed =
    await tx.sql`WITH moment AS MATERIALIZED (SELECT floor(extract(epoch FROM clock_timestamp())/60)::bigint AS bucket)
    UPDATE qf.consumer_exchange_budget b SET window_index=m.bucket,used=CASE WHEN b.window_index=m.bucket THEN b.used+1 ELSE 1 END FROM moment m
    WHERE b.singleton IS TRUE AND b.window_index<=m.bucket AND (b.window_index<m.bucket OR b.used<60) RETURNING b.singleton`;
  if (changed.length !== 1) throw new ConsumerError("RATE_LIMITED");
}
