import "server-only";
import type postgres from "postgres";
import type { P2aDatabase } from "@/lib/db/client";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  hasPrivateTestUse,
  registeredPrivateTestSource,
  privateTestMarkerMatches,
  PRIVATE_TEST_REGISTRATIONS,
  type PrivateTestRegistration,
} from "./content/private-test";

type Facts = Parameters<typeof registeredPrivateTestSource>[0];
const issued = new WeakMap<object, PrivateTestRegistration>();
export type PrivateTestCapability = Readonly<{
  readonly privateTestCapability: unique symbol;
}>;
export async function assertPrivateTestDatabase(
  sql: postgres.Sql | postgres.TransactionSql,
  expected?: PrivateTestRegistration,
) {
  const [row] = await sql<
    { database: string; marker: string }[]
  >`SELECT current_database() AS database,shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`;
  if (
    !PRIVATE_TEST_REGISTRATIONS.some(
      (r) =>
        (!expected || r.instanceId === expected.instanceId) &&
        row?.database === `qf_db_${r.instanceId}` &&
        row.marker === `quizforge.p2a.v1:${r.instanceId}:test`,
    )
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
}
export async function issuePrivateTestCapability(
  db: P2aDatabase,
): Promise<PrivateTestCapability> {
  const r = PRIVATE_TEST_REGISTRATIONS.find(
    (r) =>
      db.config.purpose === "test" &&
      db.config.instanceId === r.instanceId &&
      db.config.origin === r.origin,
  );
  if (!r) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  await assertPrivateTestDatabase(db.sql, r);
  const capability = Object.freeze({}) as PrivateTestCapability;
  issued.set(capability, r);
  return capability;
}
export function requirePrivateTestCapability(
  value: PrivateTestCapability | undefined,
) {
  const r = value && issued.get(value);
  if (!r) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  return r;
}
export async function assertPrivateTestSource(
  sql: postgres.Sql | postgres.TransactionSql,
  content: unknown,
  facts: Facts,
) {
  if (!hasPrivateTestUse(content)) return;
  const r = registeredPrivateTestSource(facts),
    marker = (content as { bindings: { privateTestUse: unknown } }).bindings
      .privateTestUse;
  if (!r || !privateTestMarkerMatches(marker, r))
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  await assertPrivateTestDatabase(sql, r);
}
