import path from "node:path";
import { recoveryRootSchema } from "./contracts";
import type {
  RecoveryBudget,
  RestoreManagedRecoveryData,
  WithQuiescentRecoverySnapshot,
} from "./ports";
import { RecoveryError } from "./errors";
import { computeRecoveryCodeIdentity } from "./code-identity";
import {
  assertRecoveryEnvironment,
  assertRecoveryRepository,
} from "./cli-environment";
import {
  closeVerifiedRecoveryBundle,
  createRecoveryBackup,
  verifyRecoveryBundle,
} from "./artifact";

function canonicalPath(value: string) {
  if (
    !recoveryRootSchema.safeParse(value).success ||
    path.resolve(value) !== value
  )
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  return value;
}
/** Explicit ports compose A/B; no production substitute for a missing database implementation. */
export function createRecoveryService(
  ports: {
    withQuiescentRecoverySnapshot: WithQuiescentRecoverySnapshot;
    restoreManagedRecoveryData: RestoreManagedRecoveryData;
  },
  root = process.cwd(),
) {
  canonicalPath(root);
  const code = (budget: RecoveryBudget) =>
    computeRecoveryCodeIdentity(root, budget);
  const assertCode = async (expected: string, budget: RecoveryBudget) => {
    if ((await code(budget)).codeSha256 !== expected)
      throw new RecoveryError("RECOVERY_CODE_MISMATCH");
  };
  return {
    async doctor(budget: RecoveryBudget) {
      await assertRecoveryEnvironment(root, budget);
      return {
        status: "environment-verified" as const,
        ...(await code(budget)),
        postgresVersion: 180004 as const,
      };
    },
    async backup(
      input: { instanceId: string; directory: string },
      budget: RecoveryBudget,
    ) {
      await assertRecoveryEnvironment(root, budget);
      canonicalPath(input.directory);
      const privateInstances = path.join(root, ".cache", "p2a");
      if (
        input.directory === privateInstances ||
        input.directory.startsWith(privateInstances + path.sep)
      )
        throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
      const identity = await code(budget);
      return createRecoveryBackup(
        {
          ...budget,
          ...input,
          codeSha256: identity.codeSha256,
          assertCodeIdentity: () => assertCode(identity.codeSha256, budget),
        },
        (snapshotInput, work) =>
          ports.withQuiescentRecoverySnapshot(snapshotInput, async (lease) => {
            if (lease.source.root !== root)
              throw new RecoveryError("RECOVERY_SOURCE_INVALID");
            return work(lease);
          }),
      );
    },
    async verify(
      input: { directory: string; expectedManifestSha256: string },
      budget: RecoveryBudget,
    ) {
      await assertRecoveryRepository(root, budget);
      canonicalPath(input.directory);
      const bundle = await verifyRecoveryBundle({ ...budget, ...input });
      try {
        await bundle.assertValid();
        return {
          status: "integrity-verified" as const,
          backupId: bundle.manifest.backupId,
          manifestSha256: bundle.manifestSha256,
        };
      } finally {
        closeVerifiedRecoveryBundle(bundle);
      }
    },
    async restore(
      input: {
        directory: string;
        expectedManifestSha256: string;
        pgPort: number;
        origin: string;
      },
      budget: RecoveryBudget,
    ) {
      await assertRecoveryEnvironment(root, budget);
      canonicalPath(input.directory);
      const identity = await code(budget);
      const bundle = await verifyRecoveryBundle({ ...budget, ...input });
      try {
        if (bundle.manifest.source.codeSha256 !== identity.codeSha256)
          throw new RecoveryError("RECOVERY_CODE_MISMATCH");
        if (
          bundle.manifest.source.root === root ||
          bundle.manifest.source.pgPort === input.pgPort ||
          bundle.manifest.source.origin === input.origin
        )
          throw new RecoveryError("RECOVERY_SOURCE_INVALID");
        const result = await ports.restoreManagedRecoveryData({
          ...budget,
          bundle,
          pgPort: input.pgPort,
          origin: input.origin,
          codeSha256: identity.codeSha256,
        });
        await assertCode(identity.codeSha256, budget);
        return result;
      } finally {
        closeVerifiedRecoveryBundle(bundle);
      }
    },
  };
}
export type RecoveryService = ReturnType<typeof createRecoveryService>;
