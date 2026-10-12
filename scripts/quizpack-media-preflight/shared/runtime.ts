import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { open, opendir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { parseFoundationJson } from "../../../src/lib/foundation-json";
import {
  verifyMediaDeployment,
  type MediaDeploymentSummary,
} from "../../../src/lib/build/media-deployment";
import { createTrustedMediaRuntime } from "../../../src/features/quizpack/server/media/internal/runtime";
import {
  fixedMediaPlatformRoles,
  type MediaRuntimeRoots,
} from "../../../src/features/quizpack/server/media/internal/runtime-location";
import { mediaRuntimeBindingSchema } from "../../../src/features/quizpack/server/media/evidence";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
} from "../../../src/features/quizpack/server/media/operation-context";
import type {
  MediaOperationContext,
  MediaRuntimeBinding,
} from "../../../src/features/quizpack/server/media/contracts";

export const MATRIX_CASES = Object.freeze({
  macos: Object.freeze([
    "+1 bytes/dimension/pixel-height rejected before launch",
    "8192 exact dimension",
    "8MiB exact resource complete decode",
    "bad pixels with intact signature and declared hash rejected",
    "bounded fault backpressure",
    "bounded fault bom",
    "bounded fault crash",
    "bounded fault extra",
    "bounded fault invalid",
    "bounded fault multiple",
    "bounded fault nonzero",
    "bounded fault stderr",
    "bounded fault stdout",
    "bounded fault success-hang",
    "complete jpeg 16MP boundary",
    "complete jpeg 64x48 decode",
    "complete png 16MP boundary",
    "complete png 64x48 decode",
    "complete webp 16MP boundary",
    "complete webp 64x48 decode",
    "credential environment is not inherited",
    "event-loop timer delayed cannot produce late success",
    "failed final capability check preserves prior seal",
    "full native FD scan and actual read/write on absent FD3",
    "host inherited FD300 is absent in the actual fixed launcher worker",
    "issued fsync abort cannot launch after interruption",
    "issued fsync deadline cannot launch after interruption",
    "kernel identity query errors cannot become absent",
    "kernel peak RSS two fresh workers per 16MP format",
    "missing control helper does not launch or fall back",
    "native FD300 injection is detected and ordinary launcher inherits none",
    "native file open/link/rename/unlink PGDATA direct",
    "native file open/link/rename/unlink PGDATA dots",
    "native file open/link/rename/unlink PGDATA hardlink",
    "native file open/link/rename/unlink PGDATA symlink",
    "native file open/link/rename/unlink admin direct",
    "native file open/link/rename/unlink admin dots",
    "native file open/link/rename/unlink admin hardlink",
    "native file open/link/rename/unlink admin symlink",
    "native file open/link/rename/unlink runtime direct",
    "native file open/link/rename/unlink runtime dots",
    "native file open/link/rename/unlink runtime hardlink",
    "native file open/link/rename/unlink runtime symlink",
    "native file open/link/rename/unlink uploads direct",
    "native file open/link/rename/unlink uploads dots",
    "native file open/link/rename/unlink uploads hardlink",
    "native file open/link/rename/unlink uploads symlink",
    "native normal thread allowed fork/spawn/vfork denied",
    "native real TCP/Unix peers and bind/listen denial",
    "native synthetic Mach/shm/signal delegation denied",
    "parent crash leaves persisted worker identity and restart blocked",
    "policy identity stable across runIds and deadlines",
    "pre-start cancel and expired absolute deadline",
    "public API requires frozen component identity",
    "repeated abort stops actual worker and settles stdio",
    "restart blocks fifo control state",
    "restart blocks guard control state",
    "restart blocks malformed control state",
    "restart blocks oversize control state",
    "restart blocks partial control state",
    "restart blocks symlink control state",
    "same initial executable posix_spawn is denied",
    "sandbox-exec execs fixed worker in same owned PID",
    "second call rejected BUSY by persistent control guard",
    "unknown stop keeps guard and blocks restart after late close",
    "unsupported Node metadata is closed before platform operation",
  ] as const),
  "linux-smoke": Object.freeze([
    "abort-during-worker",
    "busy",
    "bytes-plus-one",
    "cancel-before-start",
    "deadline-before-start",
    "decode-corrupt-pixels",
    "decode-exact-8MiB",
    "decode-jpeg-512x768",
    "decode-png-2x2",
    "decode-png-4000x4000",
    "decode-png-8192x1",
    "decode-webp-1024x512",
    "fault-backpressure",
    "fault-bad-json",
    "fault-crash",
    "fault-invalid-utf8",
    "fault-multi-json",
    "fault-nonzero",
    "fault-oom",
    "fault-stderr",
    "fault-stdout",
    "fault-success-hang",
    "fixed-control-clean",
    "image-native-identity",
    "native-files-network-ipc-process-thread-fd",
    "native-host-control",
    "native-memory-and-enforced-cgroup",
    "png-animation-precheck",
    "posix-fd",
    "posix-network",
    "posix-process",
  ] as const),
  "linux-lifecycle": Object.freeze([
    "actual-identity-mismatch",
    "attach-cli-loss",
    "crashed-before-start-own-stop",
    "crashed-parent-restart-blocked",
    "daemon-unavailable-retained",
    "identity-restored-explicit-stop",
    "lifecycle-control-clean",
    "lose-create-response",
    "lose-stop-response",
    "same-object-explicit-stop",
    "start-inflight-recovery-refused",
  ] as const),
});

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const targetSchema = z.enum(["main", "fixture"]);
export type RuntimeTarget = z.infer<typeof targetSchema>;
export const OFFLINE_LIMITS = Object.freeze({
  matrixBytes: 32 * 1024,
  recordBytes: 32 * 1024,
  capabilityBytes: 16 * 1024,
  operationMs: 30 * 60 * 1000,
  childCleanupMs: 5000,
  receiptAgeMs: 60 * 1000,
});
export class ProvisionError extends Error {
  constructor(
    readonly code:
      | "INVALID_TARGET"
      | "UNSUPPORTED_PLATFORM"
      | "IO_UNSAFE"
      | "DEPLOYMENT_INVALID"
      | "BINDING_UNAVAILABLE"
      | "IDENTITY_CHANGED"
      | "CONTROL_NOT_EMPTY"
      | "MATRIX_PROTOCOL_INVALID"
      | "MATRIX_FAILED"
      | "MATRIX_STOP_UNCONFIRMED"
      | "INTERRUPTED"
      | "RECEIPT_INVALID"
      | "RECEIPT_EXPIRED"
      | "WRITE_FAILED",
  ) {
    super(code);
  }
}
const caseSchema = z.strictObject({
  id: z.string().min(1).max(256),
  passed: z.boolean(),
});
const common = {
  schema: z.literal("quizpack-media-owned-matrix.v1"),
  target: targetSchema,
  completed: z.boolean(),
  cases: z.array(caseSchema).max(66),
  ownedOperationsStopped: z.boolean(),
  residualControlEntries: z.number().int().min(0).max(16),
};
export const ownedMatrixSchema = z.discriminatedUnion("matrix", [
  z.strictObject({
    ...common,
    matrix: z.literal("macos"),
    profiles: z.strictObject({
      normal: hash,
      fault: hash,
      posixProbe: hash,
      macProbe: hash,
    }),
  }),
  z.strictObject({
    ...common,
    matrix: z.literal("linux-smoke"),
    profiles: z.strictObject({
      normal: hash,
      fault: hash,
      posixProbe: hash,
      nativeProbe: hash,
    }),
  }),
  z.strictObject({
    ...common,
    matrix: z.literal("linux-lifecycle"),
    profiles: z.strictObject({
      normal: hash,
      fault: hash,
      posixProbe: hash,
      nativeProbe: hash,
    }),
  }),
]);
export type OwnedMatrix = z.infer<typeof ownedMatrixSchema>;
type MatrixName = OwnedMatrix["matrix"];
const eventSchema = z.strictObject({
  case: z.string().min(1).max(256),
  passed: z.boolean(),
});

/** Finite protocol parser is evidence validation, never receipt authority. */
export function parseOwnedMatrix(
  bytes: Uint8Array,
  matrix: MatrixName,
  target: RuntimeTarget,
): OwnedMatrix {
  try {
    if (!bytes.byteLength || bytes.byteLength > OFFLINE_LIMITS.matrixBytes)
      throw 0;
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const lines = text.split("\n");
    if (lines.pop() !== "" || lines.length !== MATRIX_CASES[matrix].length + 1)
      throw 0;
    const last = lines.pop();
    if (!last) throw 0;
    const result = ownedMatrixSchema.parse(parseFoundationJson(last));
    if (result.matrix !== matrix || result.target !== target) throw 0;
    const events = lines.map((line) =>
      eventSchema.parse(parseFoundationJson(line)),
    );
    if (
      events.length !== result.cases.length ||
      events.some(
        (e, i) =>
          e.case !== result.cases[i]?.id ||
          e.passed !== result.cases[i]?.passed,
      )
    )
      throw 0;
    const ids = result.cases.map((c) => c.id).sort();
    if (
      ids.length !== MATRIX_CASES[matrix].length ||
      ids.some((id, i) => id !== MATRIX_CASES[matrix][i])
    )
      throw 0;
    return result;
  } catch {
    throw new ProvisionError("MATRIX_PROTOCOL_INVALID");
  }
}

export function offlineRuntimeRoots(target: RuntimeTarget): MediaRuntimeRoots {
  if (!targetSchema.safeParse(target).success)
    throw new ProvisionError("INVALID_TARGET");
  const checkoutRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
  );
  const deploymentRoot = join(
    checkoutRoot,
    target === "main" ? ".next" : ".cache/quizpack-media-next-fixture/.next",
  );
  try {
    if (
      realpathSync(checkoutRoot) !== checkoutRoot ||
      realpathSync(deploymentRoot) !== deploymentRoot
    )
      throw 0;
    return Object.freeze({ checkoutRoot, deploymentRoot });
  } catch {
    throw new ProvisionError("DEPLOYMENT_INVALID");
  }
}

/** Read-only inspection. Unknown entries, symlinks, wrong ownership or permissions are never empty. */
export async function assertControlEmpty(
  roots: MediaRuntimeRoots,
  platform: MediaRuntimeBinding["platform"],
  checkpoint: () => void,
): Promise<void> {
  const roles = fixedMediaPlatformRoles(roots, platform);
  try {
    for (const path of [
      join(roots.checkoutRoot, ".cache"),
      join(roots.checkoutRoot, ".cache/quizpack-media-runtime"),
      roles.stateRoot,
      roles.controlRoot,
    ]) {
      checkpoint();
      const st = lstatSync(path);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== process.getuid?.() ||
        (path !== join(roots.checkoutRoot, ".cache") &&
          (st.mode & 0o777) !== 0o700)
      )
        throw 0;
      if (realpathSync(path) !== path) throw 0;
    }
    const before = lstatSync(roles.controlRoot);
    const directory = await opendir(roles.controlRoot);
    try {
      checkpoint();
      if (await directory.read()) throw 0;
    } finally {
      await directory.close();
    }
    checkpoint();
    const after = lstatSync(roles.controlRoot);
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs
    )
      throw 0;
    checkpoint();
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("CONTROL_NOT_EMPTY");
  }
}

/** Hash the offline execution closure independently of the deployment artifact closure. */
export async function matrixCodeHash(
  roots: MediaRuntimeRoots,
  checkpoint: () => void,
): Promise<string> {
  const inventory: { path: string; bytes: number; sha256: string }[] = [];
  let total = 0,
    entries = 0;
  const base = join(roots.checkoutRoot, "scripts/quizpack-media-preflight");
  async function walk(relative: string, depth: number): Promise<void> {
    checkpoint();
    if (depth > 8) throw new ProvisionError("IO_UNSAFE");
    const path = join(base, relative);
    const dir = lstatSync(path);
    if (
      !dir.isDirectory() ||
      dir.isSymbolicLink() ||
      realpathSync(path) !== path
    )
      throw new ProvisionError("IO_UNSAFE");
    const handle = await opendir(path);
    try {
      for await (const entry of handle) {
        checkpoint();
        if (++entries > 256) throw new ProvisionError("IO_UNSAFE");
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(child, depth + 1);
          continue;
        }
        if (entry.isSymbolicLink() || !entry.isFile())
          throw new ProvisionError("IO_UNSAFE");
        if (child.endsWith(".test.ts")) continue;
        if (
          !/\.(ts|mjs|json|c|h|sh)$/.test(child) &&
          entry.name !== "Dockerfile"
        )
          throw new ProvisionError("IO_UNSAFE");
        const fd = await open(
          join(base, child),
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const before = await fd.stat();
          if (
            !before.isFile() ||
            before.size > 1024 * 1024 ||
            inventory.length >= 128
          )
            throw new ProvisionError("IO_UNSAFE");
          const bytes = Buffer.alloc(before.size + 1);
          let size = 0;
          for (;;) {
            checkpoint();
            const read = await fd.read(bytes, size, bytes.length - size, null);
            if (!read.bytesRead) break;
            size += read.bytesRead;
            if (size > before.size) throw new ProvisionError("IO_UNSAFE");
          }
          const after = await fd.stat();
          if (
            size !== before.size ||
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.mtimeMs !== after.mtimeMs ||
            (total += size) > 16 * 1024 * 1024
          )
            throw new ProvisionError("IO_UNSAFE");
          inventory.push({
            path: child,
            bytes: size,
            sha256: createHash("sha256")
              .update(bytes.subarray(0, size))
              .digest("hex"),
          });
        } finally {
          await fd.close();
        }
      }
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
    const after = lstatSync(path);
    if (
      dir.dev !== after.dev ||
      dir.ino !== after.ino ||
      dir.mtimeMs !== after.mtimeMs
    )
      throw new ProvisionError("IO_UNSAFE");
  }
  try {
    await walk("", 0);
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("IO_UNSAFE");
  }
  inventory.sort((a, b) => a.path.localeCompare(b.path, "en"));
  const result = createHash("sha256")
    .update(
      JSON.stringify({ schema: "quizpack-media-matrix-code.v1", inventory }),
    )
    .digest("hex");
  checkpoint();
  return result;
}

export function runtimeCheckpoint(context: MediaOperationContext): void {
  if (readMediaOperationState(context).phase !== "active")
    throw new ProvisionError("INTERRUPTED");
}
export async function readFreshSealIdentity(
  roots: MediaRuntimeRoots,
  context: MediaOperationContext,
): Promise<{
  binding: MediaRuntimeBinding;
  profileId: string;
  deployment: MediaDeploymentSummary;
}> {
  const checkpoint = () => runtimeCheckpoint(context);
  const deployment = await verifyMediaDeployment(roots, {
    deadlineMonotonicMs: context.deadlineMonotonicMs,
    signal: context.signal,
    checkpoint,
  });
  if (!deployment.ok) throw new ProvisionError("DEPLOYMENT_INVALID");
  const result = await createTrustedMediaRuntime(roots)
    .readSealCandidate(context)
    .catch(() => {
      throw new ProvisionError("MATRIX_STOP_UNCONFIRMED");
    });
  const identityResult = z
    .discriminatedUnion("outcome", [
      z.strictObject({
        outcome: z.literal("bound"),
        binding: mediaRuntimeBindingSchema,
        profileId: hash,
      }),
      z.strictObject({
        outcome: z.literal("unavailable"),
        code: z.enum([
          "INVALID_INPUT",
          "CANCELLED",
          "DEADLINE_EXCEEDED",
          "UNSUPPORTED_PLATFORM",
          "ISOLATION_UNAVAILABLE",
          "WORKER_FAILED",
          "STOP_UNCONFIRMED",
        ]),
      }),
    ])
    .safeParse(result);
  if (!identityResult.success)
    throw new ProvisionError("MATRIX_STOP_UNCONFIRMED");
  // Preserve a finite unknown result before observing interruption.
  if (identityResult.data.outcome === "unavailable")
    throw new ProvisionError(
      identityResult.data.code === "STOP_UNCONFIRMED"
        ? "MATRIX_STOP_UNCONFIRMED"
        : "BINDING_UNAVAILABLE",
    );
  const parsed = z
    .strictObject({
      outcome: z.literal("bound"),
      binding: mediaRuntimeBindingSchema,
      profileId: hash,
    })
    .safeParse(result);
  if (!parsed.success) throw new ProvisionError("MATRIX_STOP_UNCONFIRMED");
  checkpoint();
  return {
    binding: parsed.data.binding,
    profileId: parsed.data.profileId,
    deployment: deployment.summary,
  };
}

function runOwnedMatrix(
  roots: MediaRuntimeRoots,
  matrix: MatrixName,
  target: RuntimeTarget,
  context: MediaOperationContext,
): Promise<OwnedMatrix> {
  runtimeCheckpoint(context);
  const script =
    matrix === "macos"
      ? "macos/harness.ts"
      : matrix === "linux-smoke"
        ? "linux/harness.mjs"
        : "linux/lifecycle-harness.mjs";
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        join(roots.checkoutRoot, "scripts/quizpack-media-preflight", script),
        `--runtime-target=${target}`,
      ],
      { cwd: roots.checkoutRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0,
      stderr = 0,
      failure: ProvisionError | null = null,
      finished = false;
    let cleanup: NodeJS.Timeout | undefined;
    const stop = (code: ProvisionError["code"]) => {
      if (finished || failure) return;
      // A killed harness cannot confirm its native worker/container stopped.
      failure = new ProvisionError(
        code === "MATRIX_FAILED" && !child.pid
          ? code
          : "MATRIX_STOP_UNCONFIRMED",
      );
      child.kill("SIGKILL");
      cleanup = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(new ProvisionError("MATRIX_STOP_UNCONFIRMED"));
      }, OFFLINE_LIMITS.childCleanupMs);
    };
    const abort = () => stop("INTERRUPTED");
    const deadline = setTimeout(
      abort,
      Math.max(1, Math.ceil(context.deadlineMonotonicMs - performance.now())),
    );
    const finish = (error?: ProvisionError, result?: OwnedMatrix) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      if (cleanup) clearTimeout(cleanup);
      context.signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolveResult(result!);
    };
    child.stdout.on("data", (bytes: Buffer) => {
      size += bytes.length;
      if (size > OFFLINE_LIMITS.matrixBytes) stop("MATRIX_PROTOCOL_INVALID");
      else chunks.push(Buffer.from(bytes));
    });
    // Stderr is bounded and discarded; private details never enter returned evidence.
    child.stderr.on("data", (bytes: Buffer) => {
      stderr += bytes.length;
      if (stderr > OFFLINE_LIMITS.matrixBytes) stop("MATRIX_PROTOCOL_INVALID");
    });
    child.on("error", () => stop("MATRIX_FAILED"));
    child.stdout.on("error", () => stop("MATRIX_STOP_UNCONFIRMED"));
    child.stderr.on("error", () => stop("MATRIX_STOP_UNCONFIRMED"));
    child.on("close", (code, signal) => {
      if (finished) return;
      if (failure) {
        finish(failure);
        return;
      }
      try {
        const result = parseOwnedMatrix(Buffer.concat(chunks), matrix, target);
        if (!result.ownedOperationsStopped)
          throw new ProvisionError("MATRIX_STOP_UNCONFIRMED");
        runtimeCheckpoint(context);
        if (code !== 0 || signal) throw new ProvisionError("MATRIX_FAILED");
        if (
          !result.completed ||
          result.residualControlEntries !== 0 ||
          result.cases.some((c) => !c.passed)
        )
          throw new ProvisionError("MATRIX_FAILED");
        finish(undefined, result);
      } catch (error) {
        finish(
          error instanceof ProvisionError &&
            error.code !== "MATRIX_PROTOCOL_INVALID"
            ? error
            : new ProvisionError("MATRIX_STOP_UNCONFIRMED"),
        );
      }
    });
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
  });
}

export type OfflineMatrixEvidence = Readonly<{
  schema: "quizpack-media-candidate-record.v1";
  mode: "offline-exclusive";
  target: RuntimeTarget;
  binding: MediaRuntimeBinding;
  profileId: string;
  sourceBundleHash: string;
  matrixCodeHash: string;
  registryVersion: "quizpack-media-matrix-registry.v1";
  rounds: readonly OwnedMatrix[];
  ownedOperationsStopped: true;
  controlEmpty: true;
}>;
declare const receiptBrand: unique symbol;
export interface OfflineCandidateReceipt {
  readonly [receiptBrand]: true;
}
type Authority = {
  roots: MediaRuntimeRoots;
  evidence: OfflineMatrixEvidence;
  issuedAt: number;
  consumed: boolean;
};
const receipts = new WeakMap<OfflineCandidateReceipt, Authority>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function readOfflineMatrixEvidence(
  receipt: OfflineCandidateReceipt,
): OfflineMatrixEvidence {
  const authority = receipts.get(receipt);
  if (!authority) throw new ProvisionError("RECEIPT_INVALID");
  return authority.evidence;
}
/** Internal bridge: only a live same-process receipt can be consumed, exactly once. */
export function consumeOfflineCandidateReceipt(
  receipt: OfflineCandidateReceipt,
): Readonly<{
  roots: MediaRuntimeRoots;
  evidence: OfflineMatrixEvidence;
  expiresAtMonotonicMs: number;
}> {
  const authority = receipts.get(receipt);
  if (!authority || authority.consumed)
    throw new ProvisionError("RECEIPT_INVALID");
  authority.consumed = true;
  if (performance.now() - authority.issuedAt > OFFLINE_LIMITS.receiptAgeMs)
    throw new ProvisionError("RECEIPT_EXPIRED");
  return Object.freeze({
    roots: authority.roots,
    evidence: authority.evidence,
    expiresAtMonotonicMs: authority.issuedAt + OFFLINE_LIMITS.receiptAgeMs,
  });
}
/** Closed offline flow. Setup must already exist; no pull/build/setup or arbitrary driver is accepted. */
export async function runOfflineCandidateMatrix(
  target: RuntimeTarget,
  signal = new AbortController().signal,
): Promise<OfflineCandidateReceipt> {
  const roots = offlineRuntimeRoots(target);
  const context = createMediaOperationContext({
    signal,
    deadlineMonotonicMs: performance.now() + OFFLINE_LIMITS.operationMs,
  });
  const checkpoint = () => runtimeCheckpoint(context);
  try {
    const before = await readFreshSealIdentity(roots, context);
    await assertControlEmpty(roots, before.binding.platform, checkpoint);
    const codeHash = await matrixCodeHash(roots, checkpoint);
    const plan: readonly MatrixName[] =
      before.binding.platform === "darwin-arm64"
        ? ["macos", "macos", "macos"]
        : ["linux-smoke", "linux-lifecycle"];
    const rounds: OwnedMatrix[] = [];
    for (const matrix of plan) {
      const result = await runOwnedMatrix(roots, matrix, target, context);
      if (result.profiles.normal !== before.profileId)
        throw new ProvisionError("IDENTITY_CHANGED");
      rounds.push(result);
      await assertControlEmpty(roots, before.binding.platform, checkpoint);
    }
    const after = await readFreshSealIdentity(roots, context);
    if (
      JSON.stringify(before) !== JSON.stringify(after) ||
      codeHash !== (await matrixCodeHash(roots, checkpoint))
    )
      throw new ProvisionError("IDENTITY_CHANGED");
    await assertControlEmpty(roots, before.binding.platform, checkpoint);
    const evidence = freeze<OfflineMatrixEvidence>({
      schema: "quizpack-media-candidate-record.v1",
      mode: "offline-exclusive",
      target,
      binding: before.binding,
      profileId: before.profileId,
      sourceBundleHash: before.deployment.sourceBundleHash,
      matrixCodeHash: codeHash,
      registryVersion: "quizpack-media-matrix-registry.v1",
      rounds,
      ownedOperationsStopped: true,
      controlEmpty: true,
    });
    if (
      Buffer.byteLength(JSON.stringify(evidence)) > OFFLINE_LIMITS.recordBytes
    )
      throw new ProvisionError("MATRIX_PROTOCOL_INVALID");
    const receipt = Object.freeze(
      Object.create(null, {
        toJSON: {
          value: () => {
            throw new ProvisionError("RECEIPT_INVALID");
          },
        },
      }),
    ) as OfflineCandidateReceipt;
    // Keep the original matrix deadline through the last IO and serialization;
    // the receipt lifetime must never restart an expired operation budget.
    checkpoint();
    receipts.set(receipt, {
      roots,
      evidence,
      issuedAt: performance.now(),
      consumed: false,
    });
    return receipt;
  } catch (error) {
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError("MATRIX_STOP_UNCONFIRMED");
  } finally {
    disposeMediaOperationContext(context);
  }
}
