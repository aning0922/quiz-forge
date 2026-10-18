import "server-only";
import type postgres from "postgres";
import type { z } from "zod";
import type { P2aDatabase } from "@/lib/db/client";
import { activeActor, toActor } from "@/lib/auth/internal";
import {
  requireCapability,
  type StudioActor,
  type StudioCapability,
} from "@/lib/auth/capabilities";
import {
  withStudioWrite,
  isStudioConnectionFailure,
  type StudioWriteCredentials,
} from "@/lib/auth/write";
import { digestToken, verifyCsrf } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type { ConsumerRequestOwner } from "./request-owner";

type ConsumerOperation = Parameters<ConsumerRequestOwner["run"]>[0];
type ConsumerOwnerContext = Parameters<
  Parameters<ConsumerRequestOwner["run"]>[1]
>[0];

import {
  runInConsumerTransaction,
  assertConsumerTx,
  type ConsumerTx,
} from "@/lib/db/consumer-transaction";
export type { ConsumerTx } from "@/lib/db/consumer-transaction";

export function parseConsumer<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ConsumerError("INVALID_REQUEST");
  return result.data;
}
/** Cheap check before admitting filesystem work; final transaction independently reauthenticates. */
export function assertOperatorWriteCredentials(
  credentials: StudioWriteCredentials,
): void {
  if (
    !credentials ||
    !credentials.sessionToken ||
    !digestToken(credentials.sessionToken, "session")
  )
    throw new ConsumerError("OPERATOR_REQUIRED");
  if (
    !credentials.csrfToken ||
    !verifyCsrf(credentials.sessionToken, "session", credentials.csrfToken)
  )
    throw new ConsumerError("CSRF_REJECTED");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      credentials.requestId,
    )
  )
    throw new ConsumerError("INVALID_REQUEST");
}
export function consumerServiceError(error: unknown): ConsumerError {
  if (error instanceof ConsumerError) return error;
  if (error instanceof StudioError) {
    switch (error.code) {
      case "WRITE_OUTCOME_UNKNOWN":
        return new ConsumerError("OUTCOME_UNKNOWN");
      case "CSRF_REJECTED":
        return new ConsumerError("CSRF_REJECTED");
      case "UNAUTHENTICATED":
      case "AUTHENTICATION_FAILED":
      case "CAPABILITY_DENIED":
        return new ConsumerError("OPERATOR_REQUIRED");
      case "INVALID_REQUEST":
        return new ConsumerError("INVALID_REQUEST");
      case "PRODUCT_ARCHIVED":
        return new ConsumerError("PRODUCT_ARCHIVED");
      case "PRODUCT_NOT_FOUND":
      case "DRAFT_NOT_FOUND":
      case "DRAFT_REVISION_NOT_FOUND":
      case "VERSION_NOT_FOUND":
        return new ConsumerError("NOT_FOUND");
      case "DRAFT_SOURCE_INVALID":
      case "DRAFT_SOURCE_CHANGED":
      case "PREVIEW_RESOURCE_UNAVAILABLE":
      case "VERSION_DEPENDENCY_UNAVAILABLE":
      case "VERSION_RESOURCE_UNAVAILABLE":
        return new ConsumerError("DEPENDENCY_UNAVAILABLE");
      case "PREVIEW_TIMEOUT":
      case "PREVIEW_CANCELLED":
      case "RECEIVE_TIMEOUT":
        return new ConsumerError("TIMEOUT");
      case "WRITE_BUSY":
      case "PREVIEW_BUSY":
        return new ConsumerError("BUSY");
    }
  }
  return new ConsumerError("UNAVAILABLE");
}
export type ConsumerWriteObservation = {
  kind: "not-started" | "pending" | "committed" | "rolled-back" | "unknown";
};
export async function consumerServiceCall<T>(
  owner: ConsumerRequestOwner,
  operation: ConsumerOperation,
  work: (
    context: ConsumerOwnerContext,
    observation: ConsumerWriteObservation,
  ) => Promise<T>,
): Promise<T> {
  const observation: ConsumerWriteObservation = { kind: "not-started" };
  try {
    return await owner.run(operation, (c) => work(c, observation));
  } catch (error) {
    if (["pending", "committed", "unknown"].includes(observation.kind))
      throw new ConsumerError("OUTCOME_UNKNOWN");
    throw consumerServiceError(error);
  }
}
/** Original withStudioWrite owns auth lock, before/after live authorization, COMMIT and failure classification. */
export async function operatorWrite<T>(
  db: P2aDatabase,
  credentials: StudioWriteCredentials,
  capability: StudioCapability,
  checkpoint: () => void,
  observation: ConsumerWriteObservation,
  work: (tx: ConsumerTx, actor: StudioActor) => Promise<T>,
): Promise<T> {
  checkpoint();
  observation.kind = "pending";
  let domainError: ConsumerError | undefined, sentinel: StudioError | undefined;
  try {
    const value = await withStudioWrite(
      db,
      credentials,
      capability,
      async (sql, actor) =>
        runInConsumerTransaction(sql, checkpoint, async (tx) => {
          try {
            const result = await work(tx, actor);
            checkpoint();
            return result;
          } catch (error) {
            const fault = (error && typeof error === "object" ? error : {}) as {
              code?: string;
            };
            if (error instanceof ConsumerError || fault.code === "23505") {
              domainError =
                error instanceof ConsumerError
                  ? error
                  : new ConsumerError("OPERATION_CONFLICT");
              sentinel = new StudioError("INVALID_REQUEST");
              throw sentinel;
            }
            throw error;
          }
        }),
    );
    observation.kind = "committed";
    return value;
  } catch (error) {
    if (error instanceof StudioError && error.code === "WRITE_OUTCOME_UNKNOWN")
      observation.kind = "unknown";
    else observation.kind = "rolled-back";
    if (sentinel && error === sentinel && domainError) throw domainError;
    throw consumerServiceError(error);
  }
}
/** Finite read snapshot, then an independent fresh authorization observation after RR has ended. */
export async function operatorRead<T>(
  db: P2aDatabase,
  token: string | null,
  checkpoint: () => void,
  work: (tx: ConsumerTx, actor: StudioActor) => Promise<T>,
  capability: StudioCapability = "studio:read",
): Promise<T> {
  const digest = token ? digestToken(token, "session") : null;
  if (!digest) throw new ConsumerError("OPERATOR_REQUIRED");
  const authorize = async (sql: postgres.TransactionSql) => {
    checkpoint();
    const row = await activeActor(sql, digest);
    if (!row) throw new ConsumerError("OPERATOR_REQUIRED");
    const actor = toActor(row);
    requireCapability(actor, capability);
    return actor;
  };
  const value = (await db.sql.begin(
    "isolation level repeatable read read only",
    async (sql) => {
      await sql`SET LOCAL statement_timeout='5s'`;
      await sql`SET LOCAL transaction_timeout='10s'`;
      const actor = await authorize(sql);
      return runInConsumerTransaction(sql, checkpoint, (tx) => work(tx, actor));
    },
  )) as T;
  await db.sql.begin(
    "isolation level read committed read only",
    async (sql) => {
      await sql`SET LOCAL statement_timeout='5s'`;
      await sql`SET LOCAL transaction_timeout='10s'`;
      await authorize(sql);
    },
  );
  checkpoint();
  return value;
}
export async function consumerRead<T>(
  db: P2aDatabase,
  checkpoint: () => void,
  work: (tx: ConsumerTx) => Promise<T>,
): Promise<T> {
  return (await db.sql.begin(
    "isolation level repeatable read read only",
    async (sql) => {
      await sql`SET LOCAL statement_timeout='5s'`;
      await sql`SET LOCAL transaction_timeout='10s'`;
      return runInConsumerTransaction(sql, checkpoint, work);
    },
  )) as T;
}
export async function consumerWrite<T>(
  db: P2aDatabase,
  checkpoint: () => void,
  observation: ConsumerWriteObservation,
  work: (tx: ConsumerTx) => Promise<T>,
): Promise<T> {
  checkpoint();
  observation.kind = "pending";
  let ready = false,
    callbackFailed = false,
    failure: unknown;
  try {
    const value = (await db.sql.begin(
      "isolation level read committed",
      async (sql) => {
        try {
          await sql`SET LOCAL lock_timeout='2s'`;
          await sql`SET LOCAL statement_timeout='5s'`;
          await sql`SET LOCAL transaction_timeout='10s'`;
          const result = await runInConsumerTransaction(sql, checkpoint, work);
          checkpoint();
          ready = true;
          return result;
        } catch (error) {
          callbackFailed = true;
          failure = error;
          throw error;
        }
      },
    )) as T;
    observation.kind = "committed";
    return value;
  } catch (error) {
    if (
      isStudioConnectionFailure(error) ||
      ready ||
      !callbackFailed ||
      error !== failure
    ) {
      observation.kind = "unknown";
      throw new ConsumerError("OUTCOME_UNKNOWN");
    }
    observation.kind = "rolled-back";
    if (error instanceof ConsumerError) throw error;
    const fault = (error && typeof error === "object" ? error : {}) as {
      code?: string;
    };
    if (fault.code === "55P03" || fault.code === "57014")
      throw new ConsumerError("BUSY");
    if (fault.code === "23505") throw new ConsumerError("OPERATION_CONFLICT");
    if (fault.code === "23514") {
      const message = (error as { message?: string }).message;
      if (message === "CONSUMER_GRANT_ROTATION")
        throw new ConsumerError("BUSY");
      if (
        [
          "CONSUMER_KEY_EXPIRED",
          "CONSUMER_KEY_VOID",
          "CONSUMER_INVALID_CLAIM",
        ].includes(message ?? "")
      )
        throw new ConsumerError("KEY_NOT_ACTIVE");
      if (
        ["CONSUMER_INVALID_ANSWER", "CONSUMER_INVALID_PROGRESS"].includes(
          message ?? "",
        )
      )
        throw new ConsumerError("INVALID_ANSWERS");
    }
    throw consumerServiceError(error);
  }
}
export async function consumerReferenceShare(tx: ConsumerTx): Promise<void> {
  assertConsumerTx(tx);
  const [r] = await tx.sql<
    { locked: boolean }[]
  >`SELECT pg_try_advisory_xact_lock_shared(72461,2) locked`;
  if (r?.locked !== true) throw new ConsumerError("BUSY");
  tx.checkpoint();
}
export async function consumerDatabaseMoment(tx: ConsumerTx): Promise<string> {
  assertConsumerTx(tx);
  const [r] = await tx.sql<
    { at: string }[]
  >`SELECT qf.consumer_moment(date_trunc('milliseconds',clock_timestamp())) at`;
  if (!r?.at) throw new ConsumerError("UNAVAILABLE");
  return r.at;
}
