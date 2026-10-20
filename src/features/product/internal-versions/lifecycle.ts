import "server-only";
import type postgres from "postgres";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { withStudioWrite, type StudioWriteCredentials } from "@/lib/auth/write";
import type { StudioActor, StudioCapability } from "@/lib/auth/capabilities";
import { ResourceReadTask } from "@/features/quizpack/resource-read/task";
import { StorageReadGuard } from "@/features/quizpack/resource-read/guard";
import { INTERNAL_VERSION_LIMITS } from "./identity-contracts";

type Clock = Readonly<{ budget: DatabaseBudget; dispose(): void }>;
type Guard = Pick<StorageReadGuard, "signal" | "assert" | "check" | "close">;
/** Only withStudioWrite's actual driver result establishes this local observation. */
type WriteObservation =
  | { kind: "not-started" }
  | { kind: "pending" }
  | { kind: "committed" }
  | { kind: "rolled-back"; error: unknown }
  | { kind: "unknown"; error: unknown };
export type InternalVersionWork = Readonly<{
  checkpoint(): void;
  checkGuard(): Promise<void>;
  quarantine(resource: unknown): void;
  timeout(): void;
  write<T>(
    credentials: StudioWriteCredentials,
    capability: StudioCapability,
    work: (tx: postgres.TransactionSql, actor: StudioActor) => Promise<T>,
  ): Promise<T>;
}>;
export type InternalVersionOwner = Readonly<{
  assertOwns(db: P2aDatabase, budget: DatabaseBudget): void;
  runNew<T>(
    db: P2aDatabase,
    budget: DatabaseBudget,
    work: (context: InternalVersionWork) => Promise<T>,
  ): Promise<T>;
  closeIfNotTransferred(): Promise<void>;
}>;
type Dependencies = Readonly<{
  acquireGuard: (
    config: P2aDatabase["config"],
    checkpoint: () => void,
    deadlineMonotonicMs: number,
    onUnconfirmedClose?: (guard: Guard) => void,
  ) => Promise<Guard>;
  write: typeof withStudioWrite;
}>;
/** One owner per HTTP request. The transport must always call closeIfNotTransferred in finally. */
export function createInternalVersionOwner(
  db: P2aDatabase,
  clock: Clock,
  dependencies: Dependencies = {
    acquireGuard: StorageReadGuard.acquire,
    write: withStudioWrite,
  },
): InternalVersionOwner {
  const budget = clock.budget;
  let used = false,
    transferred = false,
    disposed = false;
  let closing: Promise<void> | undefined;
  const dispose = () => {
    if (!disposed) {
      disposed = true;
      clock.dispose();
    }
  };
  const closeDb = () => (closing ??= Promise.resolve().then(() => db.close()));
  const assertOwns = (actualDb: P2aDatabase, actualBudget: DatabaseBudget) => {
    if (
      actualDb !== db ||
      actualBudget !== budget ||
      clock.budget !== budget ||
      disposed
    )
      throw new StudioError("INVALID_REQUEST");
  };
  return Object.freeze({
    assertOwns,
    async runNew<T>(
      actualDb: P2aDatabase,
      actualBudget: DatabaseBudget,
      work: (context: InternalVersionWork) => Promise<T>,
    ): Promise<T> {
      assertOwns(actualDb, actualBudget);
      if (used) throw new StudioError("INVALID_REQUEST");
      used = true;
      const task = ResourceReadTask.acquire(
        budget.signal,
        budget.deadlineMonotonicMs -
          INTERNAL_VERSION_LIMITS.operationDeadlineMs,
      );
      let observation: WriteObservation = { kind: "not-started" };
      try {
        return await task.run(async () => {
          transferred = true;
          let guard: Guard | undefined;
          const lost = () =>
            task.stop(new StudioError("VERSION_RESOURCE_UNAVAILABLE"));
          try {
            guard = await dependencies.acquireGuard(
              db.config,
              () => task.checkpoint(),
              budget.deadlineMonotonicMs,
              (resource) => task.quarantine(resource),
            );
            guard.signal.addEventListener("abort", lost, { once: true });
            if (guard.signal.aborted) lost();
            const held = guard;
            const checkpoint = () => {
              task.checkpoint();
              held.assert();
            };
            const value = await work(
              Object.freeze({
                checkpoint,
                async checkGuard() {
                  checkpoint();
                  await held.check();
                  checkpoint();
                },
                quarantine(resource: unknown) {
                  task.quarantine(resource);
                  task.quarantine(held);
                },
                timeout() {
                  task.stop(new StudioError("PREVIEW_TIMEOUT"));
                },
                async write<T>(
                  credentials: StudioWriteCredentials,
                  capability: StudioCapability,
                  callback: (
                    tx: postgres.TransactionSql,
                    actor: StudioActor,
                  ) => Promise<T>,
                ) {
                  checkpoint();
                  if (observation.kind !== "not-started")
                    throw new StudioError("INVALID_REQUEST");
                  observation = { kind: "pending" };
                  try {
                    const result = await dependencies.write(
                      db,
                      credentials,
                      capability,
                      callback,
                    );
                    observation = { kind: "committed" };
                    return result;
                  } catch (error) {
                    observation =
                      error instanceof StudioError &&
                      error.code !== "WRITE_OUTCOME_UNKNOWN"
                        ? { kind: "rolled-back", error }
                        : { kind: "unknown", error };
                    throw error;
                  }
                },
              }),
            );
            checkpoint();
            return value;
          } finally {
            // This finally belongs to actual work, never to Task.run's cancellation race.
            guard?.signal.removeEventListener("abort", lost);
            try {
              try {
                await closeDb();
              } catch (error) {
                task.quarantine(db);
                if (guard) task.quarantine(guard);
                throw error;
              }
              if (!task.hasUnconfirmedIo && guard) {
                try {
                  await guard.close();
                } catch (error) {
                  task.quarantine(guard);
                  throw error;
                }
              }
            } finally {
              dispose();
            }
          }
        });
      } catch (error) {
        // The enum is changed by actual callbacks; TypeScript cannot observe those assignments.
        const observed = observation as WriteObservation;
        if (observed.kind === "rolled-back") throw observed.error;
        if (["pending", "committed", "unknown"].includes(observed.kind))
          throw new StudioError("WRITE_OUTCOME_UNKNOWN");
        throw error;
      }
    },
    async closeIfNotTransferred() {
      if (transferred) return;
      try {
        await closeDb();
      } finally {
        dispose();
      }
    },
  });
}
