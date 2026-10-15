import { StudioError } from "@/lib/http-security/errors";
import type { P2aDatabase } from "@/lib/db/client";
import { createDatabase } from "@/lib/db/client";
import type { TestDatabase } from "./p2a-fixture";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { createValidationContext } from "@/features/quizpack/validation/operation";
import {
  readMediaOperationState,
  type MediaOperationContext,
} from "@/features/quizpack/server/media";
import { validationDtoSchema } from "@/features/quizpack/validation/contracts";
import {
  parseValidationAttempts,
  type ValidationRow,
  type ValidationAttempt,
} from "@/features/quizpack/validation/repository";
import { validationTransactions } from "@/features/quizpack/validation/transactions";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";

// This is test-process observation, never a media stop proof, recover input or HTTP token.
const tokens = new Map<string, object>(),
  snapshots = new WeakMap<
    object,
    Map<
      string,
      {
        revision: number;
        controls: string;
        productId: string;
        importId: string;
        key: string;
      }
    >
  >(),
  endedAttempts = new WeakMap<object, Set<string>>();
let observing = false;
function token(fixture: TestDatabase) {
  if (!["test", "ci"].includes(fixture.config.purpose))
    throw new Error("TEST_VALIDATION_INSTANCE_REQUIRED");
  let value = tokens.get(fixture.config.instanceId);
  if (!value) {
    if (tokens.size >= 16) throw new Error("TEST_VALIDATION_MONITOR_LIMIT");
    value = {};
    tokens.set(fixture.config.instanceId, value);
  }
  return value;
}
function attemptIdentity(id: string, a: ValidationAttempt) {
  return canonicalP1Json({
    validationId: id,
    attemptId: a.attemptId,
    fence: a.fence,
    ownerPid: a.ownerPid,
    ownerNonce: a.ownerNonce,
    mediaStop: a.mediaStop,
    fileStopProof: a.fileStopProof ?? null,
  });
}
export function testValidationRequestEnded(
  fixture: TestDatabase,
  row: ValidationRow,
) {
  const saved = snapshots.get(token(fixture))?.get(row.id);
  return (
    saved?.revision === row.state_revision &&
    saved.controls === row.attempts_text &&
    saved.productId === row.product_id &&
    saved.importId === row.import_id &&
    saved.key === row.validation_key
  );
}
async function within<T>(task: Promise<T>, deadline: number): Promise<T> {
  if (performance.now() >= deadline)
    throw new Error("TEST_VALIDATION_REQUEST_UNSETTLED");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        const observe = () => {
          const left = deadline - performance.now();
          if (left <= 0) reject(new Error("TEST_VALIDATION_REQUEST_UNSETTLED"));
          else timer = setTimeout(observe, Math.max(1, Math.ceil(left)));
        };
        timer = setTimeout(
          observe,
          Math.max(1, Math.ceil(deadline - performance.now())),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Work invokes the real service with an exclusive DB/context; all observation preserves original methods/results. */
async function observeRequest<T>(
  fixture: TestDatabase,
  work: (db: P2aDatabase, context: MediaOperationContext) => Promise<T>,
): Promise<T> {
  if (observing) throw new Error("TEST_VALIDATION_MONITOR_CONCURRENT");
  observing = true;
  const identity = token(fixture),
    { context, dispose } = createValidationContext(
      new AbortController().signal,
    ),
    acquisitions: Promise<StorageLock>[] = [],
    closes: Promise<boolean>[] = [],
    restoreClose: (() => void)[] = [],
    original = StorageLock.acquire,
    originalClaim = validationTransactions.claimValidation,
    originalRetry = validationTransactions.retryValidationClaim,
    owned = new Map<
      string,
      {
        productId: string;
        importId: string;
        key: string;
        attempts: Set<string>;
      }
    >();
  let database: P2aDatabase | undefined,
    unmatched = false,
    result: T | undefined,
    readDatabase: P2aDatabase | undefined,
    serviceSettled = false,
    rejected = false,
    rejection: unknown;
  try {
    database = await createDatabase(fixture.config, {
      signal: context.signal,
      deadlineMonotonicMs: context.deadlineMonotonicMs,
    });
    const initial = await database.sql<
      { id: string; attempts_text: string }[]
    >`SELECT id,attempts_text FROM qf.quizpack_validation ORDER BY id LIMIT 1025`;
    if (initial.length > 1024) throw new Error("TEST_VALIDATION_MONITOR_LIMIT");
    for (const row of initial) parseValidationAttempts(row.attempts_text);
    const requestDatabase = database;
    StorageLock.acquire = function (config, scope) {
      const task = original.call(StorageLock, config, scope);
      if (scope !== context || config !== requestDatabase.config) {
        unmatched = true;
        return task;
      }
      const captured = task.then((lock) => {
        const close = lock.close;
        lock.close = function () {
          const task = close.call(lock);
          closes.push(task);
          return task;
        };
        restoreClose.push(() => {
          lock.close = close;
        });
        return lock;
      });
      acquisitions.push(captured);
      return captured;
    };
    function recordClaim(row: ValidationRow, nonce: string) {
      const attempts = parseValidationAttempts(row.attempts_text).filter(
        (a) => a.ownerNonce === nonce && a.ownerPid === process.pid,
      );
      if (!attempts.length) return;
      owned.set(row.id, {
        productId: row.product_id,
        importId: row.import_id,
        key: row.validation_key,
        attempts: new Set(
          attempts.map((a) => `${a.attemptId}:${a.fence}:${a.ownerNonce}`),
        ),
      });
    }
    validationTransactions.claimValidation = async (...args) => {
      const value = await originalClaim(...args);
      if (args[0] === requestDatabase && value.created)
        recordClaim(value.row, args[3].owner.ownerNonce);
      return value;
    };
    validationTransactions.retryValidationClaim = async (...args) => {
      const value = await originalRetry(...args);
      if (args[0] === requestDatabase)
        recordClaim(value, args[4].owner.ownerNonce);
      return value;
    };
    try {
      result = await work(database, context);
    } catch (error) {
      rejected = true;
      rejection = error;
    }
    serviceSettled = true;
    const state = readMediaOperationState(context),
      deadline =
        state.phase === "stopping"
          ? state.stop.cleanupDeadlineMonotonicMs
          : state.deadlineMonotonicMs;
    await within(database.close(), deadline);
    database = undefined;
    await within(Promise.all(acquisitions), deadline);
    const ended = await within(Promise.all(closes), deadline);
    if (
      unmatched ||
      !acquisitions.length ||
      acquisitions.length !== closes.length ||
      ended.some((closed) => !closed) ||
      state.phase !== "stopping" ||
      state.stop.reason === "STOP_UNCONFIRMED" ||
      !serviceSettled
    )
      throw new Error("TEST_VALIDATION_REQUEST_UNSETTLED");
    const parsed = validationDtoSchema.safeParse(
      result && typeof result === "object" && "validation" in result
        ? result.validation
        : result,
    );
    const observedId = parsed.success
      ? parsed.data.id
      : owned.size === 1
        ? [...owned.keys()][0]
        : undefined;
    if (!observedId) {
      if (rejected) throw rejection;
      return result as T;
    }
    readDatabase = await createDatabase(fixture.config, {
      signal: new AbortController().signal,
      deadlineMonotonicMs: deadline,
    });
    const rows = await within(
      Promise.resolve(
        readDatabase.sql<
          {
            id: string;
            state_revision: number;
            attempts_text: string;
            product_id: string;
            import_id: string;
            validation_key: string;
          }[]
        >`SELECT id,state_revision,attempts_text,product_id,import_id,validation_key FROM qf.quizpack_validation WHERE id=${observedId}`,
      ),
      deadline,
    );
    await within(readDatabase.close(), deadline);
    readDatabase = undefined;
    if (rows.length !== 1) throw new Error("TEST_VALIDATION_REQUEST_DRIFTED");
    const row = rows[0]!;
    const claim = owned.get(row.id);
    if (
      (parsed.success && row.state_revision !== parsed.data.stateRevision) ||
      (claim &&
        (claim.productId !== row.product_id ||
          claim.importId !== row.import_id ||
          claim.key !== row.validation_key))
    )
      throw new Error("TEST_VALIDATION_REQUEST_DRIFTED");
    const attempts = parseValidationAttempts(row.attempts_text),
      known = endedAttempts.get(identity) ?? new Set<string>();
    // Existing attempts must have their own original request observation; exact replay cannot bless a different request.
    if (
      attempts.some(
        (a) =>
          a.ownerPid !== process.pid ||
          !a.fileStopProof ||
          a.mediaStop === "unconfirmed" ||
          (!known.has(attemptIdentity(row.id, a)) &&
            !claim?.attempts.has(`${a.attemptId}:${a.fence}:${a.ownerNonce}`)),
      )
    )
      throw new Error("TEST_VALIDATION_REQUEST_UNSETTLED");
    const after = readMediaOperationState(context);
    if (
      performance.now() >= deadline ||
      (after.phase === "stopping" && after.stop.reason === "STOP_UNCONFIRMED")
    )
      throw new Error("TEST_VALIDATION_REQUEST_UNSETTLED");
    for (const a of attempts) known.add(attemptIdentity(row.id, a));
    endedAttempts.set(identity, known);
    const stored = snapshots.get(identity) ?? new Map();
    if (stored.size >= 1024 && !stored.has(row.id))
      throw new Error("TEST_VALIDATION_MONITOR_LIMIT");
    stored.set(row.id, {
      revision: row.state_revision,
      controls: row.attempts_text,
      productId: row.product_id,
      importId: row.import_id,
      key: row.validation_key,
    });
    snapshots.set(identity, stored);
    if (rejected) throw rejection;
    return result as T;
  } finally {
    // Keep capture installed until actual owned close continuations drain, even if the public observation budget expired.
    try {
      if (database) await database.close();
      if (readDatabase) await readDatabase.close();
      await Promise.allSettled(acquisitions);
      await Promise.allSettled(closes);
    } finally {
      StorageLock.acquire = original;
      validationTransactions.claimValidation = originalClaim;
      validationTransactions.retryValidationClaim = originalRetry;
      for (const restore of restoreClose) restore();
      dispose();
      observing = false;
    }
  }
}

export async function runTestValidationRequest<T>(
  fixture: TestDatabase,
  work: (db: P2aDatabase, context: MediaOperationContext) => Promise<T>,
): Promise<T> {
  try {
    return await observeRequest(fixture, work);
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new Error("TEST_VALIDATION_REQUEST_UNSETTLED");
  }
}
