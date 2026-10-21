import type { FileHandle } from "node:fs/promises";
import type {
  RecoveryDatabaseEvidence,
  RecoveryFileDigest,
  RecoveryManifest,
  RecoverySourceIdentity,
  RecoveryStorageInventory,
} from "./contracts";

export type RecoveryBudget = Readonly<{
  deadlineMonotonicMs: number;
  signal: AbortSignal;
}>;

/** A owns exporter, table/migration/storage locks, PG children and their real close proof. */
export type RecoverySnapshotLease = Readonly<{
  source: RecoverySourceIdentity;
  database: RecoveryDatabaseEvidence;
  storage: RecoveryStorageInventory;
  instanceDirectory: string;
  assertValid(): Promise<void>;
  /** A must write exclusively through this already-owned new 0600 regular file descriptor. */
  dumpTo(file: FileHandle): Promise<RecoveryFileDigest>;
}>;

declare const verifiedBundle: unique symbol;
/** Issued and runtime-checked by artifact.ts; JSON/casts do not create a verified capability. */
export type VerifiedRecoveryBundle = Readonly<{
  [verifiedBundle]: true;
  manifest: RecoveryManifest;
  manifestSha256: string;
  assertValid(): Promise<void>;
  /** B retains ownership; A may only pass this verified descriptor to its restore child. */
  withDump<T>(work: (file: FileHandle) => Promise<T>): Promise<T>;
  /** Destination is A's newly-created, verified instance directory. Refuses existing uploads. */
  installStorage(instanceDirectory: string): Promise<void>;
}>;

export type RecoveryRestoreResult = Readonly<{
  instanceId: string;
  root: string;
  pgPort: number;
  origin: string;
  manifestSha256: string;
  databaseGraphSha256: string;
  storageSha256: string;
  status: "verified-stopped";
}>;

/** A's entry point. It returns only after callback, exporter, locks and issued IO really close. */
export type WithQuiescentRecoverySnapshot = <T>(
  input: RecoveryBudget & { instanceId: string; codeSha256: string },
  work: (lease: RecoverySnapshotLease) => Promise<T>,
) => Promise<T>;

/** Target root is the current verified repository root, never an arbitrary caller-selected directory. */
export type RestoreManagedRecoveryData = (
  input: RecoveryBudget & {
    bundle: VerifiedRecoveryBundle;
    pgPort: number;
    origin: string;
    codeSha256: string;
  },
) => Promise<RecoveryRestoreResult>;
