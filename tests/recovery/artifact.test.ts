import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  link,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertVerifiedRecoveryBundle,
  closeVerifiedRecoveryBundle,
  createRecoveryBackup,
  verifyRecoveryBundle,
} from "@/features/runtime-recovery/artifact";
import { RecoveryError } from "@/features/runtime-recovery/errors";
import { recoveryHash } from "@/features/runtime-recovery/contracts";
import { artifactFixture, freshBudget } from "./artifact-fixture";

const roots: string[] = [];
async function fixture() {
  const result = await artifactFixture();
  roots.push(result.root);
  return result;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function sealed() {
  const f = await fixture();
  const result = await createRecoveryBackup(f.input, f.snapshot);
  return {
    ...f,
    result,
    verify: () =>
      verifyRecoveryBundle({
        ...freshBudget(),
        directory: f.directory,
        expectedManifestSha256: result.manifestSha256,
      }),
  };
}

describe("private recovery artifact and runtime capability", () => {
  it("seals only after A closes; copies exact private bytes and lends a read-only owned FD", async () => {
    const f = await sealed();
    expect(f.events.at(-2)).toBe("a-closed");
    expect(f.events.at(-1)).toBe("code-check");
    expect((await lstat(f.directory)).mode & 0o777).toBe(0o700);
    const bundle = await f.verify();
    expect(() => assertVerifiedRecoveryBundle(bundle)).not.toThrow();
    expect(Object.isFrozen(bundle.manifest.storage.files[0])).toBe(true);
    expect(await readFile(path.join(f.directory, f.blobPath))).toEqual(f.blob);
    let borrowed: import("node:fs/promises").FileHandle | undefined;
    await bundle.withDump(async (handle) => {
      borrowed = handle;
      const bytes = Buffer.alloc(f.dump.length);
      await handle.read(bytes, 0, bytes.length, 0);
      expect(bytes).toEqual(f.dump);
      await expect(handle.write(Buffer.from("x"), 0, 1, 0)).rejects.toThrow();
    });
    await expect(borrowed!.stat()).rejects.toThrow();
    const target = path.join(
      f.root,
      "target",
      ".cache",
      "p2a",
      f.source.instanceId,
    );
    await mkdir(target, { recursive: true, mode: 0o700 });
    await bundle.installStorage(target);
    expect(await readFile(path.join(target, f.blobPath))).toEqual(f.blob);
    await bundle.assertValid();
    closeVerifiedRecoveryBundle(bundle);
    expect(() => assertVerifiedRecoveryBundle(bundle)).toThrow();
  });

  it("rejects forged capability objects and JSON round trips", async () => {
    const f = await sealed();
    const bundle = await f.verify();
    expect(() =>
      assertVerifiedRecoveryBundle({ ...bundle, assertValid: async () => {} }),
    ).toThrow();
    expect(() =>
      assertVerifiedRecoveryBundle(JSON.parse(JSON.stringify(bundle))),
    ).toThrow();
    expect(() => assertVerifiedRecoveryBundle(null)).toThrow();
    closeVerifiedRecoveryBundle(bundle);
  });

  it("preserves unfinished output when A cannot prove its final closure", async () => {
    const f = await fixture();
    await expect(
      createRecoveryBackup(f.input, async (input, work) => {
        await f.snapshot(input, work);
        throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
      }),
    ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
    expect(await readdir(f.directory)).not.toContain("seal.json");
    await expect(
      verifyRecoveryBundle({
        ...freshBudget(),
        directory: f.directory,
        expectedManifestSha256: "a".repeat(64),
      }),
    ).rejects.toThrow();
  });

  it("refuses an existing destination without overwriting its sentinel", async () => {
    const f = await fixture();
    await mkdir(f.directory, { mode: 0o700 });
    await writeFile(path.join(f.directory, "sentinel"), "keep", {
      mode: 0o600,
    });
    await expect(createRecoveryBackup(f.input, f.snapshot)).rejects.toThrow(
      "RECOVERY_DESTINATION_EXISTS",
    );
    expect(await readFile(path.join(f.directory, "sentinel"), "utf8")).toBe(
      "keep",
    );
  });

  it("rejects a nested backup destination before changing the source directory tree", async () => {
    const f = await fixture();
    const uploads = path.join(f.instanceDirectory, "uploads");
    const before = await readdir(uploads, { recursive: true });
    await expect(
      createRecoveryBackup(
        { ...f.input, directory: path.join(uploads, "new-backup") },
        f.snapshot,
      ),
    ).rejects.toThrow("RECOVERY_SOURCE_INVALID");
    expect(await readdir(uploads, { recursive: true })).toEqual(before);
  });

  it("rejects storage installation into a root nested under the source root", async () => {
    const f = await sealed();
    const bundle = await f.verify();
    const target = path.join(
      f.source.root,
      "nested",
      ".cache",
      "p2a",
      f.source.instanceId,
    );
    await mkdir(target, { recursive: true, mode: 0o700 });
    await expect(bundle.installStorage(target)).rejects.toThrow(
      "RECOVERY_SOURCE_INVALID",
    );
    expect(await readdir(target)).toEqual([]);
  });

  it.each([
    "extra",
    "missing",
    "content",
    "symlink",
    "hardlink",
    "permissions",
  ])(
    "rejects %s storage and permanently revokes a previously issued capability",
    async (fault) => {
      const f = await sealed();
      const bundle = await f.verify();
      const blob = path.join(f.directory, f.blobPath);
      if (fault === "extra")
        await writeFile(path.join(f.directory, "uploads", "extra"), "x", {
          mode: 0o600,
        });
      if (fault === "missing") await rm(blob);
      if (fault === "content")
        await writeFile(blob, Buffer.alloc(f.blob.length, 1));
      if (fault === "permissions") await chmod(blob, 0o644);
      if (fault === "symlink") {
        await rm(blob);
        await symlink(path.join(f.instanceDirectory, f.blobPath), blob);
      }
      if (fault === "hardlink")
        await link(blob, path.join(f.root, "second-link"));
      await expect(bundle.assertValid()).rejects.toThrow();
      expect(() => assertVerifiedRecoveryBundle(bundle)).toThrow();
      await expect(f.verify()).rejects.toThrow();
    },
  );

  it.each([
    "wrong-anchor",
    "missing-seal",
    "extra-root",
    "wrong-header",
    "manifest-bytes",
  ])("rejects %s before issuing a capability", async (fault) => {
    const f = await sealed();
    let expected = f.result.manifestSha256;
    if (fault === "wrong-anchor") expected = "f".repeat(64);
    if (fault === "missing-seal") await rm(path.join(f.directory, "seal.json"));
    if (fault === "extra-root")
      await writeFile(path.join(f.directory, "extra"), "x", { mode: 0o600 });
    if (fault === "wrong-header")
      await writeFile(
        path.join(f.directory, "database.dump"),
        Buffer.alloc(f.dump.length),
      );
    if (fault === "manifest-bytes")
      await writeFile(path.join(f.directory, "manifest.json"), "{}");
    await expect(
      verifyRecoveryBundle({
        ...freshBudget(),
        directory: f.directory,
        expectedManifestSha256: expected,
      }),
    ).rejects.toThrow();
  });

  it("rejects an expired capability and never restores its authority", async () => {
    const f = await sealed();
    const controller = new AbortController();
    const bundle = await verifyRecoveryBundle({
      ...freshBudget(),
      signal: controller.signal,
      directory: f.directory,
      expectedManifestSha256: f.result.manifestSha256,
    });
    controller.abort();
    expect(() => assertVerifiedRecoveryBundle(bundle)).toThrow(
      "RECOVERY_INTERRUPTED",
    );
    expect(() => assertVerifiedRecoveryBundle(bundle)).toThrow(
      "RECOVERY_INTEGRITY_FAILED",
    );
  });

  it("pins the bundle directory identity and refuses pathname replacement", async () => {
    const f = await sealed();
    const bundle = await f.verify();
    await rename(f.directory, f.directory + "-moved");
    await mkdir(f.directory, { mode: 0o700 });
    await expect(bundle.assertValid()).rejects.toThrow(
      "RECOVERY_INTEGRITY_FAILED",
    );
    expect(() => assertVerifiedRecoveryBundle(bundle)).toThrow();
  });

  it("does not accept a marker until all source bytes and code still match", async () => {
    const f = await fixture();
    f.input.assertCodeIdentity = async () => {
      throw new RecoveryError("RECOVERY_CODE_MISMATCH");
    };
    await expect(createRecoveryBackup(f.input, f.snapshot)).rejects.toThrow(
      "RECOVERY_CODE_MISMATCH",
    );
    expect(await readdir(f.directory)).not.toContain("seal.json");
    expect(
      recoveryHash(await readFile(path.join(f.instanceDirectory, f.blobPath))),
    ).toBe(f.inventory.files[0]!.sha256);
  });
});
