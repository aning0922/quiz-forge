import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { computeRecoveryCodeIdentity } from "@/features/runtime-recovery/code-identity";
import { freshBudget } from "./artifact-fixture";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const base = path.join(process.cwd(), ".cache");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "recovery-code-test-"));
  roots.push(root);
  for (const directory of [
    "src",
    "scripts",
    "migrations/p2a",
    "patches",
    "public",
    "docs",
    ".cache/private",
  ])
    await mkdir(path.join(root, directory), { recursive: true });
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "next.config.ts",
    "postcss.config.mjs",
    ".npmrc",
    "src/test.ts",
    "public/font.woff2",
  ])
    await writeFile(path.join(root, file), `synthetic ${file}`);
  return root;
}
it("includes actual code/public bytes while excluding docs and private state", async () => {
  const root = await fixture();
  const first = await computeRecoveryCodeIdentity(root, freshBudget());
  await writeFile(path.join(root, "docs", "notes.md"), "changed");
  await writeFile(
    path.join(root, ".cache/private", "runtime.json"),
    "synthetic excluded private data",
  );
  expect(await computeRecoveryCodeIdentity(root, freshBudget())).toEqual(first);
  await writeFile(path.join(root, "public/font.woff2"), "changed real asset");
  expect(
    (await computeRecoveryCodeIdentity(root, freshBudget())).codeSha256,
  ).not.toBe(first.codeSha256);
});
it("rejects a symlink in an included subtree", async () => {
  const root = await fixture();
  await symlink(
    path.join(root, "package.json"),
    path.join(root, "src", "linked.ts"),
  );
  await expect(
    computeRecoveryCodeIdentity(root, freshBudget()),
  ).rejects.toThrow("RECOVERY_STORAGE_INVALID");
});
