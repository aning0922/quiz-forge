import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createPreauth, login } from "@/lib/auth/service";
import { createDatabase } from "@/lib/db/client";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { withStudioWrite } from "@/lib/auth/write";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { insertVersion } from "@/features/product/internal-versions/repository";
import {
  instanceDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
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
  const pre = await createPreauth(db.app, null, randomUUID()),
    session = await login(
      db.app,
      pre.raw,
      pre.dto.csrfToken,
      f.operator.secret,
      randomUUID(),
    ),
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
          ...actual.detail.snapshot,
          font: {
            ...actual.detail.snapshot.font,
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
