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
  lockAccessKey,
  verifyLockedGrant,
  type GrantLocator,
  type AccessKeyFact,
} from "../access/repository";
import {
  readConsumerSession,
  lockConsumerSession,
} from "../consumer-session/repository";
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
    p.playVersionId !== session.playVersionId ||
    p.playSnapshotSha256 !== session.playSnapshotSha256 ||
    key.voidReceipt
  )
    throw new ConsumerError("ACCESS_DENIED");
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
    state = await readConsumerSession(tx, locator.keyId);
  if (!grant || !state || state.session.sessionId !== sessionId)
    throw new ConsumerError("ACCESS_DENIED");
  const key = await readKeyFact(tx, state.session.productId, locator.keyId);
  if (!key) throw new ConsumerError("ACCESS_DENIED");
  matchesKey(key, state.session);
  return { locator, grant, state, key, at: await consumerDatabaseMoment(tx) };
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
  const key = await lockAccessKey(tx, { keyId: locator.keyId });
  if (!key) throw new ConsumerError("ACCESS_DENIED");
  const session = await lockConsumerSession(tx, key, sessionId);
  if (!session) throw new ConsumerError("ACCESS_DENIED");
  matchesKey(key, session.state.session);
  const grant = await verifyLockedGrant(tx, key, session, locator);
  return {
    locator,
    key,
    session,
    grant,
    state: session.state,
    at: await consumerDatabaseMoment(tx),
  };
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
