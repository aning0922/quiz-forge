import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
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
import { configureImports } from "@/features/quizpack/import/config-management";
import { validationDirectory } from "@/features/quizpack/import/storage";
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
import {
  fixtureCredentials,
  serviceRequest,
  serviceRow,
  validationAuditCount,
} from "./p2b2b-service-support";

const service = createQuizpackValidationService();
let db: TestDatabase;
let fixture: Awaited<ReturnType<typeof prepareTestValidationFixture>>;
let credentials: StudioWriteCredentials;
const request = <T>(work: Parameters<typeof serviceRequest<T>>[1]) =>
  serviceRequest(db, work);
const prepare = () =>
  request((d, c) =>
    service.prepareValidation(
      d,
      credentials,
      fixture.productId,
      fixture.imports[0]!.importId,
      {
        expectedImportStateRevision:
          fixture.imports[0]!.expectedImportStateRevision,
      },
      c,
    ),
  );
const start = (key: string) =>
  request((d, c) =>
    service.startValidation(
      d,
      credentials,
      fixture.productId,
      fixture.imports[0]!.importId,
      {
        expectedImportStateRevision:
          fixture.imports[0]!.expectedImportStateRevision,
        expectedValidationKey: key,
      },
      c,
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
  credentials = await fixtureCredentials(db, fixture.operator);
}, 60_000);
beforeEach(() => {
  media.binding.mockReset().mockResolvedValue({
    outcome: "bound",
    binding: {
      schema: "quizpack-media-runtime-binding.v1",
      platform: "darwin-arm64",
      componentId: "a".repeat(64),
      deploymentId: "b".repeat(64),
      runtimeBundleHash: "c".repeat(64),
      limitsHash: "d".repeat(64),
    },
  });
  media.image.mockReset();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (db) await db.close();
});

describe("B2-2B service: real PG + media UNKNOWN stub (fresh dedicated instance; no cleanup)", () => {
  it("finite unavailable before claim can return not-started with no validation row", async () => {
    const prepared = await prepare();
    media.binding.mockResolvedValue({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    expect(await start(prepared.validationKey)).toMatchObject({
      outcome: "not-started",
      code: "MEDIA_UNAVAILABLE",
    });
    expect(
      await safe(() => db.app.sql`SELECT id FROM qf.quizpack_validation`),
    ).toHaveLength(0);
    expect(media.image).not.toHaveBeenCalled();
  });
  it("unconfirmed binding cannot turn an absent row into a not-started authority", async () => {
    const prepared = await prepare();
    media.binding.mockResolvedValue({
      outcome: "unavailable",
      code: "STOP_UNCONFIRMED",
    });
    await expect(start(prepared.validationKey)).rejects.toMatchObject({
      code: "MEDIA_UNAVAILABLE",
    });
    expect(
      await safe(() => db.app.sql`SELECT id FROM qf.quizpack_validation`),
    ).toHaveLength(0);
    expect(media.image).not.toHaveBeenCalled();
  });
  it("decode STOP_UNCONFIRMED holds actual claim without evidence/ACK/receipt and fresh recover/retry stay blocked", async () => {
    const prepared = await prepare();
    media.image.mockResolvedValue({
      outcome: "failed",
      runId: randomUUID(),
      profileId: "e".repeat(64),
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    const append = vi.spyOn(validationTransactions, "appendValidationEvidence"),
      ack = vi.spyOn(validationTransactions, "acknowledgeValidationFileStop"),
      complete = vi.spyOn(validationTransactions, "completeValidation"),
      interrupt = vi.spyOn(validationTransactions, "interruptValidation");
    await expect(start(prepared.validationKey)).rejects.toMatchObject({
      code: "VALIDATION_RECOVERY_REQUIRED",
    });
    expect(media.image).toHaveBeenCalledTimes(1);
    expect(append).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(interrupt).not.toHaveBeenCalled();
    const row = await serviceRow(db, prepared.validationKey),
      audit = await validationAuditCount(db, row.id);
    expect(row.status).toBe("validating");
    expect(row.evidence_text).toBeNull();
    expect(Number(row.reserved_bytes)).toBe(VALIDATION_RESERVATION_BYTES);
    expect(parseValidationAttempts(row.attempts_text)[0]).toMatchObject({
      mediaStop: "unconfirmed",
      disposition: "held",
      fileStopProof: null,
    });
    const files = await readdir(validationDirectory(db.config, row.id)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw new Error("TEST_SERVICE_STORAGE_UNAVAILABLE");
      },
    );
    expect(files).toHaveLength(0);
    await expect(
      request((d, c) =>
        service.recoverValidation(
          d,
          credentials,
          fixture.productId,
          fixture.imports[0]!.importId,
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
          fixture.imports[0]!.importId,
          row.id,
          { expectedStateRevision: row.state_revision },
          c,
        ),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_RECOVERY_REQUIRED" });
    expect(await serviceRow(db, prepared.validationKey)).toEqual(row);
    expect(await validationAuditCount(db, row.id)).toBe(audit);
  });
});
