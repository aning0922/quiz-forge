import "server-only";
import {
  createObservedDatabase,
  type P2aDatabase,
  type DatabaseBudget,
} from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { DatabaseLifecycleObserver } from "@/lib/db/lifecycle-observer";
import { ResourceReadTask } from "@/features/quizpack/resource-read/task";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import { StudioError } from "@/lib/http-security/errors";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { runConsumerSqlPhase } from "./sql-owner";
import type { ConsumerRequestLifecycle } from "./service-contract";

type Clock = Readonly<{ budget: DatabaseBudget; dispose(): void }>;
type Operation =
  | "exchange"
  | "read-session"
  | "read-entry"
  | "save"
  | "resolve-save"
  | "complete"
  | "resolve-complete"
  | "read-report"
  | "read-resource"
  | "logout"
  | "create-play"
  | "resolve-play"
  | "read-play"
  | "list-plays"
  | "issue-key"
  | "resolve-issue"
  | "void-key"
  | "resolve-void"
  | "read-key"
  | "list-keys";
export type ConsumerIoContext = Readonly<{
  db: P2aDatabase;
  task: ResourceReadTask;
  guard: StorageReadGuard;
  checkpoint(): void;
  /** Only read-resource may issue one exact returned bytes object. */
  issueBody(bytes: Uint8Array): void;
}>;
type Context = Readonly<{
  config: P2aRuntimeConfig;
  budget: DatabaseBudget;
  checkpoint(): void;
  sql<T>(
    work: (db: P2aDatabase, checkpoint: () => void) => Promise<T>,
  ): Promise<T>;
  io<T>(work: (context: ConsumerIoContext) => Promise<T>): Promise<T>;
}>;
export type ConsumerRequestOwner = ConsumerRequestLifecycle &
  Readonly<{
    run<T>(
      operation: Operation,
      work: (context: Context) => Promise<T>,
    ): Promise<T>;
  }>;

/** One public call and one absolute clock per request. Factories are lazy; no opening at construction. */
export function createConsumerRequestOwner(
  config: P2aRuntimeConfig,
  clock: Clock,
): ConsumerRequestOwner {
  const budget = clock.budget;
  let used = false,
    closed = false,
    disposed = false,
    bodyTransferred = false;
  let activeTask: ResourceReadTask | undefined;
  let issuedBytes: Uint8Array | undefined,
    innerBody: ReadableStream<Uint8Array> | undefined;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      clock.dispose();
    }
  };
  const checkpoint = () => {
    if (
      closed ||
      budget.signal.aborted ||
      !Number.isFinite(budget.deadlineMonotonicMs) ||
      performance.now() >= budget.deadlineMonotonicMs
    )
      throw new ConsumerError("TIMEOUT");
  };
  return Object.freeze({
    async run<T>(
      operation: Operation,
      work: (context: Context) => Promise<T>,
    ): Promise<T> {
      checkpoint();
      if (used || clock.budget !== budget)
        throw new ConsumerError("INVALID_REQUEST");
      used = true;
      let sqlPhases = 0,
        confirmedSqlPhases = 0,
        phaseFailed = false,
        ioStarted = false,
        phasePending = false;
      const context: Context = Object.freeze({
        config,
        budget,
        checkpoint,
        async sql<T>(
          callback: (db: P2aDatabase, checkpoint: () => void) => Promise<T>,
        ) {
          checkpoint();
          if (
            phaseFailed ||
            phasePending ||
            ioStarted ||
            confirmedSqlPhases !== sqlPhases ||
            sqlPhases >= (operation === "exchange" ? 2 : 1)
          ) {
            phaseFailed = true;
            throw new ConsumerError("INVALID_REQUEST");
          }
          phasePending = true;
          sqlPhases++;
          try {
            const value = await runConsumerSqlPhase(
              config,
              budget,
              createObservedDatabase,
              async (db, checkSql) => {
                const check = () => {
                  checkpoint();
                  checkSql();
                };
                check();
                return callback(db, check);
              },
            );
            checkpoint();
            confirmedSqlPhases++;
            return value;
          } catch (error) {
            phaseFailed = true;
            throw error;
          } finally {
            phasePending = false;
          }
        },
        async io<T>(
          callback: (context: ConsumerIoContext) => Promise<T>,
        ): Promise<T> {
          checkpoint();
          if (
            phaseFailed ||
            phasePending ||
            ioStarted ||
            sqlPhases !== 1 ||
            confirmedSqlPhases !== 1 ||
            ![
              "complete",
              "create-play",
              "read-entry",
              "read-resource",
            ].includes(operation)
          )
            throw new ConsumerError("INVALID_REQUEST");
          phasePending = true;
          ioStarted = true;
          const task = ResourceReadTask.acquire(
            budget.signal,
            budget.deadlineMonotonicMs - L.deadlineMs,
          );
          activeTask = task;
          let actualEntered = false;
          try {
            return await task.run(async () => {
              actualEntered = true;
              let db: P2aDatabase | undefined,
                guard: StorageReadGuard | undefined,
                client: unknown;
              let verification: Promise<void> | undefined;
              const endings: Promise<void>[] = [];
              let unconfirmed = false;
              const retained = new Set<unknown>();
              const quarantine = (resource: unknown) => {
                unconfirmed = true;
                if (!retained.has(resource)) {
                  retained.add(resource);
                  task.quarantine(resource);
                }
              };
              const observer: DatabaseLifecycleObserver = {
                allocated(value) {
                  client = value;
                },
                verification(actual) {
                  verification = actual;
                },
                ending(actual) {
                  if (endings.length >= 3) {
                    quarantine(client);
                    void actual.catch(() => {});
                    return;
                  }
                  endings.push(actual);
                  void actual.catch(() => quarantine(client));
                },
                neverAllocated() {},
              };
              const lost = () =>
                task.stop(new StudioError("PREVIEW_RESOURCE_UNAVAILABLE"));
              try {
                guard = await StorageReadGuard.acquire(
                  config,
                  () => {
                    checkpoint();
                    task.checkpoint();
                  },
                  budget.deadlineMonotonicMs,
                  quarantine,
                );
                guard.signal.addEventListener("abort", lost, { once: true });
                if (guard.signal.aborted) lost();
                db = await createObservedDatabase(config, budget, observer);
                const actualGuard = guard;
                const check = () => {
                  checkpoint();
                  task.checkpoint();
                  actualGuard.assert();
                };
                const value = await callback(
                  Object.freeze({
                    db,
                    task,
                    guard: actualGuard,
                    checkpoint: check,
                    issueBody(bytes: Uint8Array) {
                      check();
                      if (
                        operation !== "read-resource" ||
                        issuedBytes ||
                        bytes.byteLength === 0 ||
                        bytes.byteLength > L.imageBytes
                      )
                        throw new ConsumerError("INVALID_REQUEST");
                      issuedBytes = bytes;
                      // Shared backing memory; no second unbounded image copy. Body exists before Task.run settles.
                      innerBody = task.body(
                        Buffer.from(
                          bytes.buffer,
                          bytes.byteOffset,
                          bytes.byteLength,
                        ),
                        dispose,
                      );
                    },
                  }),
                );
                check();
                await actualGuard.check();
                check();
                return value;
              } finally {
                guard?.signal.removeEventListener("abort", lost);
                try {
                  if (db) await db.close();
                  if (verification) await verification.catch(() => {});
                  if (client && (!verification || endings.length === 0))
                    quarantine(client);
                  const results = await Promise.allSettled(endings);
                  if (results.some((r) => r.status !== "fulfilled"))
                    quarantine(client);
                  if (!unconfirmed && !task.hasUnconfirmedIo && guard)
                    await guard.close().catch((error) => {
                      quarantine(guard);
                      throw error;
                    });
                  else if (guard) quarantine(guard);
                } catch (error) {
                  if (client) quarantine(client);
                  if (guard) quarantine(guard);
                  throw error;
                } finally {
                  if (!innerBody) dispose();
                }
              }
            });
          } finally {
            phasePending = false;
            if (!actualEntered) dispose();
          }
        },
      });
      return work(context);
    },
    resourceBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
      checkpoint();
      if (bodyTransferred || bytes !== issuedBytes || !innerBody || !activeTask)
        throw new ConsumerError("INVALID_REQUEST");
      bodyTransferred = true;
      issuedBytes = undefined;
      const stream = innerBody;
      innerBody = undefined;
      return stream;
    },
    async closeIfNotTransferred() {
      closed = true;
      if (bodyTransferred) return;
      issuedBytes = undefined;
      if (innerBody) {
        const body = innerBody;
        innerBody = undefined;
        try {
          await body.cancel();
        } catch {
          // An already errored memory body is not a DB/FD close observation. Those stay with the actual task.
        } finally {
          dispose();
        }
      } else if (!activeTask) dispose();
    },
  });
}
