import { randomUUID } from "node:crypto";
import { rename } from "node:fs/promises";
import path from "node:path";
import {
  RECOVERY_LIMITS,
  canonicalRecoveryJson,
  recoveryHash,
  recoveryManifestSchema,
  recoveryManifestText,
  recoverySealSchema,
  recoveryStorageSchema,
  type RecoveryManifest,
} from "./contracts";
import type {
  RecoveryBudget,
  VerifiedRecoveryBundle,
  WithQuiescentRecoverySnapshot,
} from "./ports";
import { RecoveryError } from "./errors";
import {
  assertRecoveryDigest,
  assertRecoveryDirectory,
  assertRecoveryIoKnown,
  assertRecoveryStorage,
  checkRecoveryBudget,
  copyRecoveryStorage,
  createRecoveryDirectory,
  digestRecoveryFile,
  digestRecoveryHandle,
  readRecoveryBytes,
  recoveryDirectoryNames,
  syncRecoveryDirectory,
  withNewRecoveryFile,
  withRecoveryFile,
  writeRecoveryBytes,
} from "./files";

const dumpHeader = Buffer.from("PGDMP", "ascii");
const capabilities = new WeakMap<object, BundleState>();
type BundleState = {
  directory: string;
  manifest: RecoveryManifest;
  manifestSha256: string;
  budget: RecoveryBudget;
  revoked: boolean;
  busy: boolean;
  rootDev: number;
  rootIno: number;
};
function freezeTree<T>(input: T): T {
  if (input && typeof input === "object") {
    for (const value of Object.values(input)) freezeTree(value);
    Object.freeze(input);
  }
  return input;
}
function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new RecoveryError("RECOVERY_FORMAT_INVALID");
  }
}
function assertNames(actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort()))
    throw new RecoveryError("RECOVERY_STORAGE_INVALID");
}
async function assertPayload(
  directory: string,
  manifest: RecoveryManifest,
  budget: RecoveryBudget,
) {
  assertRecoveryDigest(
    await digestRecoveryFile(
      path.join(directory, "database.dump"),
      budget,
      RECOVERY_LIMITS.dumpBytes,
      dumpHeader,
    ),
    manifest.dump,
  );
  await assertRecoveryStorage(directory, manifest.storage, budget);
}
async function readVerifiedManifest(
  directory: string,
  expectedManifestSha256: string,
  budget: RecoveryBudget,
): Promise<RecoveryManifest> {
  checkRecoveryBudget(budget);
  if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256))
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  assertNames(await recoveryDirectoryNames(directory, budget, 4), [
    "database.dump",
    "manifest.json",
    "seal.json",
    "uploads",
  ]);
  const sealBytes = await readRecoveryBytes(
    path.join(directory, "seal.json"),
    budget,
    RECOVERY_LIMITS.sealBytes,
  );
  const seal = recoverySealSchema.safeParse(parseJson(sealBytes));
  if (
    !seal.success ||
    canonicalRecoveryJson(seal.data) !== sealBytes.toString()
  )
    throw new RecoveryError("RECOVERY_FORMAT_INVALID");
  const manifestBytes = await readRecoveryBytes(
    path.join(directory, "manifest.json"),
    budget,
    RECOVERY_LIMITS.manifestBytes,
  );
  const digest = recoveryHash(manifestBytes);
  if (
    digest !== expectedManifestSha256 ||
    digest !== seal.data.manifestSha256 ||
    manifestBytes.length !== seal.data.manifestBytes
  )
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  const parsed = recoveryManifestSchema.safeParse(parseJson(manifestBytes));
  if (
    !parsed.success ||
    parsed.data.backupId !== seal.data.backupId ||
    recoveryManifestText(parsed.data) !== manifestBytes.toString("utf8")
  )
    throw new RecoveryError("RECOVERY_FORMAT_INVALID");
  await assertPayload(directory, parsed.data, budget);
  return parsed.data;
}

/** New private destination only; failure intentionally preserves its unfinished files. */
export async function createRecoveryBackup(
  input: RecoveryBudget & {
    instanceId: string;
    codeSha256: string;
    directory: string;
    assertCodeIdentity(): Promise<void>;
  },
  withSnapshot: WithQuiescentRecoverySnapshot,
): Promise<{ backupId: string; manifestSha256: string }> {
  checkRecoveryBudget(input);
  if (
    !/^[a-f0-9]{32}$/.test(input.instanceId) ||
    !/^[a-f0-9]{64}$/.test(input.codeSha256)
  )
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  const backupId = randomUUID();
  const manifest = await withSnapshot(input, async (lease) => {
    await lease.assertValid();
    const storage = recoveryStorageSchema.parse(lease.storage);
    const sourceDirectory = path.join(
      lease.source.root,
      ".cache",
      "p2a",
      input.instanceId,
    );
    if (
      lease.source.instanceId !== input.instanceId ||
      lease.source.codeSha256 !== input.codeSha256 ||
      lease.instanceDirectory !== sourceDirectory ||
      input.directory === sourceDirectory ||
      input.directory.startsWith(sourceDirectory + path.sep) ||
      sourceDirectory.startsWith(input.directory + path.sep)
    )
      throw new RecoveryError("RECOVERY_SOURCE_INVALID");
    // Reject overlap before the first destination mutation, including a nested source path.
    await createRecoveryDirectory(input.directory, input);
    const dumpPath = path.join(input.directory, "database.dump");
    const claimed = await withNewRecoveryFile(dumpPath, input, (file) =>
      lease.dumpTo(file),
    );
    const dump = await digestRecoveryFile(
      dumpPath,
      input,
      RECOVERY_LIMITS.dumpBytes,
      dumpHeader,
    );
    assertRecoveryDigest(dump, claimed);
    await copyRecoveryStorage(sourceDirectory, input.directory, storage, input);
    await lease.assertValid();
    await input.assertCodeIdentity();
    // Return only after all B-owned read/write/sync descriptors really close.
    assertRecoveryIoKnown();
    return recoveryManifestSchema.parse({
      schemaVersion: "quizforge.runtime-backup.v1",
      backupId,
      createdAt: new Date().toISOString(),
      mode: "quiescent-logical",
      source: lease.source,
      database: lease.database,
      dump: { ...dump, path: "database.dump", format: "pg18.4-custom" },
      storage,
    });
  });
  // A's return is its actual exporter/locks/PG children/IO closure proof.
  checkRecoveryBudget(input);
  await input.assertCodeIdentity();
  await assertPayload(input.directory, manifest, input);
  const manifestText = recoveryManifestText(manifest);
  const manifestSha256 = recoveryHash(manifestText);
  await writeRecoveryBytes(
    path.join(input.directory, "manifest.json"),
    Buffer.from(manifestText),
    input,
  );
  const sealText = canonicalRecoveryJson(
    recoverySealSchema.parse({
      schemaVersion: "quizforge.runtime-backup-seal.v1",
      backupId,
      manifestBytes: Buffer.byteLength(manifestText),
      manifestSha256,
      status: "sealed",
    }),
  );
  await writeRecoveryBytes(
    path.join(input.directory, "seal.pending"),
    Buffer.from(sealText),
    input,
  );
  assertNames(await recoveryDirectoryNames(input.directory, input, 4), [
    "database.dump",
    "manifest.json",
    "seal.pending",
    "uploads",
  ]);
  const writtenManifest = await readRecoveryBytes(
    path.join(input.directory, "manifest.json"),
    input,
    RECOVERY_LIMITS.manifestBytes,
  );
  if (writtenManifest.toString() !== manifestText)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  const writtenSeal = await readRecoveryBytes(
    path.join(input.directory, "seal.pending"),
    input,
    RECOVERY_LIMITS.sealBytes,
  );
  if (writtenSeal.toString() !== sealText)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  await syncRecoveryDirectory(input.directory, input);
  checkRecoveryBudget(input);
  // Final publication is the last IO: all payload/marker FDs and A's resources are closed.
  // A crash may lose this unsynced name change, yielding a rejected incomplete backup.
  await rename(
    path.join(input.directory, "seal.pending"),
    path.join(input.directory, "seal.json"),
  );
  return { backupId, manifestSha256 };
}

/** Mandatory synchronous provenance check for A before any target creation. */
export function assertVerifiedRecoveryBundle(
  bundle: unknown,
): asserts bundle is VerifiedRecoveryBundle {
  const state =
    bundle !== null && typeof bundle === "object"
      ? capabilities.get(bundle)
      : undefined;
  if (!state || state.revoked)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  try {
    checkRecoveryBudget(state.budget);
  } catch (error) {
    state.revoked = true;
    throw error;
  }
}
export function closeVerifiedRecoveryBundle(bundle: VerifiedRecoveryBundle) {
  const state = capabilities.get(bundle);
  if (!state) throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  state.revoked = true;
}
async function validateState(state: BundleState) {
  const root = await assertRecoveryDirectory(state.directory, state.budget);
  if (root.dev !== state.rootDev || root.ino !== state.rootIno)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  const current = await readVerifiedManifest(
    state.directory,
    state.manifestSha256,
    state.budget,
  );
  if (recoveryManifestText(current) !== recoveryManifestText(state.manifest))
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
}
async function withCapabilityOperation<T>(
  bundle: VerifiedRecoveryBundle,
  work: (state: BundleState) => Promise<T>,
): Promise<T> {
  assertVerifiedRecoveryBundle(bundle);
  const state = capabilities.get(bundle)!;
  if (state.busy) {
    state.revoked = true;
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  }
  state.busy = true;
  try {
    await validateState(state);
    const result = await work(state);
    assertVerifiedRecoveryBundle(bundle);
    return result;
  } catch (error) {
    state.revoked = true;
    throw error;
  } finally {
    state.busy = false;
  }
}

/** No persistent FDs: each capability operation revalidates, borrows, and really closes. */
export async function verifyRecoveryBundle(
  input: RecoveryBudget & {
    directory: string;
    expectedManifestSha256: string;
  },
): Promise<VerifiedRecoveryBundle> {
  const root = await assertRecoveryDirectory(input.directory, input);
  const manifest = freezeTree(
    await readVerifiedManifest(
      input.directory,
      input.expectedManifestSha256,
      input,
    ),
  );
  const state: BundleState = {
    directory: input.directory,
    manifest,
    manifestSha256: input.expectedManifestSha256,
    budget: {
      deadlineMonotonicMs: input.deadlineMonotonicMs,
      signal: input.signal,
    },
    revoked: false,
    busy: false,
    rootDev: root.dev,
    rootIno: root.ino,
  };
  const bundle = Object.freeze({
    manifest,
    manifestSha256: state.manifestSha256,
    assertValid: () => withCapabilityOperation(bundle, async () => {}),
    withDump: <T>(
      work: (file: import("node:fs/promises").FileHandle) => Promise<T>,
    ) =>
      withCapabilityOperation(bundle, (owned) =>
        withRecoveryFile(
          path.join(owned.directory, "database.dump"),
          owned.budget,
          RECOVERY_LIMITS.dumpBytes,
          async (file) => {
            assertRecoveryDigest(
              await digestRecoveryHandle(
                file,
                owned.budget,
                RECOVERY_LIMITS.dumpBytes,
                dumpHeader,
              ),
              owned.manifest.dump,
            );
            const result = await work(file);
            assertRecoveryDigest(
              await digestRecoveryHandle(
                file,
                owned.budget,
                RECOVERY_LIMITS.dumpBytes,
                dumpHeader,
              ),
              owned.manifest.dump,
            );
            return result;
          },
        ),
      ),
    installStorage: (instanceDirectory: string) =>
      withCapabilityOperation(bundle, async (owned) => {
        const targetRoot = path.resolve(instanceDirectory, "../../..");
        if (
          instanceDirectory !==
            path.join(
              targetRoot,
              ".cache",
              "p2a",
              owned.manifest.source.instanceId,
            ) ||
          targetRoot === owned.manifest.source.root ||
          targetRoot.startsWith(owned.manifest.source.root + path.sep) ||
          owned.manifest.source.root.startsWith(targetRoot + path.sep) ||
          instanceDirectory === owned.directory ||
          instanceDirectory.startsWith(owned.directory + path.sep) ||
          owned.directory.startsWith(instanceDirectory + path.sep)
        )
          throw new RecoveryError("RECOVERY_SOURCE_INVALID");
        await copyRecoveryStorage(
          owned.directory,
          instanceDirectory,
          owned.manifest.storage,
          owned.budget,
        );
        await syncRecoveryDirectory(instanceDirectory, owned.budget);
      }),
  }) as VerifiedRecoveryBundle;
  capabilities.set(bundle, state);
  return bundle;
}
