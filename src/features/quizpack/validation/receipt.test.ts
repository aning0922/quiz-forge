import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { StorageLock } from "../import/storage-lock";
import type { P2aDatabase } from "@/lib/db/client";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  type MediaOperationContext,
} from "../server/media";
import { ensureStorage, validationDirectory } from "../import/storage";
import { canonicalP1Json } from "../v1/canonical";
import { ArchiveOperation } from "./operation";
import type { ValidationAttempt } from "./repository";
import { VALIDATION_RESERVATION_BYTES } from "./limits";
const delayedClose = vi.hoisted(() => ({
  path: "",
  started: () => {},
  wait: Promise.resolve(),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (String(args[0]) === delayedClose.path) {
        delayedClose.path = "";
        const close = handle.close.bind(handle);
        handle.close = async () => {
          delayedClose.started();
          await delayedClose.wait;
          await close();
        };
      }
      return handle;
    },
  };
});
import {
  readValidationStopped,
  writeValidationStopped,
  validationFileStopPublication,
} from "./receipt";
const directories: string[] = [],
  contexts: MediaOperationContext[] = [];
afterEach(async () => {
  delayedClose.path = "";
  for (const ctx of contexts.splice(0)) disposeMediaOperationContext(ctx);
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const instanceId = randomBytes(16).toString("hex"),
    dir = path.join(process.cwd(), ".cache", "p2a", instanceId);
  await mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
  await mkdir(dir, { mode: 0o700 });
  directories.push(dir);
  const config = normalizeRuntimeConfig({
    version: 2,
    imports: { enabled: true },
    profile: "local-http-p2a",
    purpose: "test",
    origin: "http://127.0.0.1:3100",
    instanceId,
    database: {
      host: "127.0.0.1",
      port: 55422,
      name: `qf_db_${instanceId}`,
      user: `qf_app_${instanceId}`,
      password: "A".repeat(43),
    },
    server: { version: 180004, address: "127.0.0.1", port: 55422 },
  });
  await ensureStorage(config);
  const ctx = () => {
    const value = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 60000,
    });
    contexts.push(value);
    return value;
  };
  const op = new ArchiveOperation({} as P2aDatabase, ctx()),
    readOp = new ArchiveOperation({} as P2aDatabase, ctx()),
    id = randomUUID();
  op.attachLock({
    controller: new AbortController(),
    assert: () => {},
    close: async () => true,
  } as unknown as StorageLock);
  op.enterClaimBoundary();
  op.confirmClaim();
  const attempt: ValidationAttempt = {
    attemptId: randomUUID(),
    ordinal: 1,
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: randomBytes(32).toString("base64url"),
    kind: "validate",
    reservationBytes: VALIDATION_RESERVATION_BYTES,
    disposition: "held",
    mediaStop: "unconfirmed",
    fileStopProof: null,
  };
  return { config, op, readOp, id, attempt };
}
async function acknowledged(
  config: Awaited<ReturnType<typeof fixture>>["config"],
  id: string,
  attempt: ValidationAttempt,
) {
  const text = await readFile(
    path.join(
      validationDirectory(config, id),
      `stopped-${attempt.attemptId}.json`,
    ),
    "utf8",
  );
  const value = JSON.parse(text);
  const fields = {
    validationId: value.validationId,
    attemptId: value.attemptId,
    fence: value.fence,
    ownerPid: value.ownerPid,
    ownerNonce: value.ownerNonce,
    scope: value.scope,
    mediaStopped: value.mediaStopped,
    relatedIo: value.relatedIo,
  };
  return {
    ...attempt,
    mediaStop: fields.mediaStopped,
    fileStopProof: {
      ...fields,
      schemaVersion: "quizpack-validation-file-stop-proof.v1" as const,
      protocol: "candidate-receipt-db-ack.v1" as const,
      receiptSha256: createHash("sha256").update(text).digest("hex"),
    },
  };
}
it("known pre-candidate stop publishes immutable exact receipt under the existing cleanup budget", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  op.stop();
  await op.settle();
  expect(await writeValidationStopped(op, config, id, attempt)).toBe(true);
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  const receipt = await readValidationStopped(
    readOp,
    config,
    id,
    await acknowledged(config, id, attempt),
  );
  expect(receipt).toMatchObject({
    validationId: id,
    attemptId: attempt.attemptId,
    ownerNonce: attempt.ownerNonce,
    mediaStopped: "not-started",
    relatedIo: "settled",
  });
  expect(await readdir(validationDirectory(config, id))).toEqual([
    `stopped-${attempt.attemptId}.json`,
  ]);
  const before = await readFile(
    path.join(
      validationDirectory(config, id),
      `stopped-${attempt.attemptId}.json`,
    ),
  );
  expect(await writeValidationStopped(op, config, id, attempt)).toBe(false);
  expect(
    await readFile(
      path.join(
        validationDirectory(config, id),
        `stopped-${attempt.attemptId}.json`,
      ),
    ),
  ).toEqual(before);
});
it("media UNKNOWN or unresolved candidate cannot create receipt or directory", async () => {
  const { config, op, id, attempt } = await fixture();
  op.enterCandidateBoundary();
  op.stop();
  await op.settle();
  expect(await writeValidationStopped(op, config, id, attempt)).toBe(false);
  await expect(readdir(validationDirectory(config, id))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it.each(["fence", "nonce", "validation", "oversized", "duplicate"])(
  "%s receipt cannot prove this immutable attempt",
  async (fault) => {
    const { config, op, readOp, id, attempt } = await fixture();
    op.stop();
    await op.settle();
    await writeValidationStopped(op, config, id, attempt);
    const file = path.join(
      validationDirectory(config, id),
      `stopped-${attempt.attemptId}.json`,
    );
    const ack = await acknowledged(config, id, attempt);
    const text = await readFile(file, "utf8"),
      value = JSON.parse(text) as Record<string, unknown>;
    if (fault === "fence") value.fence = 2;
    if (fault === "nonce") value.ownerNonce = "A".repeat(43);
    if (fault === "validation") value.validationId = randomUUID();
    await writeFile(
      file,
      fault === "oversized"
        ? "x".repeat(2049)
        : fault === "duplicate"
          ? text.replace('"fence":1', '"fence":2,"fence":1')
          : canonicalP1Json(value),
    );
    await expect(
      readValidationStopped(readOp, config, id, ack),
    ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
  },
);
it("strict completion preserves confirmed media and never substitutes owner absence", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  op.enterCandidateBoundary();
  op.recordPlatformCompletion({
    mediaStopped: "confirmed",
    relatedIo: "settled",
    maintenanceRequired: false,
  });
  op.stop();
  await op.settle();
  expect(await writeValidationStopped(op, config, id, attempt)).toBe(true);
  expect(
    (
      await readValidationStopped(
        readOp,
        config,
        id,
        await acknowledged(config, id, attempt),
      )
    )?.mediaStopped,
  ).toBe("confirmed");
  const missing = { ...attempt, attemptId: randomUUID(), ownerPid: 2147483647 };
  expect(await readValidationStopped(readOp, config, id, missing)).toBeNull();
});

it("an exposed candidate cannot authorize release while the publisher's final directory close is pending", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  let release: () => void = () => {},
    started: () => void = () => {};
  delayedClose.wait = new Promise<void>((r) => {
    release = r;
  });
  const observed = new Promise<void>((r) => {
    started = r;
  });
  delayedClose.started = started;
  delayedClose.path = validationDirectory(config, id);
  op.closeNonDbGate();
  await op.settle();
  const task = writeValidationStopped(op, config, id, attempt);
  await observed;
  expect((await readdir(validationDirectory(config, id))).length).toBe(1);
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  expect(() => validationFileStopPublication(op, id, attempt)).toThrow();
  expect(op.completion().relatedIo).toBe("unconfirmed");
  release();
  expect(await task).toBe(true);
  const published = validationFileStopPublication(op, id, attempt);
  expect(() => JSON.stringify(published)).toThrow();
  expect(published.proof.mediaStopped).toBe("not-started");
  await op.acknowledgeDatabaseOnce(published.qualification, async () => {});
  const ack = {
    ...attempt,
    mediaStop: published.proof.mediaStopped,
    fileStopProof: published.proof,
  };
  expect(await readValidationStopped(readOp, config, id, ack)).toEqual(
    published.proof,
  );
});
it("cleanup candidate and historical v1 files have no ACK authority", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  op.stop("CANCELLED");
  await op.settle();
  await writeValidationStopped(op, config, id, attempt);
  expect(() => validationFileStopPublication(op, id, attempt)).toThrow();
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  const ack = await acknowledged(config, id, attempt),
    file = path.join(
      validationDirectory(config, id),
      `stopped-${attempt.attemptId}.json`,
    );
  const value = JSON.parse(await readFile(file, "utf8"));
  value.schemaVersion = "quizpack-validation-stopped.v1";
  await writeFile(file, canonicalP1Json(value));
  await expect(
    readValidationStopped(readOp, config, id, ack),
  ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
});
it("UNKNOWN after candidate exposure leaves no usable publication handle or release authority", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  let release: () => void = () => {},
    started: () => void = () => {};
  delayedClose.wait = new Promise<void>((r) => {
    release = r;
  });
  const observed = new Promise<void>((r) => {
    started = r;
  });
  delayedClose.started = started;
  delayedClose.path = validationDirectory(config, id);
  op.closeNonDbGate();
  await op.settle();
  const task = writeValidationStopped(op, config, id, attempt),
    failure = expect(task).rejects.toMatchObject({
      code: "VALIDATION_RECOVERY_REQUIRED",
    });
  await observed;
  op.stop("STOP_UNCONFIRMED");
  release();
  await failure;
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  expect(() => validationFileStopPublication(op, id, attempt)).toThrow();
  expect(op.completion()).toEqual({
    mediaStopped: "unknown",
    relatedIo: "unconfirmed",
    maintenanceRequired: true,
  });
});
