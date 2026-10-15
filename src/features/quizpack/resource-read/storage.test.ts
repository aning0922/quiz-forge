import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  writeFile,
  chmod,
  symlink,
  link,
  rm,
  open,
  lstat,
  type FileHandle,
} from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { ResolvedPreviewResource } from "@/features/product/preview/repository";
import {
  blobPath,
  instanceDirectory,
  uploadsDirectory,
  blobsDirectory,
  privateDirectory,
} from "../import/storage";
import { createPrivateResourceReader, readPrivateResource } from "./storage";
import { ResourceReadTask } from "./task";
let config: P2aRuntimeConfig, file: string, resource: ResolvedPreviewResource;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6WV1sAAAAASUVORK5CYII=",
  "base64",
);
beforeEach(async () => {
  config = { instanceId: randomBytes(16).toString("hex") } as P2aRuntimeConfig;
  const base = path.dirname(instanceDirectory(config));
  await mkdir(base, { recursive: true, mode: 0o700 });
  await privateDirectory(base);
  for (const dir of [
    instanceDirectory(config),
    uploadsDirectory(config),
    blobsDirectory(config),
  ])
    await mkdir(dir, { mode: 0o700 });
  resource = {
    resourceRef: { productId: "synthetic", id: "cover", version: "1.0.0" },
    sha256: createHash("sha256").update(png).digest("hex"),
    bytes: png.length,
    mediaType: "image/png",
    width: 1,
    height: 1,
  };
  file = blobPath(config, resource.sha256);
  await writeFile(file, png, { mode: 0o600 });
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(instanceDirectory(config), { recursive: true, force: true });
});
it("reads actual private blob, verifies hash and closes descriptor before returning", async () => {
  const handles: FileHandle[] = [];
  const read = createPrivateResourceReader({
    lstat,
    privateDirectory,
    open: async (...args: Parameters<typeof open>) => {
      const h = await open(...args);
      handles.push(h);
      return h;
    },
  });
  expect(await read(config, resource, () => {})).toEqual(png);
  expect(handles).toHaveLength(1);
  await expect(handles[0]!.stat()).rejects.toThrow();
});
it.each([
  "changed hash",
  "changed size",
  "wrong MIME",
  "public file",
  "hardlink",
  "symlink",
  "missing",
  "directory permissions",
])("rejects actual %s before returning bytes", async (kind) => {
  if (kind === "changed hash")
    await writeFile(file, Buffer.alloc(png.length, 0));
  if (kind === "changed size") await writeFile(file, png.subarray(0, -1));
  if (kind === "wrong MIME")
    resource = { ...resource, mediaType: "image/jpeg" };
  if (kind === "public file") await chmod(file, 0o644);
  if (kind === "hardlink") await link(file, file + ".copy");
  if (kind === "symlink") {
    await rm(file);
    await symlink("absent", file);
  }
  if (kind === "missing") await rm(file);
  if (kind === "directory permissions")
    await chmod(uploadsDirectory(config), 0o755);
  await expect(
    readPrivateResource(config, resource, () => {}),
  ).rejects.toMatchObject({ code: "PREVIEW_RESOURCE_UNAVAILABLE" });
});
it("a genuinely late opened FD is closed after cancel, not dropped by a promise race", async () => {
  let entered!: () => void, release!: () => void;
  const opening = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  let handle: FileHandle | undefined;
  const reader = createPrivateResourceReader({
    lstat,
    privateDirectory,
    open: async (...args: Parameters<typeof open>) => {
      handle = await open(...args);
      entered();
      await gate;
      return handle;
    },
  });
  const abort = new AbortController(),
    task = ResourceReadTask.acquire(abort.signal);
  const work = task.run(() =>
    reader(config, resource, () => task.checkpoint()),
  );
  const outcome = work.catch((e) => e);
  await opening;
  abort.abort();
  expect(handle).toBeDefined();
  await handle!.stat(); // actual FD remains held until open promise returns
  release();
  expect(await outcome).toMatchObject({ code: "PREVIEW_CANCELLED" });
  await expect(handle!.stat()).rejects.toThrow();
});
it("checks cancellation after actual read settles and still closes its real FD", async () => {
  let handle: FileHandle | undefined,
    checks = 0;
  const reader = createPrivateResourceReader({
    lstat,
    privateDirectory,
    open: async (...args: Parameters<typeof open>) => {
      handle = await open(...args);
      return handle;
    },
  });
  await expect(
    reader(config, resource, () => {
      if (handle && ++checks === 3) throw new Error("cancelled");
    }),
  ).rejects.toMatchObject({ code: "PREVIEW_RESOURCE_UNAVAILABLE" });
  expect(handle).toBeDefined();
  await expect(handle!.stat()).rejects.toThrow();
});
it("a rejected real-handle close reports unconfirmed ownership for quarantine", async () => {
  let handle: FileHandle | undefined;
  const quarantine = vi.fn();
  const reader = createPrivateResourceReader({
    lstat,
    privateDirectory,
    open: async (...args: Parameters<typeof open>) => {
      handle = await open(...args);
      vi.spyOn(handle, "close").mockRejectedValueOnce(
        Error("synthetic close failure"),
      );
      return handle;
    },
  });
  try {
    await expect(
      reader(
        config,
        resource,
        () => {},
        () => {},
        quarantine,
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_RESOURCE_UNAVAILABLE" });
    expect(quarantine).toHaveBeenCalledWith(handle);
    await handle!.stat();
  } finally {
    await handle?.close();
  }
});
