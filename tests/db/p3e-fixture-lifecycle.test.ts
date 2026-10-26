import type { VersionSnapshotV1 } from "../support/legacy-fixture-types";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import { lstat, readFile, open } from "node:fs/promises";
import { constants, type Stats } from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { loginVersionFixtureAccount } from "./version-account-fixture";
import { createDatabase } from "@/lib/db/client";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { withStudioWrite } from "@/lib/auth/write";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { insertVersion } from "@/features/product/internal-versions/repository";
import {
  instanceDirectory,
  blobPath,
  ensureStorage,
  removeOwned,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { configureImports } from "@/features/quizpack/import/config-management";
import { assertNoRetainedInternalReferences } from "@/features/product/internal-versions/retention";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { quizPackContentSchema } from "@/features/quizpack/v1/content";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { sealSupportedReport } from "@/features/quizpack/server/validation/report";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import { authenticateTestOperator } from "./p2a-fixture";
import { prepareP3eSource } from "./p3e-source-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";
import {
  readInternalVersionFixture,
  cleanupInternalVersionFixture,
  INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
} from "./p3e-internal-version-fixture";
import {
  internalVersionFixtureSchema,
  type InternalVersionFixture,
} from "./p3e-internal-version-fixture-contract";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  type ServerExitProof,
} from "../support/p3c-server-owner";

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
      "tests/db/p3e-internal-version-fixture.ts",
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
async function prepareWithExistingAuthWindow(runId: string) {
  // Only this bounded PG test skips reserving an ENTIRE future E2E login window.
  // Password login remains a real service call; only this fixture-owned completed reservation is retired.
  await exec(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      "import {openTestDatabase} from './tests/db/p2a-fixture.ts'; import {prepareInternalVersionFixture} from './tests/db/p3e-internal-version-fixture.ts'; const db=await openTestDatabase(); try{await prepareInternalVersionFixture(db,process.argv[1]);}finally{await db.close();}",
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
async function legacySharedSource(productId: string, runId: string) {
  // An UNREGISTERED old v1 source shares four test PNG byte strings only. No baseline approval is copied.
  const base = await prepareP2b3Source(productId, { engine: "archetype" }),
    fixed = await prepareP3eSource(runId);
  const sha = (x: string | Uint8Array) =>
    createHash("sha256").update(x).digest("hex");
  const assetFiles: { path: string; bytes: Buffer }[] = [];
  const content = quizPackContentSchema.parse({
    ...base.candidate.facts.content,
    product: {
      ...base.candidate.facts.content.product,
      title: "Unregistered shared-pixel source",
    },
    resources: base.candidate.facts.content.resources.map((r) => {
      const f = fixed.candidate.facts.resources.find(
        (f) => f.declaration.id === r.id,
      )!;
      const image = fixed.assetFiles.find(
        (a) => a.path === f.declaration.path,
      )!;
      const resource = {
        ...r,
        path: `assets/${r.id}.png`,
        mediaType: "image/png",
        width: 48,
        height: 48,
        bytes: image.bytes.length,
        sha256: sha(image.bytes),
      };
      assetFiles.push({ path: resource.path, bytes: image.bytes });
      return resource;
    }),
  });
  const text = canonicalP1Json(content),
    manifest = supportedManifestSchema.parse({
      ...base.candidate.facts.manifest,
      files: [
        {
          path: "content.json",
          mediaType: "application/json",
          bytes: Buffer.byteLength(text),
          sha256: sha(text),
        },
        ...content.resources.map((r) => ({
          path: r.path,
          mediaType: r.mediaType,
          bytes: r.bytes,
          sha256: r.sha256,
        })),
      ],
    }),
    manifestText = canonicalP1Json(manifest, "manifest"),
    archiveSha256 = sha(`unregistered old shared-pixel fixture:${runId}`);
  if (base.result.evidence.report.status !== "sealed")
    throw Error("SYNTHETIC_REPORT_REQUIRED");
  const result = sealCandidateResultEvidence({
    ...base.result,
    evidence: {
      ...base.result.evidence,
      input: {
        status: "snapshotted",
        archiveSha256,
        archiveBytes: 100,
        targetProductId: productId,
      },
      report: sealSupportedReport({
        ...base.result.evidence.report.value,
        archiveSha256,
        manifestSha256: sha(manifestText),
        contentSha256: sha(text),
      }),
      media: content.resources.map((r, resourceIndex) => ({
        resourceIndex,
        result: {
          outcome: "decoded" as const,
          runId: randomUUID(),
          profileId: "a".repeat(64),
          stopped: "confirmed" as const,
          facts: {
            mediaType: r.mediaType,
            width: r.width,
            height: r.height,
            frames: 1,
            mediaDecoded: true,
          },
        },
      })),
    },
  });
  if (result.outcome !== "accepted")
    throw Error("SYNTHETIC_SHARED_SOURCE_REQUIRED");
  const facts = issuePrivateCandidate(
    result,
    new Map([
      ["manifest.json", Buffer.from(manifestText)],
      ["content.json", Buffer.from(text)],
      ...assetFiles.map((a) => [a.path, a.bytes] as [string, Buffer]),
    ]),
  ).facts;
  expect(matchRegisteredBaseline(facts, db.config.purpose)).toBeNull();
  return {
    ...base,
    archiveSha256,
    result,
    assetFiles,
    candidate: {
      facts,
      manifestSha256: sha(manifestText),
      contentSha256: sha(text),
    },
    blobs: facts.resources.map((r) => ({
      sha256: r.blobSha256,
      bytes: r.bytes,
      mediaType: r.declaration.mediaType,
      width: r.declaration.width,
      height: r.declaration.height,
      frames: 1 as const,
    })),
  };
}
async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("P3E_PORT_REQUIRED"));
      server.close((e) => (e ? reject(e) : resolve(address.port)));
    });
  });
}
async function applyUiOperations(f: InternalVersionFixture) {
  const session = await loginVersionFixtureAccount(db, f.operator),
    credentials = {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    };
  const operation = async <T>(
    work: (
      service: ReturnType<typeof createProductInternalVersionService>,
      database: Awaited<ReturnType<typeof createDatabase>>,
      budget: ReturnType<typeof createStudioRequestBudget>["budget"],
    ) => Promise<T>,
  ) => {
    const clock = createStudioRequestBudget(new AbortController().signal),
      database = await createDatabase(db.config, clock.budget),
      owner = createInternalVersionOwner(database, clock);
    try {
      return await work(
        createProductInternalVersionService(owner),
        database,
        clock.budget,
      );
    } finally {
      await owner.closeIfNotTransferred();
    }
  };
  const review = await operation((s, d, b) =>
    s.recordBaseline(
      d,
      credentials,
      { productId: f.productId, draftId: f.draftId!, revision: 1 },
      {
        schemaVersion: "quizforge.review-record.v1",
        idempotencyKey: randomUUID(),
        target: f.target!,
        baseline: f.baseline!,
      },
      b,
    ),
  );
  const version = await operation((s, d, b) =>
    s.sealInternalVersion(
      d,
      credentials,
      f.productId,
      {
        schemaVersion: "quizforge.internal-version-seal.v1",
        idempotencyKey: randomUUID(),
        target: f.target!,
        reviewId: review.review.id,
        reviewSha256: review.review.reviewSha256,
        renderer: f.renderer!,
        engine: f.engine!,
      },
      b,
    ),
  );
  return {
    credentials,
    review: review.review,
    detail: await operation((s, d) =>
      s.readVersion(d, session.raw, f.productId, version.version.id),
    ),
  };
}
it("reserves one exact fixed fixture, observes actual operations, preserves unowned ledger before unlink, and only real exit permits final cleanup", async () => {
  // Earlier suites may leave imports enabled. Establish cleanup's REAL prerequisite
  // before even the first negative probe, so later negatives exercise the graph checks.
  await configureImports(db.config.instanceId, false);
  const runId = randomUUID();
  await cli("prepare", runId);
  let fixture = await readInternalVersionFixture(db, runId);
  expect(fixture.sources.map((s) => s.name)).toEqual(["baseline", "next"]);
  expect(fixture.blobs).toHaveLength(5);
  expect(fixture.blobs.every((b) => b.created)).toBe(true);
  expect(fixture.review).toBeNull();
  expect(fixture.versionDetail).toBeNull();
  const file = path.join(
    instanceDirectory(db.config),
    INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  );
  expect((await lstat(file)).mode & 0o777).toBe(0o600);
  await expect(cli("prepare", randomUUID())).rejects.toThrow();
  await expect(cli("finish", runId)).rejects.toThrow();
  expect((await readInternalVersionFixture(db, runId)).completed).toBe(false);
  await expect(
    cleanupInternalVersionFixture(db, runId, {} as ServerExitProof),
  ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
  for (const mutate of [
    (v: InternalVersionFixture) => {
      v.target!.canonicalContentSha256 = "f".repeat(64);
    },
    (v: InternalVersionFixture) => {
      v.operator.identifier = v.readOnly.identifier;
    },
    (v: InternalVersionFixture) => {
      v.sources[1]!.scope.sourceValidationId =
        v.sources[0]!.scope.sourceValidationId;
    },
  ]) {
    const value = structuredClone(fixture);
    mutate(value);
    expect(internalVersionFixtureSchema.safeParse(value).success).toBe(false);
  }
  const actual = await applyUiOperations(fixture);
  await cli("finish", runId);
  fixture = await readInternalVersionFixture(db, runId);
  expect(fixture.completed).toBe(true);
  expect(fixture.review?.id).toBe(actual.review.id);
  expect(fixture.versionDetail?.version.id).toBe(actual.detail.version.id);
  // Explicit extra synthetic DB fact, never registered as an executable renderer/font.
  const foreign = await withStudioWrite(
    db.app,
    actual.credentials,
    "version:seal-internal",
    (tx, actor) =>
      insertVersion(
        tx,
        { ...actual.detail.version.binding, idempotencyKey: randomUUID() },
        {
          ...(actual.detail.snapshot as VersionSnapshotV1),
          font: {
            ...(actual.detail.snapshot as VersionSnapshotV1).font,
            id: "unregistered-foreign-fixture-font",
          },
        },
        2,
        actor,
      ),
  );
  const owner = await launchOwnedPreviewNodeProcess(
      {
        cwd: process.cwd(),
        instanceId: db.config.instanceId,
        runId,
        port: await freePort(),
        runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
      },
      ["-e", "setInterval(()=>{},1000)"],
    ),
    proof = await stopAndProveServerExit(owner);
  const pixel = blobPath(db.config, fixture.blobs[0]!.sha256),
    before = await readFile(pixel);
  await expect(cleanupInternalVersionFixture(db, runId, proof)).rejects.toThrow(
    "INTERNAL_VERSION_FIXTURE_UNKNOWN_PRESERVED",
  );
  expect(await readFile(pixel)).toEqual(before);
  const [kept] = await db.admin.sql<
    { reviews: number; versions: number }[]
  >`SELECT (SELECT count(*)::int FROM qf.draft_review WHERE product_id=${fixture.productId}) AS reviews,(SELECT count(*)::int FROM qf.product_version WHERE product_id=${fixture.productId}) AS versions`;
  expect(kept).toEqual({ reviews: 1, versions: 2 });
  await db.admin
    .sql`DELETE FROM qf.product_version WHERE id=${foreign.id} AND snapshot_sha256=${foreign.snapshotSha256} AND fingerprint=${foreign.fingerprint}`;
  db.app = await createDatabase(db.config);
  const outsider = await authenticateTestOperator(db);
  const extra = await seedReadyP2b3Source(
    db,
    outsider,
    await prepareP3eSource(randomUUID(), 3),
    { createProduct: false },
  );
  const beforeFiles = await Promise.all(
    fixture.blobs.map((b) => readFile(blobPath(db.config, b.sha256))),
  );
  await expect(cleanupInternalVersionFixture(db, runId, proof)).rejects.toThrow(
    "INTERNAL_VERSION_FIXTURE_UNKNOWN_PRESERVED",
  );
  const [retained] = await db.admin.sql<
    {
      reviews: number;
      versions: number;
      imports: number;
      validations: number;
      foreign_import: boolean;
      foreign_validation: boolean;
      foreign_actor: boolean;
    }[]
  >`SELECT (SELECT count(*)::int FROM qf.draft_review WHERE product_id=${fixture.productId}) reviews,(SELECT count(*)::int FROM qf.product_version WHERE product_id=${fixture.productId}) versions,(SELECT count(*)::int FROM qf.quizpack_import WHERE product_id=${fixture.productId}) imports,(SELECT count(*)::int FROM qf.quizpack_validation WHERE product_id=${fixture.productId}) validations,EXISTS(SELECT 1 FROM qf.quizpack_import WHERE id=${extra.scope.sourceImportId} AND created_by=${outsider.id}) foreign_import,EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE id=${extra.scope.sourceValidationId} AND created_by=${outsider.id} AND reserved_bytes=0) foreign_validation,EXISTS(SELECT 1 FROM qf.operator WHERE id=${outsider.id}) foreign_actor`;
  expect(retained).toEqual({
    reviews: 1,
    versions: 1,
    imports: 3,
    validations: 3,
    foreign_import: true,
    foreign_validation: true,
    foreign_actor: true,
  });
  for (const [i, b] of fixture.blobs.entries())
    expect(await readFile(blobPath(db.config, b.sha256))).toEqual(
      beforeFiles[i],
    );
  // Remove only this deliberately injected no-file source/actor, after proving rejection preserved EVERYTHING.
  await db.admin.sql.begin(async (tx) => {
    await tx`DELETE FROM qf.quizpack_validation WHERE id=${extra.scope.sourceValidationId} AND created_by=${outsider.id}`;
    await tx`DELETE FROM qf.quizpack_import WHERE id=${extra.scope.sourceImportId} AND created_by=${outsider.id}`;
    await tx`DELETE FROM qf.audit_event WHERE actor_id=${outsider.id}`;
    await tx`DELETE FROM qf.operator_session WHERE operator_id=${outsider.id}`;
    await tx`DELETE FROM qf.operator WHERE id=${outsider.id}`;
  });
  db.app = await createDatabase(db.config);
  const next = fixture.sources.find((s) => s.name === "next")!;
  await createProductDraftRevisionService().appendReadyValidation(
    db.app,
    actual.credentials,
    next.scope,
    {
      idempotencyKey: randomUUID(),
      expectedValidationStateRevision: next.expectedValidationStateRevision,
      expectedCandidateSha256: next.expectedCandidateSha256,
      target: {
        kind: "append-revision",
        draftId: fixture.draftId!,
        expectedRevision: 1,
        expectedCanonicalContentSha256: fixture.target!.canonicalContentSha256,
        expectedAssetSetSha256: fixture.target!.assetSetSha256,
      },
    },
  );
  const result = await cleanupInternalVersionFixture(db, runId, proof);
  expect(["empty", "not-provisioned"]).toContain(result.nativeControl);
  await expect(lstat(file)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(pixel)).rejects.toMatchObject({ code: "ENOENT" });
  const [remaining] = await db.admin.sql<
    { reviews: number; versions: number; products: number }[]
  >`SELECT (SELECT count(*)::int FROM qf.draft_review) AS reviews,(SELECT count(*)::int FROM qf.product_version) AS versions,(SELECT count(*)::int FROM qf.product WHERE id=${fixture.productId}) AS products`;
  expect(remaining).toEqual({ reviews: 0, versions: 0, products: 0 });
  complete = true;
});

it("retains four earlier-owned shared PNGs and their old source while deleting only its own new scene", async () => {
  complete = false;
  db.app = await createDatabase(db.config);
  await resetDomainDatabase(db);
  await configureImports(db.config.instanceId, false);
  const auth = await authenticateTestOperator(db),
    runId = randomUUID(),
    old = await legacySharedSource(`legacy-shared-${runId}`, runId),
    source = await seedReadyP2b3Source(db, auth, old);
  const owned: {
    file: string;
    inode: Stats;
    bytes: Buffer;
  }[] = [];
  const lock = await StorageLock.acquire(db.config);
  try {
    await ensureStorage(db.config);
    for (const resource of old.candidate.facts.resources) {
      const file = blobPath(db.config, resource.blobSha256),
        bytes = old.assetFiles.find(
          (a) => a.path === resource.declaration.path,
        )!.bytes;
      const h = await open(
        file,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await h.writeFile(bytes);
        await h.sync();
        owned.push({ file, inode: await h.stat(), bytes });
      } finally {
        await h.close();
      }
    }
  } finally {
    await lock.close();
  }
  await prepareWithExistingAuthWindow(runId);
  const fixture = await readInternalVersionFixture(db, runId);
  expect(fixture.blobs.filter((b) => !b.created)).toHaveLength(4);
  expect(fixture.blobs.filter((b) => b.created)).toHaveLength(1);
  await applyUiOperations(fixture);
  await cli("finish", runId);
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
  await cleanupInternalVersionFixture(
    db,
    runId,
    await stopAndProveServerExit(owner),
  );
  for (const file of owned)
    expect(await readFile(file.file)).toEqual(file.bytes);
  await expect(
    lstat(blobPath(db.config, fixture.blobs.find((b) => b.created)!.sha256)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const [kept] = await db.admin.sql<
    { assets: number; sources: number }[]
  >`SELECT (SELECT count(*)::int FROM qf.product_asset WHERE product_id=${source.scope.productId}) AS assets,(SELECT count(*)::int FROM qf.quizpack_validation WHERE id=${source.scope.sourceValidationId} AND status='ready') AS sources`;
  expect(kept).toEqual({ assets: 4, sources: 1 });
  const cleanup = await StorageLock.acquire(db.config);
  try {
    await assertNoRetainedInternalReferences(cleanup, {
      revisions: [],
      imports: [
        { productId: source.scope.productId, id: source.scope.sourceImportId },
      ],
      validations: [
        {
          productId: source.scope.productId,
          id: source.scope.sourceValidationId,
        },
      ],
      blobSha256: old.blobs.map((b) => b.sha256),
    });
    for (const file of owned) await removeOwned(file.file, file.inode);
  } finally {
    await cleanup.close();
  }
  await resetDomainDatabase(db);
  complete = true;
});
