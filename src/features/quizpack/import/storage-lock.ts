import "server-only";
import type postgres from "postgres";
import { openSql } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { remainingReceiveMs } from "./context";
import type { ReceiveContext } from "./service-contract";

/** Owns a distinct driver pool and one reserved handle. Never replaces driver onclose. */
export class StorageLock {
  private valid = true;
  private released = false;
  private timer?: ReturnType<typeof setTimeout>;
  private checking: Promise<void> | undefined;
  readonly controller = new AbortController();
  private constructor(
    private readonly client: postgres.Sql,
    readonly connection: postgres.ReservedSql,
    private readonly context?: ReceiveContext,
  ) {}
  static async acquire(
    config: P2aRuntimeConfig,
    context?: ReceiveContext,
  ): Promise<StorageLock> {
    if (context) remainingReceiveMs(context);
    const client = openSql(config.database, 1);
    let connection: postgres.ReservedSql | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      connection = await Promise.race([
        client.reserve(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => {
              void client.end({ timeout: 0 }).catch(() => {});
              reject(new StudioError("WRITE_OUTCOME_UNKNOWN"));
            },
            Math.min(2000, context ? remainingReceiveMs(context) : 2000),
          );
        }),
      ]);
      clearTimeout(timeout);
      await connection`SET statement_timeout='2s'`;
      const [row] = await connection<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_lock(72461,2) locked`;
      if (!row?.locked) throw new StudioError("RECEIVE_BUSY");
      const lock = new StorageLock(client, connection, context);
      await lock.check();
      lock.schedule();
      return lock;
    } catch (error) {
      clearTimeout(timeout);
      connection?.release();
      await client.end({ timeout: 0 }).catch(() => {});
      if (error instanceof StudioError) throw error;
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
  async check() {
    this.assert();
    try {
      const [row] = await this.connection<
        { locked: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted) locked`;
      if (!row?.locked) throw new Error("LOCK_LOST");
      this.assert();
    } catch {
      this.valid = false;
      this.controller.abort();
      throw new StudioError("RECEIVE_LOCK_LOST");
    }
  }
  async close() {
    if (this.released) return;
    this.released = true;
    clearTimeout(this.timer);
    await this.checking;
    try {
      if (this.valid) await this.connection`SELECT pg_advisory_unlock(72461,2)`;
    } catch {
      this.valid = false;
    } finally {
      this.valid = false;
      this.controller.abort();
      this.connection.release();
      await this.client.end({ timeout: 0 }).catch(() => {});
    }
  }
}
