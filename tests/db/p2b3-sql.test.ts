import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  insertFirstDraft,
  type InsertDraft,
} from "@/features/product/drafts/repository";
import { draftApplicationFingerprint } from "@/features/product/drafts/contracts";
import { readReadyDraftSource } from "@/features/quizpack/draft-source";
import { StudioError } from "@/lib/http-security/errors";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import {
  openTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
let source: Awaited<ReturnType<typeof seedReadyP2b3Source>>;
const service = createProductDraftService();
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
async function sqlstate(work: () => PromiseLike<unknown>) {
  try {
    await work();
    return "unexpected-success";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)
      ? code
      : "unexpected-error";
  }
}
async function noDraft() {
  const [r] = await safe(
    () => db.admin.sql<{ empty: boolean }[]>`SELECT
    NOT EXISTS(SELECT 1 FROM qf.product_draft)
    AND NOT EXISTS(SELECT 1 FROM qf.draft_revision)
    AND NOT EXISTS(SELECT 1 FROM qf.draft_application)
    AND NOT EXISTS(SELECT 1 FROM qf.audit_event WHERE action='draft_applied') AS empty`,
  );
  expect(r?.empty).toBe(true);
}
async function rawInsert(mutate: (value: InsertDraft) => InsertDraft) {
  const fingerprint = await draftApplicationFingerprint({
    ...source.scope,
    expectedValidationStateRevision:
      source.input.expectedValidationStateRevision,
    expectedCandidateSha256: source.input.expectedCandidateSha256,
    target: { kind: "new-draft" },
  });
  return db.app.sql.begin(async (tx) => {
    const ready = await readReadyDraftSource(tx, source.scope, {
      expectedValidationStateRevision:
        source.input.expectedValidationStateRevision,
      expectedCandidateSha256: source.input.expectedCandidateSha256,
    });
    await insertFirstDraft(
      tx,
      mutate({
        draftId: randomUUID(),
        applicationId: randomUUID(),
        source: ready,
        input: source.input,
        fingerprint,
        actorId: auth.id,
        at: new Date().toISOString(),
      }),
    );
  });
}
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  source = await seedReadyP2b3Source(
    db,
    auth,
    await prepareP2b3Source(`b3-${randomUUID()}`),
  );
});
afterAll(async () => {
  if (db) {
    try {
      await resetDomainDatabase(db);
    } finally {
      await db.close();
    }
  }
});
describe("B3 actual PostgreSQL narrow source INSERT and immutable relationships", () => {
  it("SQL fingerprint matches browser pure contract and rejects a well-formed false digest", async () => {
    const [r] = await safe(
      () => db.app.sql<
        { sha: string }[]
      >`SELECT qf.draft_application_fingerprint(
      ${source.scope.productId},${source.scope.sourceImportId}::uuid,${source.scope.sourceValidationId}::uuid,
      ${source.input.expectedValidationStateRevision},${source.input.expectedCandidateSha256}) AS sha`,
    );
    expect(r?.sha).toBe(
      await draftApplicationFingerprint({
        ...source.scope,
        expectedValidationStateRevision:
          source.input.expectedValidationStateRevision,
        expectedCandidateSha256: source.input.expectedCandidateSha256,
        target: { kind: "new-draft" },
      }),
    );
    expect(
      await sqlstate(() =>
        rawInsert((v) => ({ ...v, fingerprint: "b".repeat(64) })),
      ),
    ).toBe("23514");
    await noDraft();
  });
  it.each([
    "text",
    "asset",
    "version",
    "count",
    "source",
    "null",
    "content-bytes",
    "asset-bytes",
  ] as const)(
    "INSERT cannot copy a different %s while borrowing a ready validation identity",
    async (kind) => {
      const state = await sqlstate(() =>
        rawInsert((v) => {
          if (kind === "content-bytes") {
            const text = "a".repeat(2_097_153);
            return {
              ...v,
              source: {
                ...v.source,
                canonicalContentText: text,
                canonicalContentSha256: hash(text),
              },
            };
          }
          if (kind === "asset-bytes") {
            const text = "a".repeat(65_537);
            return {
              ...v,
              source: {
                ...v.source,
                assetSetText: text,
                assetSetSha256: hash(text),
              },
            };
          }
          if (kind === "text")
            return {
              ...v,
              source: {
                ...v.source,
                canonicalContentText: "{}",
                canonicalContentSha256: hash("{}"),
              },
            };
          if (kind === "asset")
            return {
              ...v,
              source: {
                ...v.source,
                assetSetText: "{}",
                assetSetSha256: hash("{}"),
              },
            };
          if (kind === "version")
            return {
              ...v,
              source: {
                ...v.source,
                versions: { ...v.source.versions, visualVersion: "2.0.0" },
              },
            };
          if (kind === "count")
            return { ...v, source: { ...v.source, resourceCount: 5 } };
          if (kind === "source")
            return {
              ...v,
              source: { ...v.source, sourceValidationId: randomUUID() },
            };
          return {
            ...v,
            source: { ...v.source, canonicalContentText: null as never },
          };
        }),
      );
      expect(state).toBe("23514");
      await noDraft();
    },
  );
  it("SQL source INSERT refuses an archived Product even when source and copy still match", async () => {
    await safe(
      () => db.admin.sql`UPDATE qf.product SET archived_at=clock_timestamp(),
      metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${source.scope.productId}`,
    );
    expect(await sqlstate(() => rawInsert((v) => v))).toBe("23514");
    await noDraft();
  });
  it("initial root without exact revision and application fails at COMMIT", async () => {
    expect(
      await sqlstate(() =>
        db.app.sql.begin(
          (tx) => tx`
      INSERT INTO qf.product_draft(id,product_id,current_revision,initial_application_id,created_by,created_at)
      VALUES(${randomUUID()},${source.scope.productId},1,${randomUUID()},${auth.id},clock_timestamp())`,
        ),
      ),
    ).toBe("23503");
    await noDraft();
  });
  it.each(["revision", "candidate"] as const)(
    "deferred ledger FK binds exact expected source %s",
    async (kind) => {
      const input = {
        ...source.input,
        ...(kind === "revision"
          ? {
              expectedValidationStateRevision:
                source.input.expectedValidationStateRevision + 1,
            }
          : { expectedCandidateSha256: "b".repeat(64) }),
      };
      const fingerprint = await draftApplicationFingerprint({
        ...source.scope,
        expectedValidationStateRevision: input.expectedValidationStateRevision,
        expectedCandidateSha256: input.expectedCandidateSha256,
        target: { kind: "new-draft" },
      });
      expect(
        await sqlstate(() => rawInsert((v) => ({ ...v, input, fingerprint }))),
      ).toBe("23503");
      await noDraft();
    },
  );
  it("app role has SELECT/INSERT only on all three immutable tables", async () => {
    for (const table of [
      "product_draft",
      "draft_revision",
      "draft_application",
    ]) {
      for (const statement of [
        `UPDATE qf.${table} SET product_id=product_id WHERE false`,
        `DELETE FROM qf.${table} WHERE false`,
        `TRUNCATE qf.${table}`,
      ])
        expect(await sqlstate(() => db.app.sql.unsafe(statement))).toBe(
          "42501",
        );
    }
    const created = await safe(() =>
      service.applyReadyValidation(
        db.app,
        auth.credentials,
        source.scope,
        source.input,
      ),
    );
    expect(created.created).toBe(true);
  });
  it("actual audit INSERT rejection rolls back all three draft rows", async () => {
    await safe(() =>
      db.admin.sql.unsafe(`CREATE FUNCTION qf.b3_test_fault() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
      IF NEW.action='draft_applied' THEN RAISE EXCEPTION 'TEST_B3_AUDIT_REJECTED' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$`),
    );
    await safe(() =>
      db.admin.sql
        .unsafe(`CREATE TRIGGER b3_test_fault BEFORE INSERT ON qf.audit_event
      FOR EACH ROW EXECUTE FUNCTION qf.b3_test_fault()`),
    );
    try {
      let result = "unexpected-success";
      try {
        await service.applyReadyValidation(
          db.app,
          auth.credentials,
          source.scope,
          source.input,
        );
      } catch (error) {
        result = error instanceof StudioError ? error.code : "unexpected-error";
      }
      expect(result).toBe("STUDIO_UNAVAILABLE");
      await noDraft();
    } finally {
      await safe(() =>
        db.admin.sql.unsafe("DROP TRIGGER b3_test_fault ON qf.audit_event"),
      );
      await safe(() => db.admin.sql.unsafe("DROP FUNCTION qf.b3_test_fault()"));
    }
    expect(
      (
        await safe(() =>
          service.applyReadyValidation(
            db.app,
            auth.credentials,
            source.scope,
            source.input,
          ),
        )
      ).created,
    ).toBe(true);
  });
  it("actual connection termination in audit yields unknown and no orphan; empty receipt retains uncertainty", async () => {
    await safe(() =>
      db.admin.sql.unsafe(`CREATE FUNCTION qf.b3_test_fault() RETURNS trigger
      LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
      IF NEW.action='draft_applied' THEN PERFORM pg_terminate_backend(pg_backend_pid()); END IF;
      RETURN NEW; END $$`),
    );
    await safe(() =>
      db.admin.sql
        .unsafe(`CREATE TRIGGER b3_test_fault BEFORE INSERT ON qf.audit_event
      FOR EACH ROW EXECUTE FUNCTION qf.b3_test_fault()`),
    );
    try {
      let result = "unexpected-success";
      try {
        await service.applyReadyValidation(
          db.app,
          auth.credentials,
          source.scope,
          source.input,
        );
      } catch (error) {
        result = error instanceof StudioError ? error.code : "unexpected-error";
      }
      expect(result).toBe("WRITE_OUTCOME_UNKNOWN");
      await noDraft();
    } finally {
      await safe(() =>
        db.admin.sql.unsafe("DROP TRIGGER b3_test_fault ON qf.audit_event"),
      );
      await safe(() => db.admin.sql.unsafe("DROP FUNCTION qf.b3_test_fault()"));
    }
    const receipt = await safe(() =>
      service.readDraftApplicationByKey(
        db.app,
        auth.session.raw,
        source.scope.productId,
        source.input.idempotencyKey,
      ),
    );
    expect(receipt.kind).toBe("empty");
    // This test knows it killed its own transaction; HTTP clients still cannot infer rollback from empty.
    expect(
      (
        await safe(() =>
          service.applyReadyValidation(
            db.app,
            auth.credentials,
            source.scope,
            source.input,
          ),
        )
      ).created,
    ).toBe(true);
  });
});
