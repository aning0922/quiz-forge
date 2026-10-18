import "server-only";
import type postgres from "postgres";
import { StudioUnavailableError } from "./runtime";
import { CONSUMER_CATALOG_QUERY } from "./consumer-catalog";
import { consumerSchemaFacts } from "./consumer-schema-facts";
import { assertConsumerNamespace } from "./consumer-namespace";

/** Exact PG18 definitions and effective grants; absence/weakening never gets repaired by app open. */
export async function verifyConsumerSchema(sql: postgres.Sql): Promise<void> {
  await assertConsumerNamespace(sql);
  const [catalog] = await sql.unsafe<{ sha256: string }[]>(
    CONSUMER_CATALOG_QUERY,
  );
  if (catalog?.sha256 !== consumerSchemaFacts.sha256)
    throw new StudioUnavailableError();
  const [budget] = await sql<
    { count: number }[]
  >`SELECT count(*)::integer AS count FROM qf.consumer_exchange_budget WHERE singleton IS TRUE`;
  if (budget?.count !== 1) throw new StudioUnavailableError();
}
