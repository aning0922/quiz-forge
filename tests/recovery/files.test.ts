import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  assertRecoveryIoKnown,
  digestRecoveryFile,
  digestRecoveryHandle,
  withNewRecoveryFile,
  withRecoveryFile,
} from "@/features/runtime-recovery/files";
import { recoveryHash } from "@/features/runtime-recovery/contracts";
import { freshBudget } from "./artifact-fixture";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const base = path.join(process.cwd(), ".cache");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "recovery-file-fault-"));
  roots.push(root);
  const file = path.join(root, "test");
  const bytes = Buffer.from("PGDMP-finite-file");
  await writeFile(file, bytes, { mode: 0o600 });
  return { root, file, bytes };
}

it("handles real short reads without consuming the FD's implicit offset", async () => {
  const f = await fixture();
  const result = await withRecoveryFile(
    f.file,
    freshBudget(),
    100,
    async (handle) => {
      const original = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation((...args: unknown[]) => {
        const [buffer, offset, length, position] = args as [
          Buffer,
          number,
          number,
          number,
        ];
        return original(buffer, offset, Math.min(length, 2), position);
      });
      const digest = await digestRecoveryHandle(
        handle,
        freshBudget(),
        100,
        Buffer.from("PGDMP"),
      );
      vi.mocked(handle.read).mockRestore();
      const first = Buffer.alloc(5);
      await handle.read(first, 0, first.length, null);
      expect(first.toString()).toBe("PGDMP");
      return digest;
    },
  );
  expect(result).toEqual({
    bytes: f.bytes.length,
    sha256: recoveryHash(f.bytes),
  });
});

it("rejects an oversized file before reading it", async () => {
  const f = await fixture();
  await expect(digestRecoveryFile(f.file, freshBudget(), 1)).rejects.toThrow(
    "RECOVERY_LIMIT_EXCEEDED",
  );
});

it("closes the owned FD when cancellation occurs during a read", async () => {
  const f = await fixture();
  const controller = new AbortController();
  const budget = { ...freshBudget(), signal: controller.signal };
  let borrowed: Awaited<ReturnType<typeof open>> | undefined;
  await expect(
    withRecoveryFile(f.file, budget, 100, async (handle) => {
      borrowed = handle;
      const read = handle.read.bind(handle);
      vi.spyOn(handle, "read").mockImplementation(
        async (...args: unknown[]) => {
          const [buffer, offset, length, position] = args as [
            Buffer,
            number,
            number,
            number,
          ];
          const result = await read(buffer, offset, length, position);
          controller.abort();
          return result;
        },
      );
      return digestRecoveryHandle(handle, budget, 100);
    }),
  ).rejects.toThrow("RECOVERY_INTERRUPTED");
  await expect(borrowed!.stat()).rejects.toThrow();
  expect(() => assertRecoveryIoKnown()).not.toThrow();
});

it("awaits close after sync fails and preserves the new file", async () => {
  const f = await fixture();
  const target = path.join(f.root, "failed-sync");
  let owned: Awaited<ReturnType<typeof open>> | undefined;
  await expect(
    withNewRecoveryFile(target, freshBudget(), async (handle) => {
      owned = handle;
      await handle.writeFile("pending");
      vi.spyOn(handle, "sync").mockRejectedValue(
        Error("synthetic sync failure"),
      );
    }),
  ).rejects.toThrow("synthetic sync failure");
  await expect(owned!.stat()).rejects.toThrow();
  expect(() => assertRecoveryIoKnown()).not.toThrow();
});

// Last in this isolated test module: an unknown close is deliberately permanent.
it("retains a close failure and denies every later operation without TTL/reset", async () => {
  const f = await fixture();
  await expect(
    withRecoveryFile(f.file, freshBudget(), 100, async (handle) => {
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "close").mockImplementation(async () => {
        await close();
        throw Error("synthetic unconfirmed close response");
      });
    }),
  ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
  expect(() => assertRecoveryIoKnown()).toThrow("RECOVERY_CLOSE_UNPROVEN");
  await expect(digestRecoveryFile(f.file, freshBudget(), 100)).rejects.toThrow(
    "RECOVERY_CLOSE_UNPROVEN",
  );
});
