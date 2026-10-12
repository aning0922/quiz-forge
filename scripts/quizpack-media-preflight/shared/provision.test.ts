import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candidateRecordSchema,
  sealOfflineCandidate,
  writeCandidateAuditRecord,
} from "./provision";
import {
  MATRIX_CASES,
  ProvisionError,
  type OfflineCandidateReceipt,
  type OfflineMatrixEvidence,
  type OwnedMatrix,
} from "./runtime";
const hash = "a".repeat(64);
function record(
  platform: "darwin-arm64" | "linux-x64" = "darwin-arm64",
): OfflineMatrixEvidence {
  const plan =
    platform === "darwin-arm64"
      ? (["macos", "macos", "macos"] as const)
      : (["linux-smoke", "linux-lifecycle"] as const);
  return {
    schema: "quizpack-media-candidate-record.v1",
    mode: "offline-exclusive",
    target: "fixture",
    binding: {
      schema: "quizpack-media-runtime-binding.v1",
      platform,
      componentId: hash,
      deploymentId: hash,
      runtimeBundleHash: hash,
      limitsHash: hash,
    },
    profileId: hash,
    sourceBundleHash: hash,
    matrixCodeHash: hash,
    registryVersion: "quizpack-media-matrix-registry.v1",
    rounds: plan.map(
      (matrix) =>
        ({
          schema: "quizpack-media-owned-matrix.v1",
          matrix,
          target: "fixture",
          completed: true,
          cases: MATRIX_CASES[matrix].map((id) => ({ id, passed: true })),
          profiles:
            matrix === "macos"
              ? { normal: hash, fault: hash, posixProbe: hash, macProbe: hash }
              : {
                  normal: hash,
                  fault: hash,
                  posixProbe: hash,
                  nativeProbe: hash,
                },
          ownedOperationsStopped: true,
          residualControlEntries: 0,
        }) as OwnedMatrix,
    ),
    ownedOperationsStopped: true,
    controlEmpty: true,
  };
}
test("audit schema binds full platform plan, role profiles, stop evidence and 32KiB", () => {
  for (const platform of ["darwin-arm64", "linux-x64"] as const) {
    const value = record(platform);
    assert.equal(candidateRecordSchema.safeParse(value).success, true);
    assert.ok(Buffer.byteLength(JSON.stringify(value)) < 32 * 1024);
    for (const changed of [
      { ...value, rounds: value.rounds.slice(1) },
      { ...value, controlEmpty: false },
      {
        ...value,
        rounds: value.rounds.map((r, i) =>
          i ? r : { ...r, ownedOperationsStopped: false },
        ),
      },
      {
        ...value,
        rounds: value.rounds.map((r, i) =>
          i ? r : { ...r, profiles: { ...r.profiles, normal: "b".repeat(64) } },
        ),
      },
      {
        ...value,
        rounds: value.rounds.map((r, i) =>
          i
            ? r
            : {
                ...r,
                cases: r.cases.map((c, j) => (j ? c : { ...c, passed: false })),
              },
        ),
      },
    ])
      assert.equal(candidateRecordSchema.safeParse(changed).success, false);
  }
});
test("audit writer is private/atomic and cannot turn serialized valid evidence into a seal", async () => {
  const checkoutRoot = await mkdtemp(
    join(realpathSync(tmpdir()), "quizpack-record-synthetic-"),
  );
  const roots = { checkoutRoot, deploymentRoot: join(checkoutRoot, ".next") };
  const state = join(
      checkoutRoot,
      ".cache/quizpack-media-runtime/darwin-arm64",
    ),
    audit = join(state, "candidate-record.json"),
    capability = join(state, "capability.json");
  try {
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(capability, "synthetic-prior-capability", { mode: 0o600 });
    writeCandidateAuditRecord(roots, record(), () => undefined);
    assert.equal((await lstat(audit)).mode & 0o777, 0o600);
    const before = await readFile(audit, "utf8");
    assert.deepEqual(JSON.parse(before), record());
    const result = await sealOfflineCandidate(
      JSON.parse(before) as OfflineCandidateReceipt,
    );
    assert.deepEqual(result, {
      outcome: "failed",
      code: "RECEIPT_INVALID",
      capabilityCommitted: false,
      recordCommitted: false,
    });
    assert.equal(
      await readFile(capability, "utf8"),
      "synthetic-prior-capability",
    );
    assert.throws(
      () =>
        writeCandidateAuditRecord(
          roots,
          { ...record(), controlEmpty: false } as never,
          () => undefined,
        ),
      /MATRIX_PROTOCOL_INVALID/,
    );
    assert.equal(await readFile(audit, "utf8"), before);
    let calls = 0;
    assert.throws(
      () =>
        writeCandidateAuditRecord(roots, record(), () => {
          if (++calls >= 3) throw new ProvisionError("INTERRUPTED");
        }),
      /INTERRUPTED/,
    );
    assert.equal(await readFile(audit, "utf8"), before);
    assert.deepEqual((await readdir(state)).sort(), [
      "candidate-record.json",
      "capability.json",
    ]);
  } finally {
    await rm(checkoutRoot, { recursive: true, force: true });
  }
});
test("audit writer refuses wrong mode, symlink and hardlinked existing files without modifying prior bytes", async () => {
  const checkoutRoot = await mkdtemp(
    join(realpathSync(tmpdir()), "quizpack-write-synthetic-"),
  );
  const roots = { checkoutRoot, deploymentRoot: join(checkoutRoot, ".next") };
  const state = join(
      checkoutRoot,
      ".cache/quizpack-media-runtime/darwin-arm64",
    ),
    audit = join(state, "candidate-record.json"),
    victim = join(state, "synthetic-victim.json");
  try {
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(victim, "synthetic-prior", { mode: 0o600 });
    await symlink(victim, audit);
    assert.throws(
      () => writeCandidateAuditRecord(roots, record(), () => undefined),
      /IO_UNSAFE/,
    );
    await rm(audit);
    await link(victim, audit);
    assert.throws(
      () => writeCandidateAuditRecord(roots, record(), () => undefined),
      /IO_UNSAFE/,
    );
    await rm(audit);
    await chmod(state, 0o755);
    assert.throws(
      () => writeCandidateAuditRecord(roots, record(), () => undefined),
      /IO_UNSAFE/,
    );
    assert.equal(await readFile(victim, "utf8"), "synthetic-prior");
  } finally {
    await rm(checkoutRoot, { recursive: true, force: true });
  }
});

test("final target stat crossing the absolute deadline cannot commit a replacement record", async () => {
  const checkoutRoot = await mkdtemp(
    join(realpathSync(tmpdir()), "quizpack-final-stat-synthetic-"),
  );
  const roots = { checkoutRoot, deploymentRoot: join(checkoutRoot, ".next") };
  const state = join(
      checkoutRoot,
      ".cache/quizpack-media-runtime/darwin-arm64",
    ),
    audit = join(state, "candidate-record.json");
  const original = fs.lstatSync;
  let calls = 0,
    delayed = false;
  try {
    await mkdir(state, { recursive: true, mode: 0o700 });
    await writeFile(audit, "synthetic-prior-record", { mode: 0o600 });
    const deadline = performance.now() + 100;
    Reflect.set(fs, "lstatSync", ((...args: Parameters<typeof original>) => {
      const result = Reflect.apply(original, fs, args);
      if (String(args[0]) === audit && ++calls === 2) {
        delayed = true;
        while (performance.now() <= deadline + 20) {
          /* A delayed real final IO observation. */
        }
      }
      return result;
    }) as typeof original);
    syncBuiltinESMExports();
    assert.throws(
      () =>
        writeCandidateAuditRecord(roots, record(), () => {
          if (performance.now() >= deadline)
            throw new ProvisionError("INTERRUPTED");
        }),
      /INTERRUPTED/,
    );
    assert.equal(delayed, true);
    assert.equal(await readFile(audit, "utf8"), "synthetic-prior-record");
    assert.deepEqual(await readdir(state), ["candidate-record.json"]);
  } finally {
    Reflect.set(fs, "lstatSync", original);
    syncBuiltinESMExports();
    await rm(checkoutRoot, { recursive: true, force: true });
  }
});
