import "server-only";
import { receiveDatabaseAwait } from "./database-budget";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, link, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { P2aDatabase } from "@/lib/db/client";
import {
  normalizeRuntimeConfig,
  readPrivateJson,
  type P2aRuntimeConfig,
} from "@/lib/db/runtime";
import { withStudioWrite, type StudioWriteCredentials } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import { productIdSchema } from "@/features/product/workspace/contracts";
import { productRow } from "@/features/product/workspace/repository";
import {
  createImportIntentSchema,
  importIdSchema,
  idempotencyKeySchema,
  importListQuerySchema,
  recoverReceiveSchema,
  type CreateImportIntent,
  type ImportListQuery,
  type RecoverReceive,
  type ReceiveErrorCode,
} from "./contracts";
import { remainingReceiveMs } from "./context";
import {
  MAX_ARCHIVE_BYTES,
  RECEIVE_TIMEOUT_MS,
  MAX_ATTEMPTS,
  MAX_PENDING_INTENTS,
  attemptReservation,
} from "./limits";
import { StorageLock } from "./storage-lock";
import {
  assertNoConfigGuard,
  currentReceiptLimits,
  hashArchive,
  importDirectory,
  instanceDirectory,
  privateDirectory,
  removeOwned,
  scanStorage,
  stopped,
  writeStopped,
  type Attempt,
} from "./storage";
import {
  activeProduct,
  audit,
  canIncrement,
  dto,
  heldRows,
  importRow,
  parse,
  read,
  type ImportRow,
} from "./repository";
import { measuredQuota, requireQuota, requireReceiveCapacity } from "./quota";
import type {
  ImportReceiveService,
  ReceiveContext,
  ReceiveSource,
} from "./service-contract";

/** Narrow internal fault observations for tests; never exposed by HTTP or runtime config. */
export type ReceiveTestHooks = {
  afterClaim?: (row: ImportRow) => Promise<void>;
  afterFreeze?: (row: ImportRow) => Promise<void>;
  afterCommit?: (
    kind: "intent" | "claim" | "complete" | "recover",
    row: ImportRow,
  ) => Promise<void>;
  beforeIo?: (operation: "write" | "sync" | "link" | "unlink") => Promise<void>;
};
export async function currentConfig(
  db: P2aDatabase,
): Promise<P2aRuntimeConfig> {
  try {
    const config = normalizeRuntimeConfig(
      await readPrivateJson(
        path.join(instanceDirectory(db.config), "runtime.json"),
      ),
    );
    if (
      config.instanceId !== db.config.instanceId ||
      JSON.stringify(config.database) !== JSON.stringify(db.config.database) ||
      config.purpose !== db.config.purpose ||
      config.origin !== db.config.origin
    )
      throw new Error("CONFIG_IDENTITY");
    return config;
  } catch {
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export function intentFingerprint(
  productId: string,
  value: CreateImportIntent,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operation: "receive.v1",
        productId,
        expectedArchiveSha256: value.expectedArchiveSha256,
        expectedArchiveBytes: value.expectedArchiveBytes,
        target: { kind: value.target.kind },
      }),
    )
    .digest("hex");
}
async function writeConfig(db: P2aDatabase, lock: StorageLock) {
  lock.assert();
  const config = await currentConfig(db);
  await assertNoConfigGuard(config);
  if (!config.imports.enabled) throw new StudioError("IMPORTS_DISABLED");
  return config;
}
async function boundedTx(
  tx: Parameters<Parameters<typeof withStudioWrite>[3]>[0],
  context: ReceiveContext,
  lock: StorageLock,
) {
  lock.assert();
  const ms = Math.max(1, Math.floor(remainingReceiveMs(context)));
  await tx`SELECT set_config('statement_timeout',${`${Math.min(ms, 5000)}ms`},true),set_config('transaction_timeout',${`${Math.min(ms, 10000)}ms`},true)`;
}
async function preflight(
  db: P2aDatabase,
  c: StudioWriteCredentials,
  productId: string,
  id?: string,
  context?: ReceiveContext,
) {
  if (context) remainingReceiveMs(context);
  return read(
    db,
    c.sessionToken,
    async (tx) => {
      const p = await productRow(tx, productId);
      if (p.archived_at !== null) throw new StudioError("PRODUCT_ARCHIVED");
      return id ? importRow(tx, productId, id) : null;
    },
    c,
  );
}
/** Timeout never means the cancellation/read has settled. Every pending promise has a rejection observer. */
async function cancelSource(source: ReceiveSource): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = Promise.resolve()
    .then(source.cancel)
    .then(
      () => true,
      () => false,
    );
  try {
    return await Promise.race([
      done,
      new Promise<false>((r) => {
        timer = setTimeout(() => r(false), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function waitInput<T>(
  promise: Promise<T>,
  context: ReceiveContext,
  lock: StorageLock,
): Promise<T> {
  const ms = remainingReceiveMs(context);
  lock.assert();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const signals = [context.signal, lock.controller.signal];
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(
            new StudioError(
              lock.controller.signal.aborted
                ? "RECEIVE_LOCK_LOST"
                : "RECEIVE_TIMEOUT",
            ),
          );
        signals.forEach((s) =>
          s.addEventListener("abort", abort, { once: true }),
        );
        timer = setTimeout(
          () => reject(new StudioError("RECEIVE_TIMEOUT")),
          ms,
        );
        if (signals.some((s) => s.aborted)) abort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signals.forEach((s) => s.removeEventListener("abort", abort));
  }
}
const released = (row: ImportRow) =>
  row.attempts.map((a) => ({ ...a, disposition: "released" as const }));
function revisionMatches(row: ImportRow, expected: number) {
  if (row.state_revision !== expected)
    throw new StudioError("IMPORT_STATE_CONFLICT", row.state_revision);
}
function recoveryRequired(row: ImportRow) {
  if (
    row.storage_condition !== "clean" ||
    row.reserved_bytes !== "0" ||
    row.status === "receiving"
  )
    throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
}
export function createImportReceiveService(
  hooks: ReceiveTestHooks = {},
): ImportReceiveService {
  return {
    async readImportSettings(db, token, productId) {
      const id = parse(productIdSchema, productId);
      return read(db, token, async (tx) => {
        await productRow(tx, id);
        const config = await currentConfig(db);
        return {
          enabled: config.imports.enabled,
          maxArchiveBytes: MAX_ARCHIVE_BYTES,
          receiveTimeoutMs: RECEIVE_TIMEOUT_MS,
        };
      });
    },
    async readImport(db, token, productId, importId) {
      const p = parse(productIdSchema, productId),
        id = parse(importIdSchema, importId);
      return read(db, token, async (tx) => {
        await productRow(tx, p);
        return dto(await importRow(tx, p, id));
      });
    },
    async listImports(db, token, productId, query: ImportListQuery) {
      const p = parse(productIdSchema, productId),
        q = parse(importListQuerySchema, query);
      return read(db, token, async (tx) => {
        await productRow(tx, p);
        const filter = tx`product_id=${p} AND ${q.status ? tx`status=${q.status}` : tx`true`} AND ${q.idempotencyKey ? tx`idempotency_key=${q.idempotencyKey}` : tx`true`}`;
        const [count] = await tx<
          { total: number }[]
        >`SELECT count(*)::int total FROM qf.quizpack_import WHERE ${filter}`;
        const rows = await tx<
          ImportRow[]
        >`SELECT * FROM qf.quizpack_import WHERE ${filter} ORDER BY created_at DESC,id ASC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`;
        return {
          items: rows.map(dto),
          page: q.page,
          pageSize: q.pageSize,
          total: count!.total,
          hasNext: q.page * q.pageSize < count!.total,
        };
      });
    },
    async createIntent(db, c, productId, key, input: CreateImportIntent) {
      const p = parse(productIdSchema, productId),
        k = parse(idempotencyKeySchema, key),
        value = parse(createImportIntentSchema, input),
        fingerprint = intentFingerprint(p, value);
      await preflight(db, c, p);
      const lock = await StorageLock.acquire(db.config);
      try {
        await writeConfig(db, lock);
        const result = await withStudioWrite(
          db,
          c,
          "import:create",
          async (tx, actor) => {
            await activeProduct(tx, p);
            lock.assert();
            const [existing] = await tx<
              ImportRow[]
            >`SELECT * FROM qf.quizpack_import WHERE product_id=${p} AND idempotency_key=${k} FOR UPDATE`;
            if (existing) {
              if (existing.request_fingerprint !== fingerprint)
                throw new StudioError("IDEMPOTENCY_CONFLICT");
              return { row: existing, created: false };
            }
            const [count] = await tx<
              { total: number }[]
            >`SELECT count(*)::int total FROM qf.quizpack_import WHERE product_id=${p} AND (status IN ('awaiting-upload','receiving','retryable-failed') OR storage_condition<>'clean')`;
            if (count!.total >= MAX_PENDING_INTENTS)
              throw new StudioError("IMPORT_INTENT_LIMIT");
            const [row] = await tx<
              ImportRow[]
            >`WITH moment AS MATERIALIZED (SELECT clock_timestamp() at) INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,updated_at) SELECT ${randomUUID()},${p},${actor.id},${k},${fingerprint},${value.expectedArchiveSha256},${value.expectedArchiveBytes},'new-draft',at,'awaiting-upload',at FROM moment RETURNING *`;
            await audit(tx, actor, c, row!, "intent_created");
            lock.assert();
            return { row: row!, created: true };
          },
        );
        if (result.created) await hooks.afterCommit?.("intent", result.row);
        return { import: dto(result.row), created: result.created };
      } finally {
        await lock.close();
      }
    },
    async receiveArchive(
      db,
      c,
      productId,
      importId,
      source: ReceiveSource,
      context: ReceiveContext,
    ) {
      const write: typeof withStudioWrite = (
        database,
        credentials,
        capability,
        work,
      ) =>
        receiveDatabaseAwait(database, context, "write", () =>
          withStudioWrite(database, credentials, capability, work),
        );
      let lock: StorageLock | undefined,
        claimed: ImportRow | undefined,
        handle: FileHandle | undefined,
        pending: Promise<IteratorResult<Uint8Array>> | undefined;
      let inputSettled = true,
        eof = false,
        frozen = false,
        handlesSettled = true,
        fileStarted = false;
      let p = productId,
        id = importId;
      try {
        p = parse(productIdSchema, productId);
        id = parse(importIdSchema, importId);
        remainingReceiveMs(context);
        await receiveDatabaseAwait(db, context, "read", () =>
          preflight(db, c, p, id, context),
        );
        lock = await StorageLock.acquire(db.config, context);
        const config = await writeConfig(db, lock);
        const scan = await scanStorage(config, context);
        currentReceiptLimits(scan, id);
        lock.assert();
        const rows = await lock.query(heldRows(lock.connection));
        remainingReceiveMs(context);
        const existing = await receiveDatabaseAwait(db, context, "read", () =>
          read(db, c.sessionToken, async (tx) => importRow(tx, p, id), c),
        );
        if (existing.status === "received") {
          return dto(existing);
        }
        recoveryRequired(existing);
        requireReceiveCapacity(scan, id);
        if (existing.status === "rejected")
          throw new StudioError(
            "IMPORT_STATE_CONFLICT",
            existing.state_revision,
          );
        requireQuota(
          measuredQuota(scan, rows),
          attemptReservation(existing.expected_archive_bytes),
        );
        claimed = await write(db, c, "import:create", async (tx, actor) => {
          await boundedTx(tx, context, lock!);
          await activeProduct(tx, p);
          const row = await importRow(tx, p, id, true);
          recoveryRequired(row);
          canIncrement(row, true);
          if (!["awaiting-upload", "retryable-failed"].includes(row.status))
            throw new StudioError("IMPORT_STATE_CONFLICT", row.state_revision);
          if (row.attempts.length >= MAX_ATTEMPTS)
            throw new StudioError("RECEIVE_ATTEMPT_LIMIT");
          const attempt: Attempt = {
            attemptId: randomUUID(),
            fence: row.fence + 1,
            ownerPid: process.pid,
            ownerNonce: randomBytes(32).toString("base64url"),
            reservationBytes: attemptReservation(row.expected_archive_bytes),
            disposition: "held",
          };
          const [next] = await tx<
            ImportRow[]
          >`UPDATE qf.quizpack_import SET status='receiving',state_revision=state_revision+1,updated_at=clock_timestamp(),storage_condition='unknown',last_error_code=NULL,fence=fence+1,lease_until=clock_timestamp()+interval '120 seconds',current_attempt_id=${attempt.attemptId},attempts=${JSON.stringify([...row.attempts, attempt])}::text::jsonb,reserved_bytes=${attempt.reservationBytes} WHERE id=${id} RETURNING *`;
          await audit(tx, actor, c, next!, "receive_started");
          lock!.assert();
          remainingReceiveMs(context);
          return next!;
        });
        await hooks.afterCommit?.("claim", claimed);
        await hooks.afterClaim?.(claimed);
        lock.assert();
        remainingReceiveMs(context);
        const attempt = claimed.attempts.at(-1)!;
        const dir = importDirectory(config, id);
        try {
          await mkdir(dir, { mode: 0o700 });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
        await privateDirectory(dir);
        const partial = path.join(dir, `attempt-${attempt.attemptId}.partial`),
          archive = path.join(dir, "archive.quizpack");
        remainingReceiveMs(context);
        lock.assert();
        handle = await open(
          partial,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        fileStarted = true;
        const inode = await handle.stat();
        const hash = createHash("sha256");
        let bytes = 0;
        const iterator = source.chunks[Symbol.asyncIterator]();
        while (true) {
          remainingReceiveMs(context);
          lock.assert();
          inputSettled = false;
          pending = Promise.resolve().then(() => iterator.next());
          pending.then(
            () => {
              inputSettled = true;
            },
            () => {
              inputSettled = true;
            },
          );
          const chunk = await waitInput(pending, context, lock);
          pending = undefined;
          if (chunk.done) {
            eof = true;
            break;
          }
          if (!(chunk.value instanceof Uint8Array))
            throw new StudioError("INVALID_REQUEST");
          if (
            bytes + chunk.value.byteLength > claimed.expected_archive_bytes ||
            bytes + chunk.value.byteLength > MAX_ARCHIVE_BYTES
          )
            throw new StudioError("RECEIVE_LENGTH_MISMATCH");
          remainingReceiveMs(context);
          lock.assert();
          await hooks.beforeIo?.("write");
          remainingReceiveMs(context);
          lock.assert();
          // FileHandle.write can be short; account exactly what is written, loop until this chunk is settled.
          let offset = 0;
          while (offset < chunk.value.byteLength) {
            remainingReceiveMs(context);
            lock.assert();
            const written = await handle.write(
              chunk.value,
              offset,
              chunk.value.byteLength - offset,
              null,
            );
            if (written.bytesWritten <= 0) throw new Error("IO_FAILED");
            offset += written.bytesWritten;
          }
          hash.update(chunk.value);
          bytes += chunk.value.byteLength;
        }
        if (bytes !== claimed.expected_archive_bytes)
          throw new StudioError("RECEIVE_LENGTH_MISMATCH");
        const actual = hash.digest("hex");
        if (actual !== claimed.expected_archive_sha256)
          throw new StudioError("RECEIVE_HASH_MISMATCH");
        remainingReceiveMs(context);
        await hooks.beforeIo?.("sync");
        lock.assert();
        await handle.sync();
        await handle.close();
        handle = undefined;
        await lock.check();
        remainingReceiveMs(context);
        await hooks.beforeIo?.("link");
        lock.assert();
        remainingReceiveMs(context);
        await link(partial, archive);
        frozen = true;
        await hooks.beforeIo?.("unlink");
        await removeOwned(partial, inode);
        await writeStopped(config, id, attempt);
        await hooks.afterFreeze?.(claimed);
        await lock.check();
        remainingReceiveMs(context);
        const result = await write(
          db,
          c,
          "import:create",
          async (tx, actor) => {
            await boundedTx(tx, context, lock!);
            await activeProduct(tx, p);
            const row = await importRow(tx, p, id, true);
            if (
              row.fence !== claimed!.fence ||
              row.current_attempt_id !== attempt.attemptId ||
              row.status !== "receiving"
            )
              throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
            const [lease] = await tx<
              { valid: boolean }[]
            >`SELECT lease_until>clock_timestamp() valid FROM qf.quizpack_import WHERE id=${id}`;
            if (!lease?.valid)
              throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
            canIncrement(row);
            const [next] = await tx<
              ImportRow[]
            >`UPDATE qf.quizpack_import SET status='received',state_revision=state_revision+1,updated_at=clock_timestamp(),storage_condition='clean',last_error_code=NULL,lease_until=NULL,attempts=${JSON.stringify(released(row))}::text::jsonb,reserved_bytes=0,accounted_bytes=${bytes},actual_archive_bytes=${bytes},actual_archive_sha256=${actual},archive_storage_key=${`imports/${id}/archive.quizpack`},received_at=clock_timestamp() WHERE id=${id} RETURNING *`;
            await audit(tx, actor, c, next!, "receive_completed");
            lock!.assert();
            remainingReceiveMs(context);
            return next!;
          },
        );
        await hooks.afterCommit?.("complete", result);
        return dto(result);
      } catch (error) {
        const cancellation = eof || (await cancelSource(source));
        if (handle) {
          try {
            await handle.close();
          } catch {
            handlesSettled = false;
          }
          handle = undefined;
        }
        // A pending read/cancel remains owned by the adapter: no receipt and no reservation release.
        const safe = cancellation && inputSettled && handlesSettled;
        const known =
          !(error instanceof StudioError) ||
          (error.code !== "WRITE_OUTCOME_UNKNOWN" &&
            error.code !== "RECEIVE_LOCK_LOST");
        if (claimed && safe && (known || fileStarted) && lock) {
          const attempt = claimed.attempts.at(-1)!;
          try {
            await writeStopped(db.config, id, attempt);
            const code: ReceiveErrorCode = [
              "RECEIVE_TIMEOUT",
              "RECEIVE_LENGTH_MISMATCH",
              "RECEIVE_HASH_MISMATCH",
            ].includes(error instanceof StudioError ? error.code : "")
              ? ((error as StudioError).code as ReceiveErrorCode)
              : "RECEIVE_STORAGE_CONFLICT";
            // Failure bookkeeping gets fresh auth too. Timeout cleanup retains the reservation until explicit recovery.
            if (
              known &&
              !lock.controller.signal.aborted &&
              !frozen &&
              performance.now() < context.deadlineMonotonicMs &&
              !context.signal.aborted
            )
              await write(db, c, "import:create", async (tx, actor) => {
                await boundedTx(tx, context, lock!);
                await activeProduct(tx, p);
                const row = await importRow(tx, p, id, true);
                if (row.fence !== claimed!.fence)
                  throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
                canIncrement(row);
                const [next] = await tx<
                  ImportRow[]
                >`UPDATE qf.quizpack_import SET status=${code === "RECEIVE_LENGTH_MISMATCH" || code === "RECEIVE_HASH_MISMATCH" ? "rejected" : "retryable-failed"},state_revision=state_revision+1,updated_at=clock_timestamp(),storage_condition='cleanup-required',last_error_code=${code},lease_until=NULL WHERE id=${id} RETURNING *`;
                await audit(tx, actor, c, next!, "receive_failed");
                return next!;
              });
          } catch (e) {
            if (e instanceof StudioError && e.code === "WRITE_OUTCOME_UNKNOWN")
              throw e;
          }
        }
        if (error instanceof StudioError) throw error;
        throw new StudioError("RECEIVE_STORAGE_CONFLICT");
      } finally {
        if (!eof) await cancelSource(source);
        await lock?.close();
      }
    },
    async recoverReceive(
      db,
      c,
      productId,
      importId,
      input: RecoverReceive,
      context,
    ) {
      const write: typeof withStudioWrite = (
        database,
        credentials,
        capability,
        work,
      ) =>
        receiveDatabaseAwait(database, context, "write", () =>
          withStudioWrite(database, credentials, capability, work),
        );
      const p = parse(productIdSchema, productId),
        id = parse(importIdSchema, importId),
        value = parse(recoverReceiveSchema, input);
      remainingReceiveMs(context);
      const original = (await receiveDatabaseAwait(db, context, "read", () =>
        preflight(db, c, p, id, context),
      ))!;
      revisionMatches(original, value.expectedStateRevision);
      const lock = await StorageLock.acquire(db.config, context);
      try {
        const config = await writeConfig(db, lock);
        const scan = await scanStorage(config, context);
        currentReceiptLimits(scan, id);
        const rows = await lock.query(heldRows(lock.connection));
        // Recovery creates no archive/temporary bytes. Validate the bounded held ledger,
        // then permit stopped cleanup/reconciliation even when conservative headroom exceeds admission quota.
        measuredQuota(scan, rows);
        const row = await receiveDatabaseAwait(db, context, "read", () =>
          read(db, c.sessionToken, async (tx) => importRow(tx, p, id), c),
        );
        revisionMatches(row, value.expectedStateRevision);
        if (
          row.storage_condition === "clean" &&
          Number(row.reserved_bytes) === 0 &&
          row.status !== "receiving"
        )
          return dto(row);
        const held = row.attempts.filter((a) => a.disposition === "held");
        const proofs = new Map<string, boolean>();
        for (const a of row.attempts) {
          remainingReceiveMs(context);
          proofs.set(a.attemptId, await stopped(config, id, a));
        }
        for (const a of held) {
          if (!proofs.get(a.attemptId))
            throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
        }
        const claimed = await write(db, c, "import:create", async (tx) => {
          await boundedTx(tx, context, lock);
          await activeProduct(tx, p);
          const latest = await importRow(tx, p, id, true);
          revisionMatches(latest, value.expectedStateRevision);
          canIncrement(latest, true);
          const [next] = await tx<
            ImportRow[]
          >`UPDATE qf.quizpack_import SET state_revision=state_revision+1,updated_at=clock_timestamp(),fence=fence+1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=${id} RETURNING *`;
          lock.assert();
          remainingReceiveMs(context);
          return next!;
        });
        let archiveFact: { bytes: number; hash: string } | undefined;
        const files = scan.files.get(id) ?? [];
        const archive = files.find(
          (f) => path.basename(f.file) === "archive.quizpack",
        );
        if (archive) {
          archiveFact = await hashArchive(archive.file, context, () =>
            lock.check(),
          );
          if (
            archiveFact.bytes !== row.expected_archive_bytes ||
            archiveFact.hash !== row.expected_archive_sha256
          )
            throw new StudioError("RECEIVE_STORAGE_CONFLICT");
        }
        if (row.status === "rejected" && archiveFact)
          throw new StudioError("RECEIVE_STORAGE_CONFLICT");
        // Unknown partials are not ours to remove. Every deletion matches an immutable stopped attempt.
        for (const file of files) {
          const name = path.basename(file.file);
          if (name === "archive.quizpack") continue;
          const owner = row.attempts.find(
            (a) =>
              name === `attempt-${a.attemptId}.partial` ||
              name === `stopped-${a.attemptId}.json` ||
              name.startsWith(`stopped-${a.attemptId}.json.tmp-`),
          );
          if (!owner || !proofs.get(owner.attemptId))
            throw new StudioError("RECEIVE_STORAGE_CONFLICT");
          // Keep valid receipts for future retries/repeated recovery, bounded to three by the immutable ledger.
          if (name === `stopped-${owner.attemptId}.json`) continue;
          remainingReceiveMs(context);
          lock.assert();
          await hooks.beforeIo?.("unlink");
          lock.assert();
          remainingReceiveMs(context);
          await removeOwned(file.file, file.inode);
        }
        await lock.check();
        remainingReceiveMs(context);
        const result = await write(
          db,
          c,
          "import:create",
          async (tx, actor) => {
            await boundedTx(tx, context, lock);
            await activeProduct(tx, p);
            const latest = await importRow(tx, p, id, true);
            if (
              latest.fence !== claimed.fence ||
              latest.state_revision !== claimed.state_revision
            )
              throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
            const [lease] = await tx<
              { valid: boolean }[]
            >`SELECT lease_until>clock_timestamp() valid FROM qf.quizpack_import WHERE id=${id}`;
            if (!lease?.valid)
              throw new StudioError("RECEIVE_RECOVERY_REQUIRED");
            canIncrement(latest);
            const status = archiveFact
              ? "received"
              : row.status === "rejected"
                ? "rejected"
                : "awaiting-upload";
            const [next] = archiveFact
              ? await tx<
                  ImportRow[]
                >`UPDATE qf.quizpack_import SET status='received',state_revision=state_revision+1,updated_at=clock_timestamp(),storage_condition='clean',last_error_code=NULL,lease_until=NULL,attempts=${JSON.stringify(released(latest))}::text::jsonb,reserved_bytes=0,accounted_bytes=${archiveFact.bytes},actual_archive_bytes=${archiveFact.bytes},actual_archive_sha256=${archiveFact.hash},archive_storage_key=${`imports/${id}/archive.quizpack`},received_at=COALESCE(received_at,clock_timestamp()) WHERE id=${id} RETURNING *`
              : await tx<
                  ImportRow[]
                >`UPDATE qf.quizpack_import SET status=${status},state_revision=state_revision+1,updated_at=clock_timestamp(),storage_condition='clean',last_error_code=NULL,lease_until=NULL,attempts=${JSON.stringify(released(latest))}::text::jsonb,reserved_bytes=0,accounted_bytes=0 WHERE id=${id} RETURNING *`;
            await audit(tx, actor, c, next!, "receive_recovered");
            lock.assert();
            remainingReceiveMs(context);
            return next!;
          },
        );
        await hooks.afterCommit?.("recover", result);
        return dto(result);
      } finally {
        await lock.close();
      }
    },
  };
}
export const importReceiveService = createImportReceiveService();
