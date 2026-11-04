import { lockPolicyAuthority } from "../consumer-session/policy-repository";
import {
  decodeAccessKeyRow,
  decodeGrantRow,
  type KeyRow,
  type GrantRow,
} from "../access/repository";
import {
  decodeConsumerSessionRow,
  type SessionRow,
} from "../consumer-session/repository";
import { lockWitness } from "@/lib/db/consumer-transaction";
import "server-only";
import {
  digestConsumerToken,
  verifyConsumerCsrf,
} from "@/lib/consumer-contract/v1/credentials";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  consumerUuidSchema,
  type ConsumerSessionRef,
} from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import { runInConsumerTransaction } from "@/lib/db/consumer-transaction";
import type { P2aDatabase } from "@/lib/db/client";
import {
  locateGrant,
  readFreshGrant,
  readKeyFact,
  type GrantLocator,
  type AccessKeyFact,
} from "../access/repository";
import { readConsumerSession } from "../consumer-session/repository";
import type {
  ConsumerReadCredentials,
  ConsumerWriteCredentials,
} from "./service-contract";
import {
  consumerRead,
  consumerReferenceShare,
  consumerDatabaseMoment,
} from "./transaction";

export async function consumerCredentialDigest(
  credentials: ConsumerReadCredentials,
) {
  const digest = await digestConsumerToken(credentials?.grantToken, "grant");
  if (!digest) throw new ConsumerError("ACCESS_DENIED");
  return digest;
}
export async function assertConsumerWriteCredentials(
  credentials: ConsumerWriteCredentials,
) {
  const digest = await consumerCredentialDigest(credentials);
  if (!consumerUuidSchema.safeParse(credentials.requestId).success)
    throw new ConsumerError("INVALID_REQUEST");
  if (
    !(await verifyConsumerCsrf(credentials.grantToken, credentials.csrfToken))
  )
    throw new ConsumerError("CSRF_REJECTED");
  return digest;
}
function matchesKey(key: AccessKeyFact, session: ConsumerSessionRef) {
  const p = key.issue.binding.play;
  if (
    key.issue.binding.keyId !== session.keyId ||
    p.productId !== session.productId ||
    key.voidReceipt
  )
    throw new ConsumerError("ACCESS_DENIED");
}
export async function readConsumerAttemptPolicy(
  tx: ConsumerTx,
  session: ConsumerSessionRef,
) {
  const [row] = await tx.sql<
    {
      attempt_generation: number;
      current_generation: number | null;
      current: boolean;
    }[]
  >`
    SELECT s.activation_generation attempt_generation,h.generation current_generation,
      coalesce((s.activation_generation,s.play_version_id,s.play_snapshot_sha256)=(h.generation,h.play_version_id,h.play_snapshot_sha256),false) current
    FROM qf.consumer_session s LEFT JOIN qf.consumer_product_head h ON h.product_id=s.product_id
    WHERE (s.id,s.key_id,s.product_id,s.play_version_id,s.play_snapshot_sha256)=(${session.sessionId}::uuid,${session.keyId}::uuid,${session.productId},${session.playVersionId}::uuid,${session.playSnapshotSha256})`;
  if (!row) throw new ConsumerError("ACCESS_DENIED");
  return row;
}
export function assertCurrentConsumerAttempt(
  policy: Awaited<ReturnType<typeof readConsumerAttemptPolicy>>,
) {
  if (policy.current_generation === null)
    throw new ConsumerError("NO_ENABLED_PLAY");
  if (!policy.current) throw new ConsumerError("VERSION_SUPERSEDED");
}
/** Digest lookup is only a selector. Fresh exact grant + permanent session + complete Key binding authorize. */
export async function readConsumerAuthority(
  tx: ConsumerTx,
  digest: string,
  sessionId: string,
) {
  const locator = await locateGrant(tx, digest);
  if (!locator || locator.sessionId !== sessionId)
    throw new ConsumerError("ACCESS_DENIED");
  const grant = await readFreshGrant(tx, locator),
    state = await readConsumerSession(tx, locator.keyId, sessionId);
  if (!grant || !state || state.session.sessionId !== sessionId)
    throw new ConsumerError("ACCESS_DENIED");
  const key = await readKeyFact(tx, state.session.productId, locator.keyId);
  if (!key) throw new ConsumerError("ACCESS_DENIED");
  const [lineage] = await tx.sql<
    { valid: boolean }[]
  >`SELECT (s.key_bound_play_version_id=k.play_version_id AND s.key_bound_play_snapshot_sha256=k.play_snapshot_sha256 AND s.product_id=k.product_id AND s.play_version_id=${state.session.playVersionId}::uuid AND s.play_snapshot_sha256=${state.session.playSnapshotSha256}) valid FROM qf.consumer_session s JOIN qf.access_key k ON k.id=s.key_id WHERE s.id=${sessionId} AND s.key_id=${locator.keyId}`;
  if (lineage?.valid !== true) throw new ConsumerError("ACCESS_DENIED");
  matchesKey(key, state.session);
  return {
    locator,
    grant,
    state,
    key,
    policy: await readConsumerAttemptPolicy(tx, state.session),
    at: await consumerDatabaseMoment(tx),
  };
}
export type ConsumerAuthority = Awaited<
  ReturnType<typeof readConsumerAuthority>
>;
/** New READ COMMITTED observation after any RR snapshot has ended, including immediately before body handoff. */
export async function reauthorizeConsumer(
  db: P2aDatabase,
  check: () => void,
  locator: GrantLocator,
  session: ConsumerSessionRef,
  requireContent = false,
) {
  if (
    locator.keyId !== session.keyId ||
    locator.sessionId !== session.sessionId
  )
    throw new ConsumerError("ACCESS_DENIED");
  await db.sql.begin(
    "isolation level read committed read only",
    async (sql) => {
      await sql`SET LOCAL statement_timeout='5s'`;
      await sql`SET LOCAL transaction_timeout='10s'`;
      await runInConsumerTransaction(sql, check, async (tx) => {
        if (!(await readFreshGrant(tx, locator)))
          throw new ConsumerError("ACCESS_DENIED");
        if (requireContent) {
          const a = await readConsumerAuthority(
            tx,
            locator.credentialDigest,
            session.sessionId,
          );
          await assertConsumerContentAuthority(tx, a);
        }
      });
    },
  );
  check();
}
export async function authorizedConsumerRead<T>(
  db: P2aDatabase,
  check: () => void,
  digest: string,
  sessionId: string,
  work: (
    tx: ConsumerTx,
    authority: Awaited<ReturnType<typeof readConsumerAuthority>>,
  ) => Promise<T>,
) {
  const result = await consumerRead(db, check, async (tx) => {
    const authority = await readConsumerAuthority(tx, digest, sessionId);
    return { authority, value: await work(tx, authority) };
  });
  await reauthorizeConsumer(
    db,
    check,
    result.authority.locator,
    result.authority.state.session,
  );
  return result;
}
/** Shared maintenance fence -> Key -> Session; verify grant only AFTER the actual row locks. */
export async function lockConsumerAuthority(
  tx: ConsumerTx,
  digest: string,
  sessionId: string,
) {
  await consumerReferenceShare(tx);
  const locator = await locateGrant(tx, digest);
  if (!locator || locator.sessionId !== sessionId)
    throw new ConsumerError("ACCESS_DENIED");
  const [scope] = await tx.sql<
    { product_id: string }[]
  >`SELECT product_id FROM qf.consumer_session WHERE id=${sessionId} AND key_id=${locator.keyId}`;
  if (!scope) throw new ConsumerError("ACCESS_DENIED");
  const rows = await lockPolicyAuthority(tx, {
    productId: scope.product_id,
    keyId: locator.keyId,
    sessionId,
    grantId: locator.grantId,
    credentialDigest: locator.credentialDigest,
  });
  const key = lockWitness(
    tx,
    "key",
    locator.keyId,
    await decodeAccessKeyRow(rows.key as KeyRow),
  );
  const session = lockWitness(tx, "session", sessionId, {
    state: await decodeConsumerSessionRow(tx, rows.session as SessionRow),
  });
  const grant = lockWitness(
    tx,
    "grant",
    locator.grantId,
    decodeGrantRow(rows.grant as GrantRow),
  );
  matchesKey(key, session.state.session);
  return {
    locator,
    key,
    session,
    grant,
    state: session.state,
    policy: await readConsumerAttemptPolicy(tx, session.state.session),
    at: await consumerDatabaseMoment(tx),
  };
}
/** Historical report resources belong only to the report's original attempt. */
export async function assertConsumerContentAuthority(
  tx: ConsumerTx,
  a: ConsumerAuthority,
) {
  const [report] = await tx.sql<
    { session_id: string }[]
  >`SELECT session_id FROM qf.quiz_report WHERE key_id=${a.state.session.keyId}`;
  if (report) {
    if (report.session_id !== a.state.session.sessionId)
      throw new ConsumerError("ACCESS_DENIED");
  } else {
    assertCurrentConsumerAttempt(a.policy);
    assertActiveConsumerKey(a.key, a.at);
  }
}
export function assertConsumerSessionBinding(
  actual: ConsumerSessionRef,
  expected: ConsumerSessionRef,
) {
  if (!sameConsumerFact(actual, expected, 4096))
    throw new ConsumerError("ACCESS_DENIED");
}
export function assertActiveConsumerKey(key: AccessKeyFact, at: string) {
  if (key.voidReceipt || key.issue.expiresAt <= at)
    throw new ConsumerError("KEY_NOT_ACTIVE");
}
