import {
  type Stats,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { mediaCapabilitySchema } from "../../../src/features/quizpack/server/media/internal/capability";
import {
  fixedMediaPlatformRoles,
  type MediaRuntimeRoots,
} from "../../../src/features/quizpack/server/media/internal/runtime-location";
import { mediaRuntimeBindingSchema } from "../../../src/features/quizpack/server/media/evidence";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
} from "../../../src/features/quizpack/server/media/operation-context";
import {
  assertControlEmpty,
  consumeOfflineCandidateReceipt,
  MATRIX_CASES,
  matrixCodeHash,
  OFFLINE_LIMITS,
  ownedMatrixSchema,
  ProvisionError,
  readFreshSealIdentity,
  runOfflineCandidateMatrix,
  runtimeCheckpoint,
  type OfflineCandidateReceipt,
  type OfflineMatrixEvidence,
  type RuntimeTarget,
} from "./runtime";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const candidateRecordSchema = z
  .strictObject({
    schema: z.literal("quizpack-media-candidate-record.v1"),
    mode: z.literal("offline-exclusive"),
    target: z.enum(["main", "fixture"]),
    binding: mediaRuntimeBindingSchema,
    profileId: hash,
    sourceBundleHash: hash,
    matrixCodeHash: hash,
    registryVersion: z.literal("quizpack-media-matrix-registry.v1"),
    rounds: z.array(ownedMatrixSchema).min(2).max(3),
    ownedOperationsStopped: z.literal(true),
    controlEmpty: z.literal(true),
  })
  .superRefine((value, ctx) => {
    const expected =
      value.binding.platform === "darwin-arm64"
        ? ["macos", "macos", "macos"]
        : ["linux-smoke", "linux-lifecycle"];
    if (value.rounds.length !== expected.length)
      ctx.addIssue({ code: "custom", message: "MATRIX_PLAN_INVALID" });
    value.rounds.forEach((round, i) => {
      const ids = round.cases.map((c) => c.id).sort();
      if (
        round.matrix !== expected[i] ||
        round.target !== value.target ||
        round.profiles.normal !== value.profileId ||
        !round.completed ||
        !round.ownedOperationsStopped ||
        round.residualControlEntries !== 0 ||
        round.cases.some((c) => !c.passed) ||
        ids.length !== MATRIX_CASES[round.matrix].length ||
        ids.some((id, j) => id !== MATRIX_CASES[round.matrix][j])
      )
        ctx.addIssue({ code: "custom", message: "MATRIX_EVIDENCE_INVALID" });
    });
  });

class PrivateWriteError extends ProvisionError {
  constructor(readonly committed: boolean) {
    super("WRITE_FAILED");
  }
}
/** No directories are created or permissions repaired during sealing. Setup owns preparation. */
function privateDirectory(path: string) {
  const st = lstatSync(path);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.uid !== process.getuid?.() ||
    (st.mode & 0o777) !== 0o700 ||
    realpathSync(path) !== path
  )
    throw new ProvisionError("IO_UNSAFE");
  return st;
}
function existingPrivateFile(path: string, maximum: number) {
  try {
    const st = lstatSync(path);
    if (
      !st.isFile() ||
      st.isSymbolicLink() ||
      st.nlink !== 1 ||
      st.uid !== process.getuid?.() ||
      (st.mode & 0o777) !== 0o600 ||
      st.size > maximum
    )
      throw new ProvisionError("IO_UNSAFE");
    return st;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function sameFile(a: Stats | null, b: Stats | null) {
  return a === null
    ? b === null
    : b !== null &&
        a.dev === b.dev &&
        a.ino === b.ino &&
        a.size === b.size &&
        a.mtimeMs === b.mtimeMs;
}
function atomicPrivateWrite(
  path: string,
  bytes: Buffer,
  maximum: number,
  checkpoint: () => void,
): void {
  let temporary: string | null = null,
    fd: number | undefined,
    directoryFd: number | undefined,
    ownFile: Stats | undefined,
    committed = false;
  try {
    checkpoint();
    if (!bytes.length || bytes.length > maximum)
      throw new ProvisionError("IO_UNSAFE");
    const directory = dirname(path),
      before = privateDirectory(directory),
      previous = existingPrivateFile(path, maximum);
    directoryFd = openSync(
      directory,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
    );
    const opened = fstatSync(directoryFd);
    if (before.dev !== opened.dev || before.ino !== opened.ino)
      throw new ProvisionError("IO_UNSAFE");
    temporary = join(directory, `.provision-${randomUUID()}.tmp`);
    fd = openSync(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    const own = fstatSync(fd);
    ownFile = own;
    if (
      !own.isFile() ||
      own.nlink !== 1 ||
      own.uid !== process.getuid?.() ||
      (own.mode & 0o777) !== 0o600
    )
      throw new ProvisionError("IO_UNSAFE");
    let offset = 0;
    while (offset < bytes.length) {
      checkpoint();
      const count = writeSync(fd, bytes, offset, bytes.length - offset);
      if (count <= 0) throw new ProvisionError("WRITE_FAILED");
      offset += count;
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    checkpoint();
    const after = privateDirectory(directory),
      temp = lstatSync(temporary);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      own.dev !== temp.dev ||
      own.ino !== temp.ino ||
      temp.size !== bytes.length ||
      !sameFile(previous, existingPrivateFile(path, maximum))
    )
      throw new ProvisionError("IO_UNSAFE");
    renameSync(temporary, path);
    committed = true;
    temporary = null;
    fsyncSync(directoryFd);
  } catch (error) {
    if (!committed && error instanceof ProvisionError) throw error;
    throw new PrivateWriteError(committed);
  } finally {
    let cleanupFailed = false;
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        cleanupFailed = true;
      }
    }
    if (directoryFd !== undefined) {
      try {
        closeSync(directoryFd);
      } catch {
        cleanupFailed = true;
      }
    }
    if (temporary) {
      try {
        const current = lstatSync(temporary);
        if (
          ownFile &&
          ownFile.dev === current.dev &&
          ownFile.ino === current.ino
        )
          unlinkSync(temporary);
      } catch {
        /* Only this call's random exclusive temporary file is eligible for cleanup. */
      }
    }
    if (cleanupFailed) throw new PrivateWriteError(committed);
  }
}

/** Audit-only output. It cannot mint or recover a receipt and cannot write capability.json. */
export function writeCandidateAuditRecord(
  roots: MediaRuntimeRoots,
  evidence: OfflineMatrixEvidence,
  checkpoint: () => void,
): void {
  const parsed = candidateRecordSchema.safeParse(evidence);
  if (!parsed.success) throw new ProvisionError("MATRIX_PROTOCOL_INVALID");
  const roles = fixedMediaPlatformRoles(roots, parsed.data.binding.platform);
  privateDirectory(join(roots.checkoutRoot, ".cache/quizpack-media-runtime"));
  atomicPrivateWrite(
    join(roles.stateRoot, "candidate-record.json"),
    Buffer.from(JSON.stringify(parsed.data)),
    OFFLINE_LIMITS.recordBytes,
    checkpoint,
  );
}

export type SealResult =
  | Readonly<{
      outcome: "sealed";
      capabilityCommitted: true;
      recordCommitted: true;
      target: RuntimeTarget;
      deploymentId: string;
      runtimeBundleHash: string;
    }>
  | Readonly<{
      outcome: "failed";
      code: ProvisionError["code"];
      capabilityCommitted: boolean;
      recordCommitted: boolean;
    }>;

/** Requires offline-exclusive execution with no normal service. Empty control is a
 * point-in-time observation, not a concurrent lease or permanent stop guarantee.
 * Serialized audit files cannot recover authority. No control records are removed. */
export async function sealOfflineCandidate(
  receipt: OfflineCandidateReceipt,
  signal = new AbortController().signal,
): Promise<SealResult> {
  let recordCommitted = false,
    capabilityCommitted = false;
  let context: ReturnType<typeof createMediaOperationContext> | undefined;
  try {
    const authority = consumeOfflineCandidateReceipt(receipt);
    const { roots, evidence } = authority;
    context = createMediaOperationContext({
      signal,
      deadlineMonotonicMs: authority.expiresAtMonotonicMs,
    });
    const checkpoint = () => {
      runtimeCheckpoint(context!);
      if (performance.now() >= authority.expiresAtMonotonicMs)
        throw new ProvisionError("RECEIPT_EXPIRED");
    };
    checkpoint();
    const fresh = await readFreshSealIdentity(roots, context);
    if (
      JSON.stringify(fresh.binding) !== JSON.stringify(evidence.binding) ||
      fresh.profileId !== evidence.profileId ||
      fresh.deployment.sourceBundleHash !== evidence.sourceBundleHash ||
      (await matrixCodeHash(roots, checkpoint)) !== evidence.matrixCodeHash
    )
      throw new ProvisionError("IDENTITY_CHANGED");
    await assertControlEmpty(roots, evidence.binding.platform, checkpoint);
    writeCandidateAuditRecord(roots, evidence, checkpoint);
    recordCommitted = true;
    await assertControlEmpty(roots, evidence.binding.platform, checkpoint);
    const capability = mediaCapabilitySchema.parse({
      schema: "quizpack-media-capability.v1",
      platform: fresh.binding.platform,
      componentId: fresh.binding.componentId,
      deploymentId: fresh.binding.deploymentId,
      runtimeBundleHash: fresh.binding.runtimeBundleHash,
      limitsHash: fresh.binding.limitsHash,
      profileId: fresh.profileId,
    });
    const roles = fixedMediaPlatformRoles(roots, fresh.binding.platform);
    // Final synchronous check and rename share one local turn; root serializes native provisioning.
    checkpoint();
    atomicPrivateWrite(
      roles.capability,
      Buffer.from(JSON.stringify(capability)),
      OFFLINE_LIMITS.capabilityBytes,
      checkpoint,
    );
    capabilityCommitted = true;
    return Object.freeze({
      outcome: "sealed",
      capabilityCommitted: true,
      recordCommitted: true,
      target: evidence.target,
      deploymentId: fresh.binding.deploymentId,
      runtimeBundleHash: fresh.binding.runtimeBundleHash,
    });
  } catch (error) {
    if (error instanceof PrivateWriteError && error.committed) {
      if (recordCommitted) capabilityCommitted = true;
      else recordCommitted = true;
    }
    return Object.freeze({
      outcome: "failed",
      code: error instanceof ProvisionError ? error.code : "WRITE_FAILED",
      capabilityCommitted,
      recordCommitted,
    });
  } finally {
    if (context) disposeMediaOperationContext(context);
  }
}

/** CLI entry keeps actual matrix execution, receipt issuance and seal in one call chain. */
export async function provisionOfflineRuntime(
  target: RuntimeTarget,
  signal = new AbortController().signal,
): Promise<SealResult> {
  try {
    return await sealOfflineCandidate(
      await runOfflineCandidateMatrix(target, signal),
      signal,
    );
  } catch (error) {
    return Object.freeze({
      outcome: "failed",
      code:
        error instanceof ProvisionError
          ? error.code
          : "MATRIX_STOP_UNCONFIRMED",
      capabilityCommitted: false,
      recordCommitted: false,
    });
  }
}
