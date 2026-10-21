import { randomUUID } from "node:crypto";
import path from "node:path";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { workspaceService } from "@/features/product/workspace/service";
import { importReceiveService } from "@/features/quizpack/import/service";
import { createReceiveContext } from "@/features/quizpack/import/context";
import { createValidationContext } from "@/features/quizpack/validation/operation";
import { createQuizpackValidationService } from "@/features/quizpack/validation/service";
import {
  digestRecoveryFile,
  assertRecoveryDigest,
} from "@/features/runtime-recovery/files";
import { buildRecoverySyntheticPack } from "./synthetic-pack";

const unknown = new Set<unknown>();
const fail = () => Error("RECOVERY_DRILL_SOURCE_NOT_READY");
async function request<
  C extends { signal: AbortSignal; deadlineMonotonicMs: number },
  T,
>(
  config: P2aRuntimeConfig,
  makeContext: () => { context: C; dispose(): void },
  work: (db: P2aDatabase, context: C) => Promise<T>,
) {
  if (unknown.size) throw Error("RECOVERY_DRILL_CLOSE_UNPROVEN");
  const { context, dispose } = makeContext();
  let db: P2aDatabase | undefined;
  try {
    db = await createDatabase(config, context);
    return await work(db, context);
  } finally {
    try {
      await db?.close();
    } catch (error) {
      unknown.add(db);
      throw error;
    } finally {
      dispose();
    }
  }
}

/** Real receive + configured native validation. No seeding, mocks, ACK fabrication or cleanup. */
export async function receiveAndValidateRecoveryPack(
  app: P2aDatabase,
  credentials: StudioWriteCredentials,
) {
  if (
    unknown.size ||
    app.config.purpose !== "test" ||
    !app.config.imports.enabled
  )
    throw fail();
  const pack = await buildRecoverySyntheticPack();
  const productId = pack.baseline.productId;
  await workspaceService.createProduct(app, credentials, {
    id: productId,
    slug: productId,
    title: "R1 独立合成恢复演练",
    primaryCategoryId: null,
    tagIds: [],
  });
  const intent = await importReceiveService.createIntent(
    app,
    credentials,
    productId,
    randomUUID(),
    {
      expectedArchiveBytes: pack.archiveBytes,
      expectedArchiveSha256: pack.archiveSha256,
      target: { kind: "new-draft" },
    },
  );
  const chunks = (async function* () {
    for (let offset = 0; offset < pack.archiveBytes; offset += 65_536)
      yield pack.archive.subarray(offset, offset + 65_536);
  })();
  const received = await request(
    app.config,
    () => createReceiveContext(new AbortController().signal),
    (db, context) =>
      importReceiveService.receiveArchive(
        db,
        credentials,
        productId,
        intent.import.id,
        {
          chunks,
          cancel: async () => {
            await chunks.return();
          },
        },
        context,
      ),
  );
  if (
    received.status !== "received" ||
    received.actualArchiveSha256 !== pack.archiveSha256 ||
    received.actualArchiveBytes !== pack.archiveBytes
  )
    throw fail();
  const validation = createQuizpackValidationService();
  const makeContext = () =>
    createValidationContext(new AbortController().signal);
  const prepared = await request(app.config, makeContext, (db, context) =>
    validation.prepareValidation(
      db,
      credentials,
      productId,
      received.id,
      {
        expectedImportStateRevision: received.stateRevision,
      },
      context,
    ),
  );
  const result = await request(app.config, makeContext, (db, context) =>
    validation.startValidation(
      db,
      credentials,
      productId,
      received.id,
      {
        expectedImportStateRevision: received.stateRevision,
        expectedValidationKey: prepared.validationKey,
      },
      context,
    ),
  );
  if (
    result.outcome !== "record" ||
    result.validation.status !== "ready" ||
    result.validation.archivedResourceCount !== 5 ||
    result.validation.resourceCount !== 5 ||
    result.validation.assetSetSha256 !== pack.baseline.assetSetSha256 ||
    result.validation.maintenanceRequired ||
    !result.validation.candidateSha256
  )
    throw fail();
  assertRecoveryDigest(
    await digestRecoveryFile(
      path.join(
        process.cwd(),
        ".cache",
        "p2a",
        app.config.instanceId,
        "uploads",
        "imports",
        received.id,
        "archive.quizpack",
      ),
      {
        signal: new AbortController().signal,
        deadlineMonotonicMs: performance.now() + 5_000,
      },
      pack.archiveBytes,
    ),
    { bytes: pack.archiveBytes, sha256: pack.archiveSha256 },
  );
  return {
    productId,
    importId: received.id,
    validation: result.validation,
    archiveSha256: pack.archiveSha256,
    archiveBytes: pack.archiveBytes,
    baseline: pack.baseline,
  };
}
