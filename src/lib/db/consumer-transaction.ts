import "server-only";
import type postgres from "postgres";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";

export type ConsumerTx = Readonly<{
  sql: postgres.TransactionSql;
  checkpoint(): void;
}>;
type TxRecord = {
  active: boolean;
  sql: postgres.TransactionSql;
  locks: WeakMap<object, { kind: string; id: string }>;
};
const transactions = new WeakMap<ConsumerTx, TxRecord>();
export function assertConsumerTx(tx: ConsumerTx): void {
  const actual = transactions.get(tx);
  if (!actual?.active || actual.sql !== tx.sql)
    throw new ConsumerError("UNAVAILABLE");
  tx.checkpoint();
}
/** Repositories issue witnesses only AFTER their actual FOR UPDATE query returns. */
export function lockWitness<T extends object>(
  tx: ConsumerTx,
  kind: string,
  id: string,
  value: T,
): Readonly<T> {
  assertConsumerTx(tx);
  const frozen = Object.freeze(value);
  transactions.get(tx)!.locks.set(frozen, { kind, id });
  return frozen;
}
export function assertLockWitness(
  tx: ConsumerTx,
  witness: object,
  kind: string,
  id: string,
): void {
  assertConsumerTx(tx);
  const fact = transactions.get(tx)!.locks.get(witness);
  if (fact?.kind !== kind || fact.id !== id)
    throw new ConsumerError("UNAVAILABLE");
}
export async function runInConsumerTransaction<T>(
  sql: postgres.TransactionSql,
  checkpoint: () => void,
  work: (tx: ConsumerTx) => Promise<T>,
): Promise<T> {
  const tx = Object.freeze({ sql, checkpoint }),
    record: TxRecord = { active: true, sql, locks: new WeakMap() };
  transactions.set(tx, record);
  try {
    checkpoint();
    return await work(tx);
  } finally {
    record.active = false;
  }
}
