import "server-only";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { DatabaseLifecycleObserver } from "@/lib/db/lifecycle-observer";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

const registryKey = Symbol.for("quizforge.p4.sql-owner.v1");
type Registry = { version: 1; maximum: 8; owners: Set<SqlOwner> };
const globals = globalThis as typeof globalThis & { [registryKey]?: Registry };
function registry(): Registry {
  const old = globals[registryKey];
  if (old !== undefined) {
    if (
      old.version !== 1 ||
      old.maximum !== L.maximumSqlOwnersPerProcess ||
      !(old.owners instanceof Set) ||
      old.owners.size > old.maximum
    )
      throw new ConsumerError("UNAVAILABLE");
    return old;
  }
  const created: Registry = { version: 1, maximum: 8, owners: new Set() };
  Object.defineProperty(globals, registryKey, {
    value: created,
    configurable: false,
    writable: false,
  });
  return created;
}
export type ConsumerSqlFactory = (
  config: P2aRuntimeConfig,
  budget: DatabaseBudget,
  observer: DatabaseLifecycleObserver,
) => Promise<P2aDatabase>;
type Ending = {
  actual: Promise<void>;
  state: "pending" | "fulfilled" | "rejected";
};

/** One phase, one pool, no queue. The registry retains actual resources after the caller stops waiting. */
class SqlOwner {
  private client: unknown;
  private noAllocation = false;
  private verificationStarted = false;
  private verificationActual: Promise<void> | undefined;
  private verificationSettled = false;
  private factorySettled = false;
  private workSettled = false;
  private terminal = false;
  private quarantined = false;
  private released = false;
  private readonly endings: Ending[] = [];
  // Keep the actual opening and work promises alive; no attempt/history ledger.
  private opening: Promise<P2aDatabase> | undefined;
  private work: Promise<unknown> | undefined;
  private readonly group: Registry;
  constructor() {
    this.group = registry();
    if (this.group.owners.size >= this.group.maximum)
      throw new ConsumerError("BUSY");
    this.group.owners.add(this);
  }
  private maybeRelease() {
    if (
      this.released ||
      this.quarantined ||
      !this.terminal ||
      !this.factorySettled ||
      !this.workSettled
    )
      return;
    if (this.client === undefined) {
      if (!this.noAllocation || this.verificationStarted || this.endings.length)
        return;
    } else if (
      !this.verificationStarted ||
      !this.verificationSettled ||
      !this.endings.length ||
      this.endings.some((e) => e.state !== "fulfilled")
    )
      return;
    this.released = true;
    this.group.owners.delete(this);
    this.client = undefined;
    this.opening = undefined;
    this.work = undefined;
    this.verificationActual = undefined;
  }
  private readonly observer: DatabaseLifecycleObserver = Object.freeze({
    allocated: (client) => {
      if (this.client !== undefined || this.noAllocation || this.terminal)
        this.quarantined = true;
      else this.client = client;
    },
    verification: (actual) => {
      if (
        this.verificationStarted ||
        this.client === undefined ||
        this.terminal
      )
        this.quarantined = true;
      this.verificationStarted = true;
      this.verificationActual = actual;
      void actual.then(
        () => {
          this.verificationSettled = true;
          this.maybeRelease();
        },
        () => {
          this.verificationSettled = true;
          this.maybeRelease();
        },
      );
    },
    ending: (actual) => {
      // Existing factory has at most abort/event, timer, and normal/catch close. Never retain an unbounded list.
      if (
        this.endings.length >= 3 ||
        this.client === undefined ||
        this.terminal
      ) {
        this.quarantined = true;
        void actual.catch(() => {});
        return;
      }
      const entry: Ending = { actual, state: "pending" };
      this.endings.push(entry);
      void actual.then(
        () => {
          entry.state = "fulfilled";
          this.maybeRelease();
        },
        () => {
          entry.state = "rejected";
          this.quarantined = true;
        },
      );
    },
    neverAllocated: () => {
      if (
        this.client !== undefined ||
        this.verificationStarted ||
        this.terminal
      )
        this.quarantined = true;
      else this.noAllocation = true;
    },
  });
  async run<T>(
    config: P2aRuntimeConfig,
    budget: DatabaseBudget,
    factory: ConsumerSqlFactory,
    callback: (db: P2aDatabase, checkpoint: () => void) => Promise<T>,
  ): Promise<T> {
    let db: P2aDatabase | undefined;
    const checkpoint = () => {
      if (
        budget.signal.aborted ||
        performance.now() >= budget.deadlineMonotonicMs
      )
        throw new ConsumerError("TIMEOUT");
    };
    try {
      // This call is inside the already reserved owner; observers run before factory verification awaits.
      try {
        this.opening = factory(config, budget, this.observer);
        db = await this.opening;
      } finally {
        this.factorySettled = true;
      }
      if (db.sql !== this.client || this.quarantined)
        throw new ConsumerError("UNAVAILABLE");
      checkpoint();
      this.work = Promise.resolve().then(() => {
        checkpoint();
        return callback(db!, checkpoint);
      });
      return (await this.work) as T;
    } finally {
      this.workSettled = true;
      try {
        if (db) await db.close();
      } finally {
        this.terminal = true;
        this.maybeRelease();
      }
    }
  }
}

/** Internal request phases only. No registry reset/retry/TTL or arbitrary existing pool admission. */
export async function runConsumerSqlPhase<T>(
  config: P2aRuntimeConfig,
  budget: DatabaseBudget,
  factory: ConsumerSqlFactory,
  work: (db: P2aDatabase, checkpoint: () => void) => Promise<T>,
): Promise<T> {
  if (
    budget.signal.aborted ||
    !Number.isFinite(budget.deadlineMonotonicMs) ||
    performance.now() >= budget.deadlineMonotonicMs
  )
    throw new ConsumerError("TIMEOUT");
  const owner = new SqlOwner(); // Synchronous admission BEFORE any open factory call.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const actual = owner.run(config, budget, factory, work);
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(new ConsumerError("TIMEOUT"));
    budget.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(
      onAbort,
      Math.max(0, budget.deadlineMonotonicMs - performance.now()),
    );
    timer.unref?.();
    if (budget.signal.aborted) onAbort();
  });
  try {
    return await Promise.race([actual, cancelled]);
  } finally {
    clearTimeout(timer);
    if (onAbort) budget.signal.removeEventListener("abort", onAbort);
  }
}
