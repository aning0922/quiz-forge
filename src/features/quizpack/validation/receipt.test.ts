import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
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
import { readValidationStopped, writeValidationStopped } from "./receipt";
const directories: string[] = [],
  contexts: MediaOperationContext[] = [];
afterEach(async () => {
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
  };
  return { config, op, readOp, id, attempt };
}
it("known pre-candidate stop publishes immutable exact receipt under the existing cleanup budget", async () => {
  const { config, op, readOp, id, attempt } = await fixture();
  expect(await readValidationStopped(readOp, config, id, attempt)).toBeNull();
  op.stop();
  await op.settle();
  expect(await writeValidationStopped(op, config, id, attempt)).toBe(true);
  const receipt = await readValidationStopped(readOp, config, id, attempt);
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
      readValidationStopped(readOp, config, id, attempt),
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
    (await readValidationStopped(readOp, config, id, attempt))?.mediaStopped,
  ).toBe("confirmed");
  const missing = { ...attempt, attemptId: randomUUID(), ownerPid: 2147483647 };
  expect(await readValidationStopped(readOp, config, id, missing)).toBeNull();
});
