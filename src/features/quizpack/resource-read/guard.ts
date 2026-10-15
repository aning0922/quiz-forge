import "server-only";
import type postgres from "postgres";
import { openSql } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";

/** Session SHARE lock on the existing maintenance key; original exclusive StorageLock is unchanged. */
export class StorageReadGuard {
  private readonly client: postgres.Sql;
  private connection: postgres.ReservedSql | undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private valid = true;
  private acquiringUntil = performance.now() + PREVIEW_LIMITS.lockDeadlineMs;
  private closing: Promise<void> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private checking: Promise<void> | undefined;
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private constructor(
    config: P2aRuntimeConfig,
    private readonly checkpoint: () => void,
    private readonly deadline: number,
  ) {
    this.client = openSql(config.database, 1);
  }
  private track<T>(promise: PromiseLike<T>): Promise<T> {
    const task = Promise.resolve(promise);
    this.pending.add(task);
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task),
    );
    return task;
  }
  private invalidate = () => {
    this.valid = false;
    this.controller.abort();
  };
  private async query<T>(
    work: () => PromiseLike<T>,
    duringClose = false,
  ): Promise<T> {
    if (!duringClose) {
      this.checkpoint();
      this.assert();
    }
    const ms = Math.min(
      PREVIEW_LIMITS.lockDeadlineMs,
      this.deadline - performance.now(),
      this.acquiringUntil - performance.now(),
    );
    if (ms <= 0 && !duringClose) throw new StudioError("PREVIEW_TIMEOUT");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.track(Promise.resolve().then(work)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              this.invalidate();
              void this.track(this.client.end({ timeout: 0 })).catch(() => {});
              reject(new StudioError("PREVIEW_RESOURCE_UNAVAILABLE"));
            },
            duringClose ? PREVIEW_LIMITS.lockDeadlineMs : ms,
          );
        }),
      ]);
    } catch (error) {
      this.invalidate();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  static async acquire(
    config: P2aRuntimeConfig,
    checkpoint: () => void,
    deadlineMonotonicMs: number,
  ): Promise<StorageReadGuard> {
    const guard = new StorageReadGuard(config, checkpoint, deadlineMonotonicMs);
    try {
      await guard.query(async () => {
        guard.connection = await guard.client.reserve();
        return guard.connection;
      });
      const pinned = guard.connection!;
      await guard.query(() => pinned`SET statement_timeout='2s'`);
      const [row] = await guard.query(
        () =>
          pinned<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_lock_shared(72461,2) locked`,
      );
      if (!row?.locked) throw new StudioError("PREVIEW_BUSY");
      await guard.check();
      guard.acquiringUntil = Infinity;
      guard.schedule();
      return guard;
    } catch (error) {
      await guard.close();
      throw error;
    }
  }
  assert(): void {
    if (!this.valid || this.closing)
      throw new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
  }
  async check(): Promise<void> {
    const connection = this.connection;
    if (!connection) throw new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
    const [row] = await this.query(
      () =>
        connection<
          { locked: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted) locked`,
    );
    if (!row?.locked) {
      this.invalidate();
      throw new StudioError("PREVIEW_RESOURCE_UNAVAILABLE");
    }
    this.checkpoint();
    this.assert();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.checking = this.check()
        .catch(() => {
          this.invalidate();
        })
        .finally(() => {
          this.checking = undefined;
          if (this.valid && !this.closing) this.schedule();
        });
    }, 1000);
    this.timer.unref?.();
  }
  /** Caller must await actual FS settlement BEFORE closing this guard, including on abort. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    clearTimeout(this.timer);
    this.closing = (async () => {
      await this.checking;
      // Late reserve/query results are retained, including handles obtained after a timeout.
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      try {
        if (this.valid && this.connection) {
          const connection = this.connection;
          await this.query(
            () => connection`SELECT pg_advisory_unlock_shared(72461,2)`,
            true,
          );
        }
      } finally {
        this.invalidate();
        this.connection?.release();
        await this.track(this.client.end({ timeout: 0 }));
        while (this.pending.size) await Promise.allSettled([...this.pending]);
      }
    })();
    return this.closing;
  }
}
