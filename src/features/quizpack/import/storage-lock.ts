import "server-only";
import type postgres from "postgres";
import { openSql } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { remainingReceiveMs } from "./context";
import type { ReceiveContext } from "./service-contract";

const ownedIo = new WeakMap<postgres.Sql, Set<Promise<unknown>>>();
function trackIo<T>(client: postgres.Sql, promise: PromiseLike<T>): Promise<T> {
  const task = Promise.resolve(promise),
    pending = ownedIo.get(client) ?? new Set<Promise<unknown>>();
  ownedIo.set(client, pending);
  pending.add(task);
  void task.then(
    () => pending.delete(task),
    () => pending.delete(task),
  );
  return task;
}
async function drainIo(client: postgres.Sql) {
  const pending = ownedIo.get(client);
  while (pending?.size) await Promise.allSettled([...pending]);
}
/** Client wall-clock bound as well as PG statement_timeout. Expiration destroys this pool. */
async function queryDeadline<T>(
  promise: PromiseLike<T>,
  client: postgres.Sql,
  invalidate: () => void,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      trackIo(client, promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          invalidate();
          void trackIo(client, client.end({ timeout: 0 })).catch(() => {});
          reject(new StudioError("RECEIVE_LOCK_LOST"));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** Owns a distinct driver pool and one reserved handle. Never replaces driver onclose. */
export class StorageLock {
  private valid = true;
  private released = false;
  private timer?: ReturnType<typeof setTimeout>;
  private checking: Promise<void> | undefined;
  private closing: Promise<boolean> | undefined;
  readonly controller = new AbortController();
  private constructor(
    private readonly client: postgres.Sql,
    readonly connection: postgres.ReservedSql,
    private readonly context?: ReceiveContext,
  ) {}
  private invalidate = () => {
    this.valid = false;
    this.controller.abort();
  };
  static async acquire(
    config: P2aRuntimeConfig,
    context?: ReceiveContext,
  ): Promise<StorageLock> {
    const budget = Math.min(2000, context ? remainingReceiveMs(context) : 2000),
      started = performance.now();
    const client = openSql(config.database, 1);
    let connection: postgres.ReservedSql | undefined;
    try {
      const pinned = await queryDeadline<postgres.ReservedSql>(
        Promise.resolve()
          .then(() => client.reserve())
          .then((reserved) => {
            connection = reserved;
            return reserved;
          }),
        client,
        () => {},
        budget,
      );
      connection = pinned;
      const left = () => {
        const ms = Math.min(
          budget - (performance.now() - started),
          context ? remainingReceiveMs(context) : 2000,
        );
        if (ms <= 0) throw new StudioError("WRITE_OUTCOME_UNKNOWN");
        return ms;
      };
      const setupBudget = left();
      await queryDeadline(
        Promise.resolve().then(() => pinned`SET statement_timeout='2s'`),
        client,
        () => {},
        setupBudget,
      );
      const lockingBudget = left();
      const [row] = await queryDeadline(
        Promise.resolve().then(
          () =>
            pinned<
              { locked: boolean }[]
            >`SELECT pg_try_advisory_lock(72461,2) locked`,
        ),
        client,
        () => {},
        lockingBudget,
      );
      if (!row?.locked) throw new StudioError("RECEIVE_BUSY");
      const lock = new StorageLock(client, pinned, context);
      await lock.check();
      lock.schedule();
      return lock;
    } catch (error) {
      connection?.release();
      connection = undefined;
      await trackIo(client, client.end({ timeout: 0 })).catch(() => {});
      await drainIo(client);
      const lateConnection = connection as postgres.ReservedSql | undefined;
      lateConnection?.release();
      if (error instanceof StudioError && error.code !== "RECEIVE_LOCK_LOST")
        throw error;
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    }
  }
  assert() {
    if (!this.valid || this.released)
      throw new StudioError("RECEIVE_LOCK_LOST");
    if (this.context) remainingReceiveMs(this.context);
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.checking = this.check()
        .catch(() => {})
        .finally(() => {
          this.checking = undefined;
          if (this.valid && !this.released) this.schedule();
        });
    }, 1000);
    this.timer.unref?.();
  }
  async query<T>(work: () => PromiseLike<T>): Promise<T> {
    this.assert();
    try {
      const milliseconds = Math.min(
        2000,
        this.context ? remainingReceiveMs(this.context) : 2000,
      );
      // Fix the budget before invoking work, then immediately observe its result.
      return await queryDeadline(
        Promise.resolve().then(work),
        this.client,
        this.invalidate,
        milliseconds,
      );
    } catch {
      this.invalidate();
      throw new StudioError("RECEIVE_LOCK_LOST");
    }
  }
  async check() {
    this.assert();
    const [row] = await this.query(
      () =>
        this.connection<
          { locked: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted) locked`,
    );
    if (!row?.locked) {
      this.invalidate();
      throw new StudioError("RECEIVE_LOCK_LOST");
    }
    this.assert();
  }
  async close(): Promise<boolean> {
    if (this.closing) return this.closing;
    this.released = true;
    clearTimeout(this.timer);
    this.closing = (async () => {
      await this.checking;
      try {
        if (this.valid)
          await queryDeadline(
            Promise.resolve().then(
              () => this.connection`SELECT pg_advisory_unlock(72461,2)`,
            ),
            this.client,
            this.invalidate,
            2000,
          );
      } catch {
        this.invalidate();
      }
      this.invalidate();
      this.connection.release();
      try {
        await trackIo(this.client, this.client.end({ timeout: 0 }));
        await drainIo(this.client);
        return true;
      } catch {
        await drainIo(this.client);
        return false;
      }
    })();
    return this.closing;
  }
}
