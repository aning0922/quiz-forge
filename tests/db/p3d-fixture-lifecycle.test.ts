import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { lstat } from "node:fs/promises";
import { beforeAll, afterAll, expect, it } from "vitest";
import { prepareP3cSource } from "./p3c-source-fixture";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { createPreauth, login } from "@/lib/auth/service";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import {
  readDraftRevisionFixture,
  cleanupDraftRevisionFixture,
} from "./p3d-draft-revision-fixture";
import {
  draftRevisionFixtureSchema,
  DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
} from "./p3d-draft-revision-fixture-contract";
import { instanceDirectory } from "@/features/quizpack/import/storage";
const exec = promisify(execFile);
let db: TestDatabase,
  complete = false;
beforeAll(async () => {
  db = await openTestDatabase();
  await resetDomainDatabase(db);
});
afterAll(async () => {
  if (db) {
    if (complete) {
      const verified = await openTestDatabase();
      try {
        await resetDomainDatabase(verified);
      } finally {
        await verified.close();
      }
    }
    await db.close();
  }
});
async function cli(action: string, runId: string) {
  await exec(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/db/p3d-draft-revision-fixture.ts",
      action,
      runId,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(process.cwd(), "tsconfig.json"),
      },
      timeout: 90000,
      maxBuffer: 32768,
    },
  );
}
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("P3D_PORT_REQUIRED"));
      server.close((e) => (e ? reject(e) : resolve(address.port)));
    });
  });
}
it("prepares five exact sources; finish never deletes; fake proof or incomplete graph cannot clean; actual owner proof permits exact final cleanup", async () => {
  const runId = randomUUID();
  await cli("prepare", runId);
  let fixture = await readDraftRevisionFixture(db, runId);
  const file = path.join(
    instanceDirectory(db.config),
    DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
  );
  expect(fixture.sources.map((s) => s.name)).toEqual([
    "initial",
    "second",
    "third",
    "spare",
    "alias-initial",
  ]);
  // Same UUID is intentional: these browser fixtures must own disjoint physical pixels.
  const p3c = await prepareP3cSource(
    `preview-${runId.slice(0, 8)}-archetype`,
    "archetype",
    runId,
  );
  const p3cHashes = new Set(p3c.blobs.map((b) => b.sha256));
  expect(fixture.blobs.every((b) => !p3cHashes.has(b.sha256))).toBe(true);
  expect(fixture.initialIdempotencyKey).toBeTruthy();
  expect(fixture.completed).toBe(false);
  expect((await lstat(file)).mode & 0o777).toBe(0o600);
  await expect(
    cleanupDraftRevisionFixture(db, runId, {} as ServerExitProof),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  for (const mutate of [
    (v: typeof fixture) => {
      v.initialIdempotencyKey = null;
    },
    (v: typeof fixture) => {
      v.draftId = null;
    },
    (v: typeof fixture) => {
      v.sources[1]!.scope.sourceImportId = v.sources[0]!.scope.sourceImportId;
    },
    (v: typeof fixture) => {
      v.sources[4]!.canonicalManifestSha256 = "b".repeat(64);
    },
    (v: typeof fixture) => {
      v.initial!.revision = 2;
    },
  ]) {
    const value = structuredClone(fixture);
    mutate(value);
    expect(draftRevisionFixtureSchema.safeParse(value).success).toBe(false);
  }
  await expect(cli("finish", runId)).rejects.toThrow();
  expect((await readDraftRevisionFixture(db, runId)).completed).toBe(false);
  const pre = await createPreauth(db.app, null, randomUUID()),
    session = await login(
      db.app,
      pre.raw,
      pre.dto.csrfToken,
      fixture.operator.secret,
      randomUUID(),
    ),
    credentials = {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    },
    first = createProductDraftService(),
    append = createProductDraftRevisionService();
  const old = await first.readDraftApplicationByKey(
    db.app,
    session.raw,
    fixture.productId,
    fixture.initialIdempotencyKey!,
  );
  expect(old.kind).toBe("applied");
  for (const name of ["second", "third"]) {
    const s = fixture.sources.find((s) => s.name === name)!;
    const current = await first.readDraft(
      db.app,
      session.raw,
      fixture.productId,
    );
    if (current.kind !== "draft") throw Error("P3D_CURRENT_REQUIRED");
    await append.appendReadyValidation(db.app, credentials, s.scope, {
      idempotencyKey: randomUUID(),
      expectedValidationStateRevision: s.expectedValidationStateRevision,
      expectedCandidateSha256: s.expectedCandidateSha256,
      target: {
        kind: "append-revision",
        draftId: fixture.draftId!,
        expectedRevision: current.draft.revision,
        expectedCanonicalContentSha256: current.draft.canonicalContentSha256,
        expectedAssetSetSha256: current.draft.assetSetSha256,
      },
    });
  }
  await cli("finish", runId);
  fixture = await readDraftRevisionFixture(db, runId);
  expect(fixture.completed).toBe(true);
  const [before] = await db.admin
    .sql`SELECT count(*)::int AS n FROM qf.draft_revision WHERE product_id=${fixture.productId}`;
  expect(before!.n).toBe(3);
  expect(
    await first.readDraftApplicationByKey(
      db.app,
      session.raw,
      fixture.productId,
      fixture.initialIdempotencyKey!,
    ),
  ).toEqual(old);
  // Real child close + PGID absence + free port; this is owner-protocol evidence, not a Next/E2E claim.
  const owner = await launchOwnedPreviewNodeProcess(
    {
      cwd: process.cwd(),
      instanceId: db.config.instanceId,
      runId,
      port: await freePort(),
      runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
    },
    ["-e", "setInterval(()=>{},1000)"],
  );
  const proof = await stopAndProveServerExit(owner);
  const result = await cleanupDraftRevisionFixture(db, runId, proof);
  expect(["empty", "not-provisioned"]).toContain(result.nativeControl);
  await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  const [after] = await db.admin
    .sql`SELECT count(*)::int AS n FROM qf.product WHERE id=${fixture.productId}`;
  expect(after!.n).toBe(0);
  complete = true;
}, 120000);
