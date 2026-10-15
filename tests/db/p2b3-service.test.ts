import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimValidation } from "@/features/quizpack/validation/transactions";
import { createProductDraftService } from "@/features/product/drafts/service";
import { draftApplicationFingerprint } from "@/features/product/drafts/contracts";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { domainFixture, resetDomainDatabase } from "./p2b2b-domain-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import {
  openTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
let prepared: Awaited<ReturnType<typeof prepareP2b3Source>>;
let source: Awaited<ReturnType<typeof seedReadyP2b3Source>>;
const service = createProductDraftService();
const apply = (
  database: P2aDatabase = db.app,
  input = source.input,
  scope = source.scope,
) =>
  safe(() =>
    service.applyReadyValidation(database, auth.credentials, scope, input),
  );
async function code(work: () => PromiseLike<unknown>) {
  try {
    await work();
    return "unexpected-success";
  } catch (error) {
    return error instanceof StudioError ? error.code : "unexpected-error";
  }
}
async function counts() {
  const [row] = await safe(
    () => db.admin.sql<
      {
        drafts: number;
        revisions: number;
        applications: number;
        audits: number;
      }[]
    >`
    SELECT (SELECT count(*)::int FROM qf.product_draft) drafts,
      (SELECT count(*)::int FROM qf.draft_revision) revisions,
      (SELECT count(*)::int FROM qf.draft_application) applications,
      (SELECT count(*)::int FROM qf.audit_event WHERE action='draft_applied') audits`,
  );
  return row;
}
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  prepared = await prepareP2b3Source(`b3-${randomUUID()}`);
  source = await seedReadyP2b3Source(db, auth, prepared);
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
describe("B3 first-draft actual PostgreSQL service", () => {
  it("writes one immutable revision, ledger and audit; summary excludes body and receipt is fixed", async () => {
    const created = await apply();
    expect(created.created).toBe(true);
    expect(created.application.candidateSha256).toBe(
      source.input.expectedCandidateSha256,
    );
    expect(created.application.versions).toEqual({
      contentVersion: "1.0.0",
      visualVersion: "1.0.0",
      reportVersion: "1.0.0",
      resourceVersion: "1.0.0",
      componentVersion: "1.0.0",
      engine: { id: "archetype", version: "1.0.0" },
    });
    const summary = await safe(() =>
      service.readDraft(db.app, auth.session.raw, source.scope.productId),
    );
    expect(summary.kind).toBe("draft");
    expect(Object.hasOwn(summary, "canonicalContentText")).toBe(false);
    const body = await safe(() =>
      service.readDraftRevision(
        db.app,
        auth.session.raw,
        source.scope.productId,
        created.application.draftId,
        1,
      ),
    );
    expect(
      body.canonicalContentText ===
        prepared.candidate.facts.canonicalContentText,
    ).toBe(true);
    expect(body.assetSetText === prepared.candidate.facts.assetSetText).toBe(
      true,
    );
    const receipt = await safe(() =>
      service.readDraftApplicationByKey(
        db.app,
        auth.session.raw,
        source.scope.productId,
        source.input.idempotencyKey,
      ),
    );
    expect(receipt.kind).toBe("applied");
    if (receipt.kind === "applied")
      expect(
        canonicalP1Json(receipt.application) ===
          canonicalP1Json(created.application),
      ).toBe(true);
    expect(await counts()).toEqual({
      drafts: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
    expect(
      await code(() =>
        service.readDraftRevision(
          db.app,
          auth.session.raw,
          source.scope.productId,
          created.application.draftId,
          2,
        ),
      ),
    ).toBe("DRAFT_REVISION_NOT_FOUND");
  });
  it("application remains a pure DB write when imports.enabled is false", async () => {
    const disabled = {
      ...db.app,
      config: {
        ...db.app.config,
        imports: { ...db.app.config.imports, enabled: false },
      },
    };
    expect((await apply(disabled)).created).toBe(true);
    expect(await counts()).toEqual({
      drafts: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
  });
  it("replays success before archived/source checks and refuses changed original tuple", async () => {
    const first = await apply();
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.product SET archived_at=clock_timestamp(),metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${source.scope.productId}`,
    );
    const replay = await apply();
    expect(replay.created).toBe(false);
    expect(
      canonicalP1Json(replay.application) ===
        canonicalP1Json(first.application),
    ).toBe(true);
    expect(
      await code(() =>
        apply(db.app, {
          ...source.input,
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision + 1,
        }),
      ),
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      await code(() =>
        apply(db.app, { ...source.input, idempotencyKey: randomUUID() }),
      ),
    ).toBe("PRODUCT_ARCHIVED");
    expect(await counts()).toEqual({
      drafts: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
  });
  it("different key for source or a ready alias cannot create another first draft", async () => {
    const alias = await seedReadyP2b3Source(db, auth, prepared, {
      createProduct: false,
    });
    expect(alias.row.identity_kind).toBe("alias");
    await apply();
    expect(
      await code(() =>
        apply(db.app, { ...source.input, idempotencyKey: randomUUID() }),
      ),
    ).toBe("DRAFT_ALREADY_EXISTS");
    expect(await code(() => apply(db.app, alias.input, alias.scope))).toBe(
      "DRAFT_ALREADY_EXISTS",
    );
    expect(await counts()).toEqual({
      drafts: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
  });
  it("accepts complete alias assets whose original validation differs", async () => {
    const alias = await seedReadyP2b3Source(db, auth, prepared, {
      createProduct: false,
    });
    const result = await apply(db.app, alias.input, alias.scope);
    expect(result.created).toBe(true);
    expect(result.application.sourceValidationId).toBe(alias.row.id);
    expect(result.application.resourceCount).toBe(4);
  });
  it("refuses stale revision/hash, foreign Product and nonready source with no partial draft", async () => {
    expect(
      await code(() =>
        apply(db.app, {
          ...source.input,
          expectedValidationStateRevision:
            source.input.expectedValidationStateRevision - 1,
        }),
      ),
    ).toBe("DRAFT_SOURCE_CHANGED");
    expect(
      await code(() =>
        apply(db.app, {
          ...source.input,
          expectedCandidateSha256: "b".repeat(64),
        }),
      ),
    ).toBe("DRAFT_SOURCE_CHANGED");
    const foreign = await seedReadyP2b3Source(
      db,
      auth,
      await prepareP2b3Source(`b3-${randomUUID()}`),
    );
    expect(
      await code(() =>
        apply(db.app, source.input, {
          ...source.scope,
          productId: foreign.scope.productId,
        }),
      ),
    ).toBe("DRAFT_SOURCE_INVALID");
    expect(
      await code(() =>
        apply(db.app, source.input, {
          ...source.scope,
          sourceValidationId: randomUUID(),
        }),
      ),
    ).toBe("DRAFT_SOURCE_INVALID");
    const nonready = await domainFixture(db);
    const claim = await safe(() =>
      claimValidation(db.app, nonready.auth.credentials, nonready.scope, {
        expectedImportStateRevision: 1,
        expectedValidationKey: nonready.binding.validationKey,
        binding: nonready.binding,
        owner: nonready.owner,
      }),
    );
    expect(
      await code(() =>
        apply(
          db.app,
          {
            ...source.input,
            expectedValidationStateRevision: claim.row.state_revision,
          },
          {
            productId: nonready.scope.productId,
            sourceImportId: nonready.scope.importId,
            sourceValidationId: claim.row.id,
          },
        ),
      ),
    ).toBe("DRAFT_SOURCE_INVALID");
    expect(await counts()).toEqual({
      drafts: 0,
      revisions: 0,
      applications: 0,
      audits: 0,
    });
  });
  it("read-only can read receipts and fixed body but cannot write; revoked actor cannot replay", async () => {
    const first = await apply();
    const reader = await authenticateTestOperator(db, "read-only");
    const body = await safe(() =>
      service.readDraftRevision(
        db.app,
        reader.session.raw,
        source.scope.productId,
        first.application.draftId,
        1,
      ),
    );
    expect(body.draft.draftId).toBe(first.application.draftId);
    expect(
      (
        await safe(() =>
          service.readDraftApplicationByKey(
            db.app,
            reader.session.raw,
            source.scope.productId,
            source.input.idempotencyKey,
          ),
        )
      ).kind,
    ).toBe("applied");
    expect(
      await code(() =>
        service.applyReadyValidation(
          db.app,
          reader.credentials,
          source.scope,
          source.input,
        ),
      ),
    ).toBe("CAPABILITY_DENIED");
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${auth.id}`,
    );
    expect(await code(() => apply())).toBe("UNAUTHENTICATED");
  });
  it("two independent connections same key resolve to one created and one exact replay", async () => {
    const other = await safe(() => createDatabase(db.config));
    try {
      const results = await Promise.all([apply(), apply(other)]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(
        canonicalP1Json(results[0]!.application) ===
          canonicalP1Json(results[1]!.application),
      ).toBe(true);
      expect(await counts()).toEqual({
        drafts: 1,
        revisions: 1,
        applications: 1,
        audits: 1,
      });
    } finally {
      await other.close();
    }
  });
  it("two independent keys serialize on Product; loser gets finite draft conflict", async () => {
    const other = await safe(() => createDatabase(db.config));
    try {
      const outcomes = await Promise.all([
        apply().then(
          () => "created",
          (e) => (e instanceof StudioError ? e.code : "unexpected-error"),
        ),
        apply(other, { ...source.input, idempotencyKey: randomUUID() }).then(
          () => "created",
          (e) => (e instanceof StudioError ? e.code : "unexpected-error"),
        ),
      ]);
      expect(outcomes.sort()).toEqual(["DRAFT_ALREADY_EXISTS", "created"]);
      expect(await counts()).toEqual({
        drafts: 1,
        revisions: 1,
        applications: 1,
        audits: 1,
      });
    } finally {
      await other.close();
    }
  });
  it("confirmed commit with injected lost response preserves receipt and exact original retry", async () => {
    // Real PG COMMIT succeeds; only its result delivery is deliberately lost.
    const sql = new Proxy(db.app.sql, {
      get(target, property) {
        if (property === "begin")
          return async (...args: unknown[]) => {
            await Reflect.apply(target.begin, target, args);
            throw new StudioError("WRITE_OUTCOME_UNKNOWN");
          };
        return Reflect.get(target, property);
      },
    });
    const responseLost = { ...db.app, sql };
    expect(await code(() => apply(responseLost))).toBe("WRITE_OUTCOME_UNKNOWN");
    const receipt = await safe(() =>
      service.readDraftApplicationByKey(
        db.app,
        auth.session.raw,
        source.scope.productId,
        source.input.idempotencyKey,
      ),
    );
    expect(receipt.kind).toBe("applied");
    expect(
      (
        await safe(() =>
          service.readDraftApplicationByKey(
            db.app,
            auth.session.raw,
            source.scope.productId,
            randomUUID(),
          ),
        )
      ).kind,
    ).toBe("empty");
    const replay = await apply();
    expect(replay.created).toBe(false);
    if (receipt.kind === "applied")
      expect(
        canonicalP1Json(replay.application) ===
          canonicalP1Json(receipt.application),
      ).toBe(true);
    expect(await counts()).toEqual({
      drafts: 1,
      revisions: 1,
      applications: 1,
      audits: 1,
    });
  });
  it("reads >1MiB canonical and >2MiB wire historical synthetic body without F1 truncation", async () => {
    const big = await prepareP2b3Source(`b3-${randomUUID()}`, {
      largeContent: true,
    });
    const ready = await seedReadyP2b3Source(db, auth, big);
    const result = await apply(db.app, ready.input, ready.scope);
    const body = await safe(() =>
      service.readDraftRevision(
        db.app,
        auth.session.raw,
        ready.scope.productId,
        result.application.draftId,
        1,
      ),
    );
    expect(
      body.canonicalContentText === big.candidate.facts.canonicalContentText,
    ).toBe(true);
    expect(Buffer.byteLength(body.canonicalContentText)).toBeGreaterThan(
      1048576,
    );
    expect(Buffer.byteLength(JSON.stringify(body))).toBeGreaterThan(2097152);
    expect(result.application.fingerprint).toBe(
      await draftApplicationFingerprint({
        ...ready.scope,
        expectedValidationStateRevision:
          ready.input.expectedValidationStateRevision,
        expectedCandidateSha256: ready.input.expectedCandidateSha256,
        target: { kind: "new-draft" },
      }),
    );
  });
});
