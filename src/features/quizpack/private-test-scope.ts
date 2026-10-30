import "server-only";
import type postgres from "postgres";
import type { P2aDatabase } from "@/lib/db/client";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  hasPrivateTestUse,
  privateTestSourceMatches,
  PRIVATE_TEST_REGISTRATION as R,
} from "./content/private-test";

type Facts = Parameters<typeof privateTestSourceMatches>[0];
const issued = new WeakSet<object>();
export type PrivateTestCapability = Readonly<{
  readonly privateTestCapability: unique symbol;
}>;
export async function assertPrivateTestDatabase(
  sql: postgres.Sql | postgres.TransactionSql,
) {
  const [row] = await sql<{ database: string; marker: string }[]>`
    SELECT current_database() AS database,
      shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database') AS marker`;
  if (
    row?.database !== `qf_db_${R.instanceId}` ||
    row.marker !== `quizforge.p2a.v1:${R.instanceId}:test`
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
}
export async function issuePrivateTestCapability(
  db: P2aDatabase,
): Promise<PrivateTestCapability> {
  if (
    db.config.purpose !== "test" ||
    db.config.instanceId !== R.instanceId ||
    db.config.origin !== R.origin
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  await assertPrivateTestDatabase(db.sql);
  const capability = Object.freeze({}) as PrivateTestCapability;
  issued.add(capability);
  return capability;
}
export function requirePrivateTestCapability(
  value: PrivateTestCapability | undefined,
) {
  if (!value || !issued.has(value))
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
}
export async function assertPrivateTestSource(
  sql: postgres.Sql | postgres.TransactionSql,
  content: unknown,
  facts: Facts,
) {
  if (!hasPrivateTestUse(content)) return;
  if (!privateTestSourceMatches(facts))
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  await assertPrivateTestDatabase(sql);
}
