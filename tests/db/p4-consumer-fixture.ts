import { constants } from "node:fs";
import { open, lstat, rename, unlink } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  loginVersionFixtureAccount,
  seedVersionFixtureAccount,
} from "./version-account-fixture";

import { createDatabase } from "@/lib/db/client";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { currentConfig } from "@/features/quizpack/import/service";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  createReceiveContext,
  remainingReceiveMs,
} from "@/features/quizpack/import/context";
import {
  instanceDirectory,
  ensureStorage,
  blobPath,
  privateFile,
  scanStorage,
  scannedFiles,
  removeOwned,
  importDirectory,
  validationDirectory,
  assertNoConfigGuard,
} from "@/features/quizpack/import/storage";
import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import { readFrozenDraftSourceEvidenceReadonly } from "@/features/quizpack/draft-source-evidence";
import { createProductDraftService } from "@/features/product/drafts/service";
import { matchRegisteredBaseline } from "@/features/product/internal-versions/baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import {
  rendererIdentitySchema,
  engineIdentitySchema,
  internalCanonicalText,
} from "@/features/product/internal-versions/contracts";
import { createProductInternalVersionService } from "@/features/product/internal-versions/service";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import {
  verifyInternalReviewReceipt,
  verifyInternalVersionDetail,
} from "@/features/product/internal-versions/integrity";
import {
  CONSUMER_IMPLEMENTATION_AVAILABILITY,
  consumerImplementationAvailable,
} from "@/features/product/internal-play/implementation-catalog";
import {
  consumerRendererIdentitySchema,
  type ConsumerRendererIdentity,
} from "@/lib/consumer-contract/v1/identities";
import { prepareP4ConsumerSource } from "./p4-source-fixture";
import { seedReadyP2b3Source } from "./p2b3-fixture";
import {
  openTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { ownerAbsent } from "./p2b2b-fixture-contract";
import { waitForPreviewAuthBudget } from "./p3c-auth-budget";
import { inspectPreviewNativeControl } from "./p3c-native-control";
import {
  assertServerExitProof,
  type ServerExitProof,
} from "../support/p3c-server-owner";
import {
  CONSUMER_FIXTURE_PRIVATE_NAME,
  CONSUMER_OBSERVATIONS_PRIVATE_NAME,
  CONSUMER_FIXTURE_MAX_BYTES,
  consumerFixtureSchema,
  consumerFixtureObservationsSchema,
  type ConsumerFixture,
  type ConsumerFixtureObservations,
} from "./p4-consumer-fixture-contract";
import {
  consumerFixtureFailure as fail,
  verifyConsumerFixtureGraph,
} from "./p4-consumer-fixture-graph";
import {
  assertConsumerFixtureKnown,
  retainConsumerFixtureUnknown,
} from "./p4-consumer-fixture-owner";
export {
  CONSUMER_FIXTURE_PRIVATE_NAME,
  consumerFixtureSchema,
  type ConsumerFixture,
} from "./p4-consumer-fixture-contract";

const fixturePath = (db: TestDatabase) =>
  path.join(instanceDirectory(db.config), CONSUMER_FIXTURE_PRIVATE_NAME);
const observationsPath = (db: TestDatabase) =>
  path.join(instanceDirectory(db.config), CONSUMER_OBSERVATIONS_PRIVATE_NAME);
const same = (a: unknown, b: unknown) =>
  internalCanonicalText(a) === internalCanonicalText(b);
function requireTest(db: TestDatabase) {
  assertConsumerFixtureKnown();
  if (!["test", "ci"].includes(db.config.purpose)) throw fail();
}
async function absent(file: string) {
  try {
    await lstat(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  throw fail();
}
async function privateJson(
  file: string,
  onUnconfirmed: (handle: unknown) => void = retainConsumerFixtureUnknown,
) {
  assertConsumerFixtureKnown();
  const before = await lstat(file);
  privateFile(before);
  if (before.nlink !== 1 || before.size > CONSUMER_FIXTURE_MAX_BYTES)
    throw fail();
  const h = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(
    (e) => {
      retainConsumerFixtureUnknown("manifest-read-open");
      throw e;
    },
  );
  try {
    const st = await h.stat();
    privateFile(st);
    if (
      st.nlink !== 1 ||
      st.ino !== before.ino ||
      st.dev !== before.dev ||
      st.size > CONSUMER_FIXTURE_MAX_BYTES
    )
      throw fail();
    const bytes = Buffer.alloc(CONSUMER_FIXTURE_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = await h.read(bytes, length, bytes.length - length, length);
      length += read.bytesRead;
      if (length > CONSUMER_FIXTURE_MAX_BYTES) throw fail();
      if (read.bytesRead === 0) break;
    }
    const after = await h.stat(),
      current = await lstat(file);
    privateFile(after);
    privateFile(current);
    if (
      after.nlink !== 1 ||
      current.nlink !== 1 ||
      current.ino !== st.ino ||
      current.dev !== st.dev ||
      after.size !== st.size ||
      after.mtimeMs !== st.mtimeMs ||
      length !== st.size
    )
      throw fail();
    return JSON.parse(bytes.subarray(0, length).toString("utf8")) as unknown;
  } finally {
    try {
      await h.close();
    } catch (e) {
      retainConsumerFixtureUnknown(h);
      onUnconfirmed(h);
      throw e;
    }
  }
}
async function save(db: TestDatabase, value: ConsumerFixture, create = false) {
  assertConsumerFixtureKnown();
  const bytes = Buffer.from(JSON.stringify(consumerFixtureSchema.parse(value)));
  if (bytes.length > CONSUMER_FIXTURE_MAX_BYTES) throw fail();
  const file = fixturePath(db),
    before = create ? null : await lstat(file);
  if (before) {
    privateFile(before);
    if (before.nlink !== 1) throw fail();
  }
  const target = create ? file : `${file}.tmp-${randomUUID()}`;
  const h = await open(
    target,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  ).catch((e) => {
    retainConsumerFixtureUnknown("manifest-write-open");
    throw e;
  });
  try {
    const st = await h.stat();
    privateFile(st);
    if (st.nlink !== 1) throw fail();
    try {
      await h.writeFile(bytes);
      await h.sync();
    } catch (e) {
      retainConsumerFixtureUnknown(h);
      throw e;
    }
  } finally {
    try {
      await h.close();
    } catch (e) {
      retainConsumerFixtureUnknown(h);
      throw e;
    }
  }
  if (before) {
    const st = await lstat(file);
    privateFile(st);
    if (st.ino !== before.ino || st.dev !== before.dev || st.nlink !== 1)
      throw fail();
    try {
      await rename(target, file);
    } catch (e) {
      retainConsumerFixtureUnknown(h);
      throw e;
    }
  }
  assertConsumerFixtureKnown();
}
export async function readConsumerFixture(
  db: TestDatabase,
  runId: string,
): Promise<ConsumerFixture> {
  requireTest(db);
  z.uuid().parse(runId);
  const v = consumerFixtureSchema.parse(await privateJson(fixturePath(db)));
  if (v.instanceId !== db.config.instanceId || v.runId !== runId || !v.prepared)
    throw fail();
  if (v.review) await verifyInternalReviewReceipt(v.review);
  if (v.parent) await verifyInternalVersionDetail(v.parent);
  assertConsumerFixtureKnown();
  return v;
}
export async function prepareConsumerFixture(
  db: TestDatabase,
  runId: string,
  consumerRenderer: ConsumerRendererIdentity = CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
): Promise<ConsumerFixture> {
  requireTest(db);
  const selectedConsumerRenderer =
    consumerRendererIdentitySchema.parse(consumerRenderer);
  if (!consumerImplementationAvailable(selectedConsumerRenderer)) throw fail();
  z.uuid().parse(runId);
  await absent(fixturePath(db));
  await absent(observationsPath(db));
  const [present] = await db.admin.sql<
    { present: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id='consumer-flow-fixture') AS present`;
  if (present?.present !== false) throw fail();
  const value: ConsumerFixture = {
    version: 1,
    qualification:
      "synthetic-db-private-pixels-real-reads-no-native-validation",
    instanceId: db.config.instanceId,
    runId,
    writerPid: process.pid,
    productId: "consumer-flow-fixture",
    prepared: false,
    finished: false,
    completed: false,
    operator: {
      identifier: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
    },
    readOnly: {
      identifier: randomUUID(),
      secret: randomBytes(32).toString("base64url"),
    },
    initial: null,
    target: null,
    source: null,
    baseline: null,
    review: null,
    parent: null,
    consumerRenderer: null,
    blobs: [],
    observations: null,
    rows: [],
  };
  await save(db, value, true);
  for (const [actor, role] of [
    [value.operator, "admin"],
    [value.readOnly, "read-only"],
  ] as const)
    await seedVersionFixtureAccount(db, actor, `p4-e2e-${runId}-${role}`, role);
  const session = await loginVersionFixtureAccount(db, value.operator),
    auth = {
      id: value.operator.identifier,
      credentials: {
        sessionToken: session.raw,
        csrfToken: session.dto.csrfToken,
        requestId: randomUUID(),
      },
    },
    prepared = await prepareP4ConsumerSource(runId),
    source = await seedReadyP2b3Source(db, auth, prepared),
    f = prepared.candidate.facts;
  const applied = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
  const {
    idempotencyKey: _key,
    expectedValidationStateRevision: _state,
    expectedCandidateSha256: _candidate,
    fingerprint: _fingerprint,
    target: _target,
    ...summary
  } = applied.application;
  void _key;
  void _state;
  void _candidate;
  void _fingerprint;
  void _target;
  value.initial = summary;
  value.target = {
    draftId: summary.draftId,
    revision: 1,
    canonicalContentSha256: f.canonicalContentSha256,
    assetSetSha256: f.assetSetSha256,
    canonicalManifestSha256: f.canonicalManifestSha256,
  };
  value.source = {
    scope: source.scope,
    expectedValidationStateRevision:
      source.input.expectedValidationStateRevision,
    expectedCandidateSha256: source.input.expectedCandidateSha256,
    canonicalContentSha256: f.canonicalContentSha256,
    assetSetSha256: f.assetSetSha256,
    canonicalManifestSha256: f.canonicalManifestSha256,
    packVersion: "1.0.1",
  };
  const baseline = matchRegisteredBaseline(f, db.config.purpose);
  if (!baseline || baseline.descriptor.approval.kind !== "synthetic-test")
    throw fail();
  value.baseline = baseline.identity;
  value.consumerRenderer = selectedConsumerRenderer;
  const lock = await StorageLock.acquire(db.config);
  let unconfirmed = false;
  try {
    await ensureStorage(db.config);
    for (const blob of prepared.blobs) {
      const file = blobPath(db.config, blob.sha256),
        asset = prepared.assetFiles.find((a) =>
          f.resources.some(
            (r) =>
              r.blobSha256 === blob.sha256 && r.declaration.path === a.path,
          ),
        );
      if (!asset) throw fail();
      let created = false;
      try {
        const h = await open(
          file,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        created = true;
        // Persist ownership before subsequent IO can fail. This pending manifest cannot authorize cleanup.
        value.blobs.push({ sha256: blob.sha256, bytes: blob.bytes, created });
        try {
          await save(db, value);
          try {
            await h.writeFile(asset.bytes);
            await h.sync();
          } catch (e) {
            unconfirmed = true;
            retainConsumerFixtureUnknown(h, lock);
            throw e;
          }
        } finally {
          try {
            await h.close();
          } catch (e) {
            unconfirmed = true;
            retainConsumerFixtureUnknown(h, lock);
            throw e;
          }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
      await readPrivateResource(
        db.config,
        {
          resourceRef: {
            productId: value.productId,
            id: "fixture-verification",
            version: "1.0.0",
          },
          sha256: blob.sha256,
          bytes: blob.bytes,
          mediaType: blob.mediaType,
          width: blob.width,
          height: blob.height,
        },
        () => lock.assert(),
        () => {},
        (h) => {
          unconfirmed = true;
          retainConsumerFixtureUnknown(h, lock);
        },
      );
      if (!created)
        value.blobs.push({
          sha256: blob.sha256,
          bytes: blob.bytes,
          created: false,
        });
      await save(db, value);
    }
  } finally {
    if (!unconfirmed && !(await lock.close())) {
      retainConsumerFixtureUnknown(lock);
      throw fail();
    }
  }
  const request = async <T>(
    work: (
      service: ReturnType<typeof createProductInternalVersionService>,
      app: Awaited<ReturnType<typeof createDatabase>>,
      clock: ReturnType<typeof createStudioRequestBudget>,
    ) => Promise<T>,
  ) => {
    const clock = createStudioRequestBudget(new AbortController().signal),
      app = await createDatabase(db.config, clock.budget),
      owner = createInternalVersionOwner(app, clock);
    try {
      return await work(createProductInternalVersionService(owner), app, clock);
    } catch (error) {
      if ((error as { code?: string })?.code === "WRITE_OUTCOME_UNKNOWN")
        retainConsumerFixtureUnknown(app, owner);
      throw error;
    } finally {
      try {
        await owner.closeIfNotTransferred();
      } catch (e) {
        retainConsumerFixtureUnknown(app, owner);
        throw e;
      }
    }
  };
  const recorded = await request((service, app, clock) =>
    service.recordBaseline(
      app,
      auth.credentials,
      {
        productId: value.productId,
        draftId: value.target!.draftId,
        revision: 1,
      },
      {
        schemaVersion: "quizforge.review-record.v1",
        idempotencyKey: randomUUID(),
        target: value.target!,
        baseline: value.baseline!,
      },
      clock.budget,
    ),
  );
  value.review = recorded.review;
  await save(db, value);
  const renderer = rendererIdentitySchema.parse(
      implementationIdentity(IMPLEMENTATION_DESCRIPTORS.renderers[0]!),
    ),
    engine = engineIdentitySchema.parse(
      implementationIdentity(
        IMPLEMENTATION_DESCRIPTORS.engines.find(
          (e) => e.descriptor.id === "archetype",
        )!,
      ),
    );
  const sealed = await request((service, app, clock) =>
    service.sealInternalVersion(
      app,
      auth.credentials,
      value.productId,
      {
        schemaVersion: "quizforge.internal-version-seal.v1",
        idempotencyKey: randomUUID(),
        target: value.target!,
        reviewId: value.review!.id,
        reviewSha256: value.review!.reviewSha256,
        renderer,
        engine,
      },
      clock.budget,
    ),
  );
  value.parent = await request((service, app) =>
    service.readVersion(app, session.raw, value.productId, sealed.version.id),
  );
  value.rows = (
    await db.admin.sql.begin(
      "isolation level repeatable read read only",
      (tx) => verifyConsumerFixtureGraph(tx, value, null),
    )
  ).rows;
  value.prepared = true;
  await save(db, value);
  return value;
}
export async function finishConsumerFixture(
  db: TestDatabase,
  runId: string,
  input: ConsumerFixtureObservations,
): Promise<ConsumerFixture> {
  const value = await readConsumerFixture(db, runId),
    observations = consumerFixtureObservationsSchema.parse(input);
  if (
    observations.runId !== runId ||
    observations.instanceId !== db.config.instanceId ||
    (value.finished && !same(value.observations, observations))
  )
    throw fail();
  const observed = await db.admin.sql.begin(
    "isolation level repeatable read read only",
    (tx) => verifyConsumerFixtureGraph(tx, value, observations),
  );
  if (value.finished && !same(value.rows, observed.rows)) throw fail();
  value.observations = observations;
  value.rows = observed.rows;
  value.finished = true;
  value.completed =
    observations.mode === "consumer-e2e" && observations.reports.length > 0;
  await save(db, value);
  return value;
}

export async function cleanupConsumerFixture(
  db: TestDatabase,
  runId: string,
  proof: ServerExitProof,
) {
  assertConsumerFixtureKnown();
  requireTest(db);
  const identity = {
    cwd: process.cwd(),
    instanceId: db.config.instanceId,
    runId,
  };
  assertServerExitProof(proof, identity);
  const value = await readConsumerFixture(db, runId);
  if (!value.finished || !value.observations || !ownerAbsent(value.writerPid))
    throw fail();
  const live = await currentConfig(db.app);
  if (live.imports.enabled) throw fail();
  await assertNoConfigGuard(live);
  try {
    await db.app.close();
  } catch (e) {
    retainConsumerFixtureUnknown(db.app);
    throw e;
  }
  const controller = new AbortController(),
    { context, dispose } = createReceiveContext(controller.signal),
    lock = await StorageLock.acquire(live, context);
  let unconfirmed = false,
    mutationStarted = false;
  try {
    const check = async () => {
      assertConsumerFixtureKnown();
      remainingReceiveMs(context);
      assertServerExitProof(proof, identity);
      if (
        !ownerAbsent(value.writerPid) ||
        (await currentConfig(db.app)).imports.enabled
      )
        throw fail();
      await assertNoConfigGuard(live);
      await lock.check();
      const [pid] = await lock.query(
        () =>
          lock.connection<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`,
      );
      if (!pid) throw fail();
      const [other] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND pid<>${pid.pid}) AS present`;
      if (other?.present !== false) throw fail();
      // Same synthetic no-native policy as older physical fixtures; no native validation is inferred.
      return inspectPreviewNativeControl(
        "synthetic-db-and-private-pixels-no-native",
      );
    };
    await check();
    const graph = await db.admin.sql.begin(
      "isolation level repeatable read read only",
      (tx) => verifyConsumerFixtureGraph(tx, value, value.observations),
    );
    if (!same(graph.rows, value.rows)) throw fail();
    await absent(importDirectory(live, value.source!.scope.sourceImportId));
    await absent(
      validationDirectory(live, value.source!.scope.sourceValidationId),
    );
    const source = await db.admin.sql.begin(
      "isolation level repeatable read read only",
      (tx) =>
        readFrozenDraftSourceEvidenceReadonly(tx, value.source!.scope, {
          expectedValidationStateRevision:
            value.source!.expectedValidationStateRevision,
          expectedCandidateSha256: value.source!.expectedCandidateSha256,
        }),
    );
    const scan = await scanStorage(live, context),
      remove: ReturnType<typeof scannedFiles> = [],
      deletable: string[] = [];
    for (const blob of value.blobs) {
      const resource = source.resources.find((r) => r.sha256 === blob.sha256),
        found = scannedFiles(scan, "blobs", blob.sha256);
      if (!resource || resource.bytes !== blob.bytes || found.length !== 1)
        throw fail();
      await readPrivateResource(
        live,
        resource,
        () => {
          remainingReceiveMs(context);
          lock.assert();
        },
        () => controller.abort(),
        (h) => {
          unconfirmed = true;
          retainConsumerFixtureUnknown(h, lock);
        },
      );
      if (!blob.created) continue;
      const [foreign] = await db.admin.sql<{ present: boolean }[]>`SELECT
        EXISTS(SELECT 1 FROM qf.product_asset WHERE product_id<>${value.productId} AND blob_sha256=${blob.sha256})
        OR EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE product_id<>${value.productId} AND asset_set_text::jsonb->'resources' @> ${JSON.stringify([{ blobSha256: blob.sha256 }])}::jsonb)
        OR EXISTS(SELECT 1 FROM qf.draft_revision WHERE product_id<>${value.productId} AND asset_set_text::jsonb->'resources' @> ${JSON.stringify([{ blobSha256: blob.sha256 }])}::jsonb)
        OR EXISTS(SELECT 1 FROM qf.internal_play_version WHERE product_id<>${value.productId} AND snapshot_text::jsonb->'resources'->'resources' @> ${JSON.stringify([{ blobSha256: blob.sha256 }])}::jsonb) AS present`;
      if (foreign?.present !== false) throw fail();
      remove.push(found[0]!);
      deletable.push(blob.sha256);
    }
    let observationInode: Awaited<ReturnType<typeof lstat>> | null = null;
    try {
      const observations = consumerFixtureObservationsSchema.parse(
        await privateJson(observationsPath(db), (h) => {
          unconfirmed = true;
          retainConsumerFixtureUnknown(h, lock);
        }),
      );
      if (!same(observations, value.observations)) throw fail();
      observationInode = await lstat(observationsPath(db));
      privateFile(observationInode);
      if (observationInode.nlink !== 1) throw fail();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    // Entire exact graph, external references, files and writer proof are established BEFORE any deletion.
    await check();
    await db.admin.sql.begin(async (tx) => {
      await acquireAuthWriteLock(tx);
      const now = await verifyConsumerFixtureGraph(
        tx,
        value,
        value.observations,
      );
      if (!same(now.rows, value.rows)) throw fail();
      assertConsumerFixtureKnown();
      mutationStarted = true;
      await tx`DELETE FROM qf.quiz_report WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.consumer_grant WHERE key_id IN(SELECT id FROM qf.access_key WHERE product_id=${value.productId})`;
      await tx`DELETE FROM qf.consumer_session WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.access_key WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.internal_play_version WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product_version WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.draft_review WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product_draft WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.draft_revision WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.draft_application WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product_asset WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.quizpack_validation WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.quizpack_import WHERE product_id=${value.productId}`;
      await tx`DELETE FROM qf.product WHERE id=${value.productId}`;
      const actors = [value.operator.identifier, value.readOnly.identifier];
      await tx`DELETE FROM qf.audit_event WHERE actor_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator_session WHERE operator_id=ANY(${tx.array(actors)}::uuid[])`;
      await tx`DELETE FROM qf.operator WHERE id=ANY(${tx.array(actors)}::uuid[])`;
      if (deletable.length)
        await tx`DELETE FROM qf.asset_blob WHERE sha256=ANY(${tx.array(deletable)}::text[])`;
      assertConsumerFixtureKnown();
    });
    for (const file of remove) await removeOwned(file.file, file.inode);
    await unlink(fixturePath(db));
    if (observationInode)
      await removeOwned(observationsPath(db), observationInode);
    return { nativeControl: await check() };
  } catch (error) {
    if (mutationStarted) {
      unconfirmed = true;
      retainConsumerFixtureUnknown(db.admin, lock);
    }
    throw error;
  } finally {
    dispose();
    if (!unconfirmed && !(await lock.close())) {
      retainConsumerFixtureUnknown(lock);
      throw fail();
    }
  }
}
async function main() {
  const args = process.argv.slice(2),
    [action, runId] = args;
  if (args.length !== 2 || !["prepare", "finish"].includes(action ?? ""))
    throw fail();
  z.uuid().parse(runId);
  const db = await openTestDatabase();
  try {
    const value =
      action === "prepare"
        ? (await waitForPreviewAuthBudget(db),
          await prepareConsumerFixture(
            db,
            runId!,
            CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
          ))
        : await finishConsumerFixture(
            db,
            runId!,
            consumerFixtureObservationsSchema.parse(
              await privateJson(observationsPath(db)),
            ),
          );
    process.stdout.write(
      JSON.stringify({
        prepared: value.prepared,
        finished: value.finished,
        completed: value.completed,
      }) + "\n",
    );
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  safeTestOperation(main).catch(() => {
    process.stderr.write("CONSUMER_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
