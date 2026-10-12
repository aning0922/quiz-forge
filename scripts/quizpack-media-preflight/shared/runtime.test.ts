import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertControlEmpty,
  consumeOfflineCandidateReceipt,
  MATRIX_CASES,
  matrixCodeHash,
  offlineRuntimeRoots,
  parseOwnedMatrix,
  ProvisionError,
  readOfflineMatrixEvidence,
  type OfflineCandidateReceipt,
  type OwnedMatrix,
} from "./runtime";

const hash = "a".repeat(64);
export function matrixFixture(
  matrix: OwnedMatrix["matrix"] = "macos",
): OwnedMatrix {
  const profiles =
    matrix === "macos"
      ? { normal: hash, fault: hash, posixProbe: hash, macProbe: hash }
      : { normal: hash, fault: hash, posixProbe: hash, nativeProbe: hash };
  return {
    schema: "quizpack-media-owned-matrix.v1",
    matrix,
    target: "fixture",
    completed: true,
    cases: MATRIX_CASES[matrix].map((id) => ({ id, passed: true })),
    profiles,
    ownedOperationsStopped: true,
    residualControlEntries: 0,
  } as OwnedMatrix;
}
function protocol(value: OwnedMatrix): Buffer {
  return Buffer.from(
    value.cases
      .map((c) => JSON.stringify({ case: c.id, passed: c.passed }))
      .concat(JSON.stringify(value))
      .join("\n") + "\n",
  );
}
test("full fixed registry and bounded actual protocol for each platform", () => {
  assert.deepEqual(
    Object.values(MATRIX_CASES).map((c) => c.length),
    [66, 31, 11],
  );
  for (const matrix of ["macos", "linux-smoke", "linux-lifecycle"] as const) {
    const value = matrixFixture(matrix),
      bytes = protocol(value);
    assert.ok(bytes.length <= 32 * 1024);
    assert.deepEqual(parseOwnedMatrix(bytes, matrix, "fixture"), value);
    assert.equal(
      new Set(value.cases.map((c) => c.id)).size,
      value.cases.length,
    );
  }
  assert.ok(Object.isFrozen(MATRIX_CASES.macos));
});
test("protocol requires full unique registry and exact event/summary correspondence", () => {
  const value = matrixFixture();
  const variants = [
    { ...value, cases: value.cases.slice(1) },
    { ...value, cases: [value.cases[0]!, ...value.cases.slice(0, -1)] },
    {
      ...value,
      cases: value.cases.map((c, i) =>
        i ? c : { ...c, id: "future-unregistered-case" },
      ),
    },
    { ...value, target: "main" },
    { ...value, profiles: { ...value.profiles, unexpected: hash } },
    { ...value, unexpected: true },
  ];
  for (const variant of variants)
    assert.throws(
      () =>
        parseOwnedMatrix(protocol(variant as OwnedMatrix), "macos", "fixture"),
      /MATRIX_PROTOCOL_INVALID/,
    );
  const bytes = protocol(value);
  assert.throws(
    () =>
      parseOwnedMatrix(
        Buffer.from(
          bytes.toString().replace('"passed":true', '"passed":false'),
        ),
        "macos",
        "fixture",
      ),
    /MATRIX_PROTOCOL_INVALID/,
  );
});
test("protocol rejects duplicates before JSON erases them, invalid UTF8, BOM, missing newline and oversized bytes", () => {
  const bytes = protocol(matrixFixture());
  for (const malformed of [
    Buffer.from(
      bytes
        .toString()
        .replace('"completed":true', '"completed":false,"completed":true'),
    ),
    Buffer.from([0xff]),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
    bytes.subarray(0, -1),
    Buffer.alloc(32 * 1024 + 1, 32),
  ])
    assert.throws(
      () => parseOwnedMatrix(malformed, "macos", "fixture"),
      /MATRIX_PROTOCOL_INVALID/,
    );
});
test("parsed audit evidence cannot forge a same-process receipt", () => {
  for (const fake of [
    {},
    matrixFixture(),
    JSON.parse(JSON.stringify(matrixFixture())),
  ]) {
    assert.throws(
      () => consumeOfflineCandidateReceipt(fake as OfflineCandidateReceipt),
      /RECEIPT_INVALID/,
    );
    assert.throws(
      () => readOfflineMatrixEvidence(fake as OfflineCandidateReceipt),
      /RECEIPT_INVALID/,
    );
  }
  assert.throws(
    () => offlineRuntimeRoots("../../other" as "main"),
    /INVALID_TARGET/,
  );
});
test("control inspection never treats guards, unknown files, links or wrong permissions as empty", async () => {
  const checkoutRoot = await mkdtemp(
    join(realpathSync(tmpdir()), "quizpack-control-synthetic-"),
  );
  const roots = { checkoutRoot, deploymentRoot: join(checkoutRoot, ".next") };
  const state = join(
      checkoutRoot,
      ".cache/quizpack-media-runtime/darwin-arm64",
    ),
    control = join(state, "control");
  try {
    await mkdir(control, { recursive: true, mode: 0o700 });
    await assertControlEmpty(roots, "darwin-arm64", () => undefined);
    for (const name of [
      "guard",
      "active.json",
      "policy.json",
      "record.json",
      "unknown",
    ]) {
      await writeFile(join(control, name), "synthetic", { mode: 0o600 });
      await assert.rejects(
        assertControlEmpty(roots, "darwin-arm64", () => undefined),
        /CONTROL_NOT_EMPTY/,
      );
      await rm(join(control, name));
    }
    await chmod(control, 0o755);
    await assert.rejects(
      assertControlEmpty(roots, "darwin-arm64", () => undefined),
      /CONTROL_NOT_EMPTY/,
    );
    await chmod(control, 0o700);
    await rm(control, { recursive: true });
    await symlink(state, control);
    await assert.rejects(
      assertControlEmpty(roots, "darwin-arm64", () => undefined),
      /CONTROL_NOT_EMPTY/,
    );
  } finally {
    await rm(checkoutRoot, { recursive: true, force: true });
  }
});
test("matrix source closure binds bytes and rejects unknown special/link entries", async () => {
  const checkoutRoot = await mkdtemp(
    join(realpathSync(tmpdir()), "quizpack-code-synthetic-"),
  );
  const roots = { checkoutRoot, deploymentRoot: join(checkoutRoot, ".next") },
    base = join(checkoutRoot, "scripts/quizpack-media-preflight");
  try {
    await mkdir(base, { recursive: true });
    await writeFile(join(base, "driver.ts"), "export const synthetic = 1;");
    const first = await matrixCodeHash(roots, () => undefined);
    await writeFile(join(base, "driver.ts"), "export const synthetic = 2;");
    assert.notEqual(await matrixCodeHash(roots, () => undefined), first);
    await writeFile(join(base, "ignored.test.ts"), "synthetic tests");
    const second = await matrixCodeHash(roots, () => undefined);
    await writeFile(join(base, "ignored.test.ts"), "changed synthetic tests");
    assert.equal(await matrixCodeHash(roots, () => undefined), second);
    await symlink(join(base, "driver.ts"), join(base, "alias.ts"));
    await assert.rejects(
      matrixCodeHash(roots, () => undefined),
      /IO_UNSAFE/,
    );
    await rm(join(base, "alias.ts"));
    await writeFile(join(base, "unexpected.bin"), "x");
    await assert.rejects(
      matrixCodeHash(roots, () => undefined),
      /IO_UNSAFE/,
    );
    await assert.rejects(
      matrixCodeHash(roots, () => {
        throw new ProvisionError("INTERRUPTED");
      }),
      /INTERRUPTED/,
    );
  } finally {
    await rm(checkoutRoot, { recursive: true, force: true });
  }
});
