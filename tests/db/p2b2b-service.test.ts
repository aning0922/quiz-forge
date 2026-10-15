import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { StudioError } from "@/lib/http-security/errors";
import { configureImports } from "@/features/quizpack/import/config-management";
import { createProduct } from "@/features/product/workspace/service";
import type { ImageDeclaration } from "@/features/quizpack/server/media";

// Only the two media runtime boundary calls are synthetic. The engine, prepared
// handles, restore, ZIP parser, private candidates, FS, repository and PG commits
// below are the production implementations. This suite is not isolation evidence.
const media = vi.hoisted(() => ({ binding: vi.fn(), image: vi.fn() }));
vi.mock("@/features/quizpack/server/media", async (actual) => ({
  ...(await actual<typeof import("@/features/quizpack/server/media")>()),
  readMediaRuntimeBinding: media.binding,
  runIsolatedImage: media.image,
}));
import { createQuizpackValidationService } from "@/features/quizpack/validation/service";
import { validationTransactions } from "@/features/quizpack/validation/transactions";
import { parseValidationAttempts } from "@/features/quizpack/validation/repository";
import { VALIDATION_RESERVATION_BYTES } from "@/features/quizpack/validation/limits";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { prepareTestValidationFixture } from "./p2b2b-e2e-fixture";
import { runTestValidationRequest } from "./p2b2b-request-fixture";
import {
  fixtureCredentials,
  serviceRequest,
  serviceRow,
  validationAuditCount,
} from "./p2b2b-service-support";

import { createProductDraftService } from "@/features/product/drafts/service";
import { importReceiveService } from "@/features/quizpack/import/service";
import { createSyntheticFixture } from "@/features/quizpack/v1/fixtures/synthetic";
import { createContentV2Fixture } from "@/features/quizpack/content/fixtures.test-support";
import { buildSupportedQuizPack } from "@/features/quizpack/package/build";
import { hashBytes } from "@/features/quizpack/v1/validate";
import type { ContentSchemaVersion } from "@/features/quizpack/package/api";
const service = createQuizpackValidationService();
let db: TestDatabase;
let fixture: Awaited<ReturnType<typeof prepareTestValidationFixture>>;
let credentials: StudioWriteCredentials;
let readOnly: StudioWriteCredentials;
let generation = 0;
const tuple = (index = 0) => fixture.imports[index]!;
const request = <T>(work: Parameters<typeof serviceRequest<T>>[1]) =>
  serviceRequest(db, work);
const prepare = (index = 0) =>
  request((connection, context) =>
    service.prepareValidation(
      connection,
      credentials,
      fixture.productId,
      tuple(index).importId,
      { expectedImportStateRevision: tuple(index).expectedImportStateRevision },
      context,
    ),
  );
const start = (
  key: string,
  index = 0,
  revision = tuple(index).expectedImportStateRevision,
) =>
  request((connection, context) =>
    service.startValidation(
      connection,
      credentials,
      fixture.productId,
      tuple(index).importId,
      { expectedValidationKey: key, expectedImportStateRevision: revision },
      context,
    ),
  );

beforeAll(async () => {
  db = await safe(openTestDatabase);
  const [existing] = await safe(
    () =>
      db.admin.sql<
        { count: number }[]
      >`SELECT count(*)::int count FROM qf.product`,
  );
  if (existing?.count !== 0)
    throw new Error("TEST_SERVICE_FRESH_INSTANCE_REQUIRED");
  fixture = await prepareTestValidationFixture(db, randomUUID());
  await db.close();
  await configureImports(db.config.instanceId, true);
  db = await safe(openTestDatabase);
  credentials = await fixtureCredentials(db, fixture.operator.secret);
  readOnly = await fixtureCredentials(db, fixture.readOnly.secret);
}, 60_000);

beforeEach(() => {
  const component = (++generation).toString(16).padStart(64, "0");
  media.binding.mockReset().mockResolvedValue({
    outcome: "bound",
    binding: {
      schema: "quizpack-media-runtime-binding.v1",
      platform: "darwin-arm64",
      componentId: component,
      deploymentId: "b".repeat(64),
      runtimeBundleHash: "c".repeat(64),
      limitsHash: "d".repeat(64),
    },
  });
  media.image
    .mockReset()
    .mockImplementation(
      async (_bytes: Uint8Array, declaration: ImageDeclaration) => ({
        outcome: "decoded",
        runId: randomUUID(),
        profileId: "e".repeat(64),
        stopped: "confirmed",
        facts: {
          mediaType: declaration.mediaType,
          width: declaration.width,
          height: declaration.height,
          frames: 1,
          mediaDecoded: true,
        },
      }),
    );
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  // UNKNOWN cases intentionally preserve their rows/files/held reservations.
  // Closing connections is not a stopping proof and never authorizes cleanup.
  if (db) await db.close();
});

describe("B2-2B service: real PostgreSQL + finite media stub (not isolated-media E2E)", () => {
  it("prepares without claim, then starts ready with durable ACK and Product-owned resources", async () => {
    const prepared = await prepare();
    const before = await safe(
      () => db.app.sql`SELECT id FROM qf.quizpack_validation`,
    );
    expect(before).toHaveLength(0);
    const result = await runTestValidationRequest(db, (connection, context) =>
      service.startValidation(
        connection,
        credentials,
        fixture.productId,
        tuple().importId,
        {
          expectedValidationKey: prepared.validationKey,
          expectedImportStateRevision: tuple().expectedImportStateRevision,
        },
        context,
      ),
    );
    expect(result).toMatchObject({
      outcome: "record",
      created: true,
      validation: { status: "ready", archivedResourceCount: 4 },
    });
    const row = await serviceRow(db, prepared.validationKey);
    expect(Number(row.reserved_bytes)).toBe(0);
    expect(row.report_texts).toHaveLength(1);
    expect(parseValidationAttempts(row.attempts_text)[0]).toMatchObject({
      disposition: "released",
      mediaStop: "confirmed",
      fileStopProof: { validationId: row.id, scope: "files-and-media" },
    });
    const refs = await safe(
      () =>
        db.app.sql<
          { product_id: string; source_validation_id: string }[]
        >`SELECT product_id,source_validation_id FROM qf.product_asset`,
    );
    expect(refs).toHaveLength(4);
    expect(
      refs.every(
        (r) =>
          r.product_id === fixture.productId &&
          r.source_validation_id === row.id,
      ),
    ).toBe(true);
    expect(media.image).toHaveBeenCalledTimes(4);
  });

  it("exact replay precedes stale CAS/current runtime and adds no rows, reports or audit", async () => {
    const rows = await safe(
      () =>
        db.admin.sql<
          { validation_key: string }[]
        >`SELECT validation_key FROM qf.quizpack_validation WHERE status='ready' ORDER BY created_at LIMIT 1`,
    );
    const key = rows[0]!.validation_key,
      before = await serviceRow(db, key),
      audit = await validationAuditCount(db, before.id);
    media.binding.mockRejectedValue(
      new Error("CURRENT_PLATFORM_MUST_NOT_BE_READ"),
    );
    const result = await start(key, 0, 999);
    expect(result).toMatchObject({
      outcome: "record",
      created: false,
      validation: { id: before.id, status: "ready" },
    });
    expect(media.binding).not.toHaveBeenCalled();
    expect(media.image).not.toHaveBeenCalled();
    expect(await serviceRow(db, key)).toEqual(before);
    expect(await validationAuditCount(db, before.id)).toBe(audit);
  });

  it.each([
    ["quizpack-content.v1", "synthetic", "dimensions"],
    ["quizpack-content.v1", "authored", "archetype"],
    ["quizpack-content.v2", "synthetic", "archetype"],
    ["quizpack-content.v2", "authored", "dimensions"],
  ] as const)(
    "real supported %s/%s ZIP receives, validates, archives and applies revision 1 (%s); media boundary is synthetic",
    async (version: ContentSchemaVersion, kind, engine) => {
      const productId = `supported-${randomUUID()}`;
      const base = await createSyntheticFixture(engine);
      const declared =
        version === "quizpack-content.v1"
          ? base.content
          : await createContentV2Fixture(engine);
      const content = {
        ...JSON.parse(
          JSON.stringify(declared).replaceAll(
            JSON.stringify(declared.product.productId),
            JSON.stringify(productId),
          ),
        ),
        kind,
      };
      const assets =
        version === "quizpack-content.v1"
          ? base.assets
          : [
              ...base.assets,
              {
                path: "assets/neutral-scene.png",
                bytes: base.assets[0]!.bytes,
              },
            ];
      const built = await buildSupportedQuizPack(
        { packId: productId, packVersion: "1.0.0", content, assets },
        { targetProductId: productId },
        version,
      );
      if (!built.ok) throw Error("SUPPORTED_SERVICE_FIXTURE_BUILD_FAILED");
      const archive = built.value.archive;
      await createProduct(db.app, credentials, {
        id: productId,
        slug: productId,
        title: "明确合成的四组合服务夹具",
        primaryCategoryId: null,
        tagIds: [],
      });
      const intent = await importReceiveService.createIntent(
        db.app,
        credentials,
        productId,
        randomUUID(),
        {
          expectedArchiveBytes: archive.byteLength,
          expectedArchiveSha256: hashBytes(archive),
          target: { kind: "new-draft" },
        },
      );
      const received = await request((connection, context) =>
        importReceiveService.receiveArchive(
          connection,
          credentials,
          productId,
          intent.import.id,
          {
            chunks: (async function* () {
              yield archive;
            })(),
            cancel: async () => {},
          },
          context,
        ),
      );
      expect(received.status).toBe("received");
      const prepared = await request((connection, context) =>
        service.prepareValidation(
          connection,
          credentials,
          productId,
          received.id,
          { expectedImportStateRevision: received.stateRevision },
          context,
        ),
      );
      const acknowledge = validationTransactions.acknowledgeValidationFileStop;
      const unknown = vi
        .spyOn(validationTransactions, "acknowledgeValidationFileStop")
        .mockImplementationOnce(async (...args) => {
          await acknowledge(...args);
          throw new StudioError("WRITE_OUTCOME_UNKNOWN");
        });
      await expect(
        request((connection, context) =>
          service.startValidation(
            connection,
            credentials,
            productId,
            received.id,
            {
              expectedValidationKey: prepared.validationKey,
              expectedImportStateRevision: received.stateRevision,
            },
            context,
          ),
        ),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
      unknown.mockRestore();
      const unfinished = await serviceRow(db, prepared.validationKey);
      expect(unfinished.status).toBe("archiving");
      const recovered = await request((connection, context) =>
        service.recoverValidation(
          connection,
          credentials,
          productId,
          received.id,
          unfinished.id,
          { expectedStateRevision: unfinished.state_revision },
          context,
        ),
      );
      expect(recovered.status).toBe("validated");
      media.image.mockClear();
      const validation = await request((connection, context) =>
        service.retryValidation(
          connection,
          credentials,
          productId,
          received.id,
          unfinished.id,
          { expectedStateRevision: recovered.stateRevision },
          context,
        ),
      );
      expect(media.image).not.toHaveBeenCalled();
      expect(validation).toMatchObject({
        status: "ready",
        readOnly: false,
        contentSchemaVersion: version,
        platformApproval: "unverified",
        publishable: false,
      });
      const row = await serviceRow(db, prepared.validationKey);
      expect(row.content_kind).toBe(kind);
      expect(row.archive_policy_version).toBe("quizpack-private-archive.v3");
      expect(JSON.parse(row.identity_text).schemaVersion).toBe(
        "quizpack-validation-identity.v2",
      );
      const evidence = JSON.parse(row.evidence_text!);
      expect(
        evidence.attempts[0].result.evidence.report.value.schemaVersion,
      ).toBe("quizpack-validation.v2");
      expect(
        parseValidationAttempts(row.attempts_text).every(
          (a) =>
            a.disposition === "released" &&
            a.fileStopProof?.validationId === row.id,
        ),
      ).toBe(true);
      const drafts = createProductDraftService();
      const scope = {
        productId,
        sourceImportId: received.id,
        sourceValidationId: row.id,
      };
      const input = {
        idempotencyKey: randomUUID(),
        expectedValidationStateRevision: row.state_revision,
        expectedCandidateSha256: row.candidate_sha256!,
        target: { kind: "new-draft" as const },
      };
      const applied = await drafts.applyReadyValidation(
        db.app,
        credentials,
        scope,
        input,
      );
      expect(applied.created).toBe(true);
      expect(applied.application).toMatchObject({
        contentSchemaVersion: version,
        contentKind: kind,
        revision: 1,
        platformApproval: "unverified",
        publishable: false,
      });
      const revision = await drafts.readDraftRevision(
        db.app,
        credentials.sessionToken,
        productId,
        applied.application.draftId,
        1,
      );
      expect(revision.canonicalContentText).toBe(row.canonical_content_text);
      expect(revision.assetSetText).toBe(row.asset_set_text);
      expect(
        await drafts.applyReadyValidation(db.app, credentials, scope, input),
      ).toEqual({ ...applied, created: false });
    },
  );
  it("read-only can read but every write, bad CSRF and missing auth fail before media or claim", async () => {
    const prepared = await prepare();
    media.binding.mockClear();
    const row = (
      await safe(
        () =>
          db.admin.sql<
            { id: string }[]
          >`SELECT id FROM qf.quizpack_validation WHERE status='ready' LIMIT 1`,
      )
    )[0]!;
    const read = await safe(() =>
      service.readValidation(
        db.app,
        readOnly.sessionToken,
        fixture.productId,
        tuple().importId,
        row.id,
      ),
    );
    expect(read.status).toBe("ready");
    const input = {
      expectedImportStateRevision: tuple().expectedImportStateRevision,
      expectedValidationKey: prepared.validationKey,
    };
    for (const work of [
      () =>
        request((d, c) =>
          service.prepareValidation(
            d,
            readOnly,
            fixture.productId,
            tuple().importId,
            { expectedImportStateRevision: input.expectedImportStateRevision },
            c,
          ),
        ),
      () =>
        request((d, c) =>
          service.startValidation(
            d,
            readOnly,
            fixture.productId,
            tuple().importId,
            input,
            c,
          ),
        ),
      () =>
        request((d, c) =>
          service.recoverValidation(
            d,
            readOnly,
            fixture.productId,
            tuple().importId,
            row.id,
            { expectedStateRevision: read.stateRevision },
            c,
          ),
        ),
      () =>
        request((d, c) =>
          service.retryValidation(
            d,
            readOnly,
            fixture.productId,
            tuple().importId,
            row.id,
            { expectedStateRevision: read.stateRevision },
            c,
          ),
        ),
    ])
      await expect(work()).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(
      request((d, c) =>
        service.startValidation(
          d,
          { ...credentials, csrfToken: null },
          fixture.productId,
          tuple().importId,
          input,
          c,
        ),
      ),
    ).rejects.toMatchObject({ code: "CSRF_REJECTED" });
    await expect(
      safe(() =>
        service.listValidations(
          db.app,
          null,
          fixture.productId,
          tuple().importId,
          { page: 1, pageSize: 20 },
        ),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(media.binding).not.toHaveBeenCalled();
  });

  it("rejects foreign Product/import and sibling import/validation tuples before media or mutation", async () => {
    const foreignId = `service-foreign-${randomUUID().slice(0, 8)}`;
    await safe(() =>
      createProduct(db.app, credentials, {
        id: foreignId,
        slug: foreignId,
        title: "Synthetic service boundary",
        primaryCategoryId: null,
        tagIds: [],
      }),
    );
    const row = (
      await safe(
        () =>
          db.admin.sql<
            { id: string }[]
          >`SELECT id FROM qf.quizpack_validation WHERE status='ready' LIMIT 1`,
      )
    )[0]!;
    await expect(
      request((d, c) =>
        service.prepareValidation(
          d,
          credentials,
          foreignId,
          tuple().importId,
          { expectedImportStateRevision: tuple().expectedImportStateRevision },
          c,
        ),
      ),
    ).rejects.toMatchObject({ code: "IMPORT_NOT_FOUND" });
    await expect(
      safe(() =>
        service.readValidation(
          db.app,
          credentials.sessionToken,
          fixture.productId,
          tuple(1).importId,
          row.id,
        ),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_NOT_FOUND" });
    expect(media.binding).not.toHaveBeenCalled();
  });

  it("a second real request is busy while the first owns the storage lock; one claim completes", async () => {
    const prepared = await prepare(1);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const decode = media.image.getMockImplementation()!;
    media.image.mockImplementationOnce(async (...args) => {
      enter();
      await gate;
      return decode(...args);
    });
    const first = start(prepared.validationKey, 1);
    try {
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error("TEST_SERVICE_DECODE_NOT_ENTERED");
        }),
      ]);
      expect(await start(prepared.validationKey, 1)).toMatchObject({
        outcome: "not-started",
        code: "VALIDATION_BUSY",
      });
    } finally {
      release();
      await first;
    }
    expect(await first).toMatchObject({
      outcome: "record",
      created: true,
      validation: { status: "ready" },
    });
    const row = await serviceRow(db, prepared.validationKey);
    expect(parseValidationAttempts(row.attempts_text)).toHaveLength(1);
    const replay = await start(prepared.validationKey, 1);
    expect(replay).toMatchObject({
      outcome: "record",
      created: false,
      validation: { id: row.id },
    });
  });

  it("complete committed then response UNKNOWN returns no ready DTO; exact GET finds ready exactly once", async () => {
    const prepared = await prepare();
    const original = validationTransactions.completeValidation;
    const complete = vi
      .spyOn(validationTransactions, "completeValidation")
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      });
    const interrupt = vi.spyOn(validationTransactions, "interruptValidation");
    await expect(start(prepared.validationKey)).rejects.toMatchObject({
      code: "WRITE_OUTCOME_UNKNOWN",
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(interrupt).not.toHaveBeenCalled();
    const row = await serviceRow(db, prepared.validationKey);
    expect(row.status).toBe("ready");
    expect(Number(row.reserved_bytes)).toBe(0);
    expect(
      parseValidationAttempts(row.attempts_text)[0]!.fileStopProof,
    ).not.toBeNull();
    expect(await start(prepared.validationKey)).toMatchObject({
      outcome: "record",
      created: false,
      validation: { id: row.id, status: "ready" },
    });
    const events = await safe(
      () =>
        db.admin
          .sql`SELECT id FROM qf.audit_event WHERE target_id=${row.id} AND action='validation_completed'`,
    );
    expect(events).toHaveLength(1);
  });

  it("ACK committed then response UNKNOWN forbids original complete; fresh recover and archive retry use committed proof", async () => {
    const prepared = await prepare(2);
    const original = validationTransactions.acknowledgeValidationFileStop;
    const ack = vi
      .spyOn(validationTransactions, "acknowledgeValidationFileStop")
      .mockImplementation(async (...args) => {
        await original(...args);
        throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      });
    const complete = vi.spyOn(validationTransactions, "completeValidation"),
      interrupt = vi.spyOn(validationTransactions, "interruptValidation");
    await expect(start(prepared.validationKey, 2)).rejects.toMatchObject({
      code: "WRITE_OUTCOME_UNKNOWN",
    });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();
    const row = await serviceRow(db, prepared.validationKey);
    expect(row.status).toBe("archiving");
    expect(Number(row.reserved_bytes)).toBe(VALIDATION_RESERVATION_BYTES);
    expect(
      parseValidationAttempts(row.attempts_text)[0]!.fileStopProof,
    ).not.toBeNull();
    ack.mockRestore();
    const recovered = await request((d, c) =>
      service.recoverValidation(
        d,
        credentials,
        fixture.productId,
        tuple(2).importId,
        row.id,
        { expectedStateRevision: row.state_revision },
        c,
      ),
    );
    expect(recovered.status).toBe("validated");
    expect(
      Number((await serviceRow(db, prepared.validationKey)).reserved_bytes),
    ).toBe(0);
    media.image.mockClear();
    const retried = await request((d, c) =>
      service.retryValidation(
        d,
        credentials,
        fixture.productId,
        tuple(2).importId,
        row.id,
        { expectedStateRevision: recovered.stateRevision },
        c,
      ),
    );
    expect(retried.status).toBe("ready");
    expect(media.image).not.toHaveBeenCalled();
    expect(
      parseValidationAttempts(
        (await serviceRow(db, prepared.validationKey)).attempts_text,
      ).map((a) => a.kind),
    ).toEqual(["validate", "archive"]);
  });

  // Run unacknowledged cases last. Their retained 3 * reservation stays below
  // the fixed quota. No test fabricates ACK or deletes these failed sites.
  it.each([
    ["claimValidation", "validating", false],
    ["appendValidationEvidence", "validated", true],
    ["beginArchiving", "archiving", true],
  ] as const)(
    "%s actual COMMIT then UNKNOWN preserves held row and blocks all later writes/recover/retry",
    async (stage, expectedStatus, hasEvidence) => {
      const prepared = await prepare();
      const original = validationTransactions[stage];
      const target = vi
        .spyOn(validationTransactions, stage)
        .mockImplementation(async (...args: unknown[]) => {
          // The overload union is solely instrumentation: all captured arguments go
          // unchanged to the selected real PostgreSQL transaction before failure.
          await (original as (...a: unknown[]) => Promise<unknown>)(...args);
          throw new StudioError("WRITE_OUTCOME_UNKNOWN");
        });
      const ack = vi.spyOn(
          validationTransactions,
          "acknowledgeValidationFileStop",
        ),
        complete = vi.spyOn(validationTransactions, "completeValidation"),
        interrupt = vi.spyOn(validationTransactions, "interruptValidation");
      await expect(start(prepared.validationKey)).rejects.toMatchObject({
        code: "WRITE_OUTCOME_UNKNOWN",
      });
      expect(target).toHaveBeenCalledTimes(1);
      expect(ack).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(interrupt).not.toHaveBeenCalled();
      const row = await serviceRow(db, prepared.validationKey),
        audit = await validationAuditCount(db, row.id);
      expect(row.status).toBe(expectedStatus);
      expect(row.evidence_text !== null).toBe(hasEvidence);
      expect(Number(row.reserved_bytes)).toBe(VALIDATION_RESERVATION_BYTES);
      expect(
        parseValidationAttempts(row.attempts_text)[0]!.fileStopProof,
      ).toBeNull();
      await expect(
        request((d, c) =>
          service.recoverValidation(
            d,
            credentials,
            fixture.productId,
            tuple().importId,
            row.id,
            { expectedStateRevision: row.state_revision },
            c,
          ),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
      await expect(
        request((d, c) =>
          service.retryValidation(
            d,
            credentials,
            fixture.productId,
            tuple().importId,
            row.id,
            { expectedStateRevision: row.state_revision },
            c,
          ),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
      expect(await serviceRow(db, prepared.validationKey)).toEqual(row);
      expect(await validationAuditCount(db, row.id)).toBe(audit);
    },
  );
});
