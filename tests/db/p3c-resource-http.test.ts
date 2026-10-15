import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  readFile,
  writeFile,
  lstat,
  open,
  type FileHandle,
} from "node:fs/promises";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createPreauth, login } from "@/lib/auth/service";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import * as resourceStorage from "@/features/quizpack/resource-read/storage";
import { privateDirectory } from "@/features/quizpack/import/storage";
import { blobPath } from "@/features/quizpack/import/storage";
import { handlePreviewResourceHttp } from "@/features/quizpack/resource-read/http";
import { previewResourceUrl } from "@/features/product/preview/urls";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  type OwnedPreviewServer,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import {
  readPreviewFixture,
  cleanupPreviewFixture,
  type PreviewFixture,
} from "./p3c-preview-fixture";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase,
  fixture: PreviewFixture,
  owner: OwnedPreviewServer,
  token: string,
  sessionId: string;
const runId = randomUUID();
async function command(action: "prepare" | "finish") {
  try {
    await promisify(execFile)(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "tests/db/p3c-preview-fixture.ts",
        action,
        runId,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: action === "prepare" ? 90000 : 30000,
        maxBuffer: 4096,
      },
    );
  } catch {
    throw Error("P3C_PRIVATE_FIXTURE_CHILD_FAILED");
  }
}
beforeAll(async () => {
  db = await openTestDatabase();
  await command("prepare");
  fixture = await readPreviewFixture(db, runId);
  const pre = await createPreauth(db.app, null, randomUUID());
  const session = await login(
    db.app,
    pre.raw,
    pre.dto.csrfToken,
    fixture.readOnly.secret,
    randomUUID(),
  );
  token = session.raw;
  const [row] = await db.admin.sql<
    { id: string }[]
  >`SELECT id FROM qf.operator_session WHERE operator_id=${fixture.readOnly.identifier} AND revoked_at IS NULL AND kind='authenticated' ORDER BY created_at DESC LIMIT 1`;
  if (!row) throw Error("P3C_PRIVATE_SESSION_REQUIRED");
  sessionId = row.id;
  // Real owned Node process tests lifecycle/proof. This is not a Next/browser certification.
  owner = await launchOwnedPreviewNodeProcess(
    {
      cwd: process.cwd(),
      instanceId: db.config.instanceId,
      runId,
      port: Number(new URL(db.config.origin).port),
      runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
    },
    ["-e", "setInterval(()=>{},1000)"],
  );
}, 95_000);
afterAll(async () => {
  if (owner) {
    const proof = await stopAndProveServerExit(owner);
    await command("finish");
    await cleanupPreviewFixture(db, runId, proof);
  }
  await db?.close();
});
function request(
  extra: {
    method?: string;
    headers?: Record<string, string>;
    bindingHash?: string;
    signal?: AbortSignal;
  } = {},
) {
  const source = fixture.sources[0]!,
    url = previewResourceUrl({
      binding: extra.bindingHash
        ? { ...source.binding, assetSetSha256: extra.bindingHash }
        : source.binding,
      resourceRef: {
        productId: source.scope.productId,
        id: "neutral-cover",
        version: "1.0.0",
      },
    });
  return handlePreviewResourceHttp(
    new Request(db.config.origin + url, {
      method: extra.method ?? "GET",
      signal: extra.signal ?? null,
      headers: {
        host: new URL(db.config.origin).host,
        cookie: `${SESSION_COOKIE}=${token}`,
        ...extra.headers,
      },
    }),
    { ...source.scope, revision: String(source.scope.revision) },
  );
}
it("serves actual PG-authorized private pixels with complete verified bytes and no conditional caching", async () => {
  const response = await request({ headers: { "if-none-match": "*" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.has("etag")).toBe(false);
  expect(response.headers.has("last-modified")).toBe(false);
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(bytes.length).toBe(Number(response.headers.get("content-length")));
  const [cover] = await db.admin.sql<
    { blob_sha256: string }[]
  >`SELECT blob_sha256 FROM qf.product_asset WHERE product_id=${fixture.sources[0]!.scope.productId} AND resource_id='neutral-cover'`;
  expect(bytes).toEqual(
    await readFile(blobPath(db.config, cover!.blob_sha256)),
  );
});
it("rejects HEAD, Range, malformed resource and mismatched immutable binding", async () => {
  expect((await request({ method: "HEAD" })).status).toBe(400);
  expect((await request({ headers: { range: "bytes=0-4" } })).status).toBe(400);
  const mismatch = await request({ bindingHash: "f".repeat(64) });
  expect(mismatch.status).toBe(409);
  expect((await mismatch.json()).code).toBe("PREVIEW_BINDING_MISMATCH");
});
it("a corrupted real file never publishes unverified image bytes", async () => {
  const source = fixture.sources[0]!,
    r = await db.admin.sql<
      { blob_sha256: string }[]
    >`SELECT blob_sha256 FROM qf.product_asset WHERE product_id=${source.scope.productId} AND resource_id='neutral-cover'`;
  const file = blobPath(db.config, r[0]!.blob_sha256),
    bytes = await readFile(file);
  try {
    await writeFile(file, Buffer.alloc(bytes.length, 0));
    const result = await request();
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe("PREVIEW_RESOURCE_UNAVAILABLE");
  } finally {
    await writeFile(file, bytes);
  }
});
it("fifth actual resource response is busy until existing verified bodies end", async () => {
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => request()),
  );
  try {
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const fifth = await request();
    expect(fifth.status).toBe(503);
    expect(fifth.headers.get("retry-after")).toBe("1");
    expect((await fifth.json()).code).toBe("PREVIEW_BUSY");
  } finally {
    await Promise.all(responses.map((r) => r.body?.cancel()));
  }
});
it("actual late open after request abort is closed before its slot is returned", async () => {
  let entered!: () => void,
    release!: () => void,
    handle: FileHandle | undefined;
  const opened = new Promise<void>((r) => {
      entered = r;
    }),
    gate = new Promise<void>((r) => {
      release = r;
    });
  const read = resourceStorage.createPrivateResourceReader({
    lstat,
    privateDirectory,
    open: async (...args: Parameters<typeof open>) => {
      handle = await open(...args);
      entered();
      await gate;
      return handle;
    },
  });
  const spy = vi
    .spyOn(resourceStorage, "readPrivateResource")
    .mockImplementationOnce(read);
  const controller = new AbortController();
  const response = request({ signal: controller.signal });
  try {
    await opened;
    controller.abort();
    release();
    const actual = await response;
    expect(actual.status).toBe(499);
    await expect(handle!.stat()).rejects.toThrow();
  } finally {
    release();
    spy.mockRestore();
    await response;
  }
});
it("actual revoke after complete file read is caught by a NEW final authorization transaction", async () => {
  const original = resourceStorage.readPrivateResource;
  const spy = vi
    .spyOn(resourceStorage, "readPrivateResource")
    .mockImplementationOnce(async (...args) => {
      const bytes = await original(...args);
      await db.admin
        .sql`UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE id=${sessionId}`;
      return bytes;
    });
  try {
    const response = await request();
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHENTICATED");
  } finally {
    spy.mockRestore();
  }
  const pre = await createPreauth(db.app, null, randomUUID()),
    session = await login(
      db.app,
      pre.raw,
      pre.dto.csrfToken,
      fixture.readOnly.secret,
      randomUUID(),
    );
  token = session.raw;
  const [row] = await db.admin.sql<
    { id: string }[]
  >`SELECT id FROM qf.operator_session WHERE operator_id=${fixture.readOnly.identifier} AND revoked_at IS NULL AND kind='authenticated' ORDER BY created_at DESC LIMIT 1`;
  sessionId = row!.id;
});
it("cleanup rejects fake proof before touching fixture and new resource requests reject actual revoke", async () => {
  await expect(
    cleanupPreviewFixture(db, runId, {} as ServerExitProof),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  await safe(
    () =>
      db.admin
        .sql`UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE id=${sessionId}`,
  );
  const response = await request();
  expect(response.status).toBe(401);
  expect((await response.json()).code).toBe("UNAUTHENTICATED");
  // Reopen application pool if previous independent service request closed its own pool only.
  expect(db.app.sql).toBeDefined();
});
