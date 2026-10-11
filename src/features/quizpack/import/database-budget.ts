import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { remainingReceiveMs } from "./context";
import type { ReceiveContext } from "./service-contract";
const invalid = new WeakSet<P2aDatabase>();
/** Only for a receive/recover operation's dedicated DB. Caller still waits file IO itself. */
export async function receiveDatabaseAwait<T>(
  db: P2aDatabase,
  context: ReceiveContext,
  kind: "read" | "write",
  work: () => PromiseLike<T>,
): Promise<T> {
  if (invalid.has(db))
    throw new StudioError(
      kind === "write" ? "WRITE_OUTCOME_UNKNOWN" : "RECEIVE_TIMEOUT",
    );
  const ms = remainingReceiveMs(context);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire: (() => void) | undefined;
  try {
    const expiration = new Promise<never>((_, reject) => {
      expire = () => {
        invalid.add(db);
        void db.sql.end({ timeout: 0 }).catch(() => {});
        reject(
          new StudioError(
            kind === "write" ? "WRITE_OUTCOME_UNKNOWN" : "RECEIVE_TIMEOUT",
          ),
        );
      };
      timer = setTimeout(expire, ms);
      context.signal.addEventListener("abort", expire, { once: true });
      if (context.signal.aborted) expire();
    });
    // Resolve a confirmed result without a post-return deadline check. Observe every late rejection.
    return await Promise.race([Promise.resolve().then(work), expiration]);
  } catch (error) {
    if (
      context.signal.aborted ||
      performance.now() >= context.deadlineMonotonicMs
    ) {
      invalid.add(db);
      void db.sql.end({ timeout: 0 }).catch(() => {});
      throw new StudioError(
        kind === "write" ? "WRITE_OUTCOME_UNKNOWN" : "RECEIVE_TIMEOUT",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (expire) context.signal.removeEventListener("abort", expire);
  }
}
