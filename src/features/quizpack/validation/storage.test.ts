import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  mkdir,
  rm,
  readFile,
  readdir,
  writeFile,
  symlink,
  lstat,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  type MediaOperationContext,
} from "../server/media";
import type { PrivateArchiveCandidate } from "../server/validation";
const mocks = vi.hoisted(() => ({ bytes: new WeakMap<object, Buffer[]>() }));
// The IO tests substitute only the opaque byte issuer, never a decoder or platform executor.
vi.mock("../server/validation", () => ({
  copyCandidateResourceBytes: (candidate: object, index: number) => {
    const bytes = mocks.bytes.get(candidate)?.[index];
    if (!bytes) throw new Error("UNISSUED_TEST_CANDIDATE");
    return Buffer.from(bytes);
  },
}));
import { createArchiveStorage } from "./storage";
import { ArchiveOperation } from "./operation";
import {
  ensureStorage,
  importDirectory,
  validationDirectory,
  blobPath,
} from "../import/storage";
import type { ValidationAttempt } from "./repository";
import { VALIDATION_RESERVATION_BYTES } from "./limits";
const directories: string[] = [],
  contexts: MediaOperationContext[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) disposeMediaOperationContext(ctx);
  vi.restoreAllMocks();
  for (const dir of directories.splice(0))
    await rm(dir, { recursive: true, force: true });
});
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function candidate(resources: Buffer[] = [png]): PrivateArchiveCandidate {
  const value = {
    facts: {
      resources: resources.map((bytes) => ({
        declaration: {
          path: "assets/synthetic.png",
          mediaType: "image/png",
          sha256: sha(bytes),
          bytes: bytes.length,
          width: 1,
          height: 1,
        },
        blobSha256: sha(bytes),
        bytes: bytes.length,
      })),
    },
  } as unknown as PrivateArchiveCandidate;
  mocks.bytes.set(value, resources);
  return value;
}
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
  const abort = new AbortController(),
    context = createMediaOperationContext({
      signal: abort.signal,
      deadlineMonotonicMs: performance.now() + 60000,
    });
  contexts.push(context);
  const op = new ArchiveOperation({} as P2aDatabase, context),
    id = randomUUID();
  op.enterClaimBoundary();
  op.confirmClaim();
  const attempt: ValidationAttempt = {
    attemptId: randomUUID(),
    ordinal: 1,
    fence: 1,
    ownerPid: process.pid,
    ownerNonce: randomBytes(32).toString("base64url"),
    kind: "archive",
    reservationBytes: VALIDATION_RESERVATION_BYTES,
    disposition: "held",
    mediaStop: "not-started",
  };
  return { config, op, context, abort, id, attempt };
}
it("serially reuses one partial and freezes exact bytes without clobbering existing blobs", async () => {
  const { config, op, id, attempt } = await fixture(),
    storage = createArchiveStorage(),
    source = candidate([png, Buffer.concat([png, Buffer.from("synthetic")])]);
  const first = await storage.archiveBlob(op, config, id, attempt, source, 0);
  const second = await storage.archiveBlob(op, config, id, attempt, source, 1);
  expect(first).toMatchObject({
    sha256: sha(png),
    mediaType: "image/png",
    width: 1,
    height: 1,
    frames: 1,
  });
  expect(await readFile(blobPath(config, first.sha256))).toEqual(png);
  expect(await readdir(validationDirectory(config, id))).toEqual([]);
  const original = await lstat(blobPath(config, first.sha256));
  expect(await storage.archiveBlob(op, config, id, attempt, source, 0)).toEqual(
    first,
  );
  expect((await lstat(blobPath(config, first.sha256))).ino).toBe(original.ino);
  expect(first.sha256).not.toBe(second.sha256);
  expect(op.completion().relatedIo).toBe("settled");
});
it.each(["wrong-bytes", "symlink", "directory"])(
  "existing %s target is preserved and rejected",
  async (kind) => {
    const { config, op, id, attempt } = await fixture(),
      destination = blobPath(config, sha(png));
    if (kind === "wrong-bytes")
      await writeFile(destination, Buffer.alloc(png.length), { mode: 0o600 });
    else if (kind === "symlink") await symlink("/dev/null", destination);
    else await mkdir(destination, { mode: 0o700 });
    const original = await lstat(destination);
    await expect(
      createArchiveStorage().archiveBlob(
        op,
        config,
        id,
        attempt,
        candidate(),
        0,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
    expect((await lstat(destination)).ino).toBe(original.ino);
  },
);
it.each(["write", "sync", "link", "unlink"] as const)(
  "%s failure leaves bounded owned files for explicit recovery",
  async (fault) => {
    const { config, op, id, attempt } = await fixture();
    const storage = createArchiveStorage({
      beforeIo: async (kind) => {
        if (kind === fault) throw new Error("SYNTHETIC_IO_FAULT");
      },
    });
    await expect(
      storage.archiveBlob(op, config, id, attempt, candidate(), 0),
    ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
    expect(
      (await readdir(validationDirectory(config, id))).length,
    ).toBeLessThanOrEqual(1);
    expect(op.completion().relatedIo).toBe("settled");
    if (fault === "unlink") {
      expect(await readFile(blobPath(config, sha(png)))).toEqual(png);
      expect(
        await readFile(
          path.join(
            validationDirectory(config, id),
            `attempt-${attempt.attemptId}.partial`,
          ),
        ),
      ).toEqual(png);
    }
  },
);
it("raw reader snapshots exact archive facts and closes before returning", async () => {
  const { config, op, id } = await fixture(),
    archive = Buffer.from("synthetic archive snapshot");
  await mkdir(importDirectory(config, id), { mode: 0o700 });
  await writeFile(
    path.join(importDirectory(config, id), "archive.quizpack"),
    archive,
    { mode: 0o600 },
  );
  expect(
    await createArchiveStorage().readArchive(
      op,
      config,
      id,
      archive.length,
      sha(archive),
    ),
  ).toEqual(archive);
  await expect(
    createArchiveStorage().readArchive(
      op,
      config,
      id,
      archive.length,
      "f".repeat(64),
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_STORAGE_CONFLICT" });
  expect(op.completion().relatedIo).toBe("settled");
});
it("late reader close keeps its receipt gate closed after the shared cleanup deadline", async () => {
  const { config, op, id, abort } = await fixture(),
    archive = Buffer.from("synthetic"),
    started = performance.now();
  await mkdir(importDirectory(config, id), { mode: 0o700 });
  await writeFile(
    path.join(importDirectory(config, id), "archive.quizpack"),
    archive,
    { mode: 0o600 },
  );
  let now = started;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const storage = createArchiveStorage({
    beforeIo: async (kind) => {
      if (kind === "close") {
        abort.abort();
        now += 5001;
      }
    },
  });
  await expect(
    storage.readArchive(op, config, id, archive.length, sha(archive)),
  ).rejects.toMatchObject({ code: "VALIDATION_CANCELLED" });
  await op.settle();
  expect(op.completion().relatedIo).toBe("unconfirmed");
  expect(op.canIssueStoppedReceipt()).toBe(false);
});

it("preclaim operations cannot open an archive or create a partial", async () => {
  const { config, context, id, attempt } = await fixture();
  const preclaim = new ArchiveOperation({} as P2aDatabase, context),
    beforeIo = vi.fn(async () => {}),
    storage = createArchiveStorage({ beforeIo });
  await expect(
    storage.readArchive(preclaim, config, id, png.length, sha(png)),
  ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
  await expect(
    storage.archiveBlob(preclaim, config, id, attempt, candidate(), 0),
  ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
  expect(beforeIo).not.toHaveBeenCalled();
  await expect(lstat(validationDirectory(config, id))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
