import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductPreviewService } from "@/features/product/preview/service";
import {
  authorizedPreviewRead,
  reauthorizePreview,
  assertPreviewCsrf,
} from "@/features/product/preview/auth";
import {
  readFixedPreviewSource,
  resolveFixedPreviewResource,
} from "@/features/product/preview/repository";
import { StudioError } from "@/lib/http-security/errors";
import { prepareP3cSource } from "./p3c-source-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "./p2b3-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import {
  openTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
let db: TestDatabase;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
let readonly: typeof auth;
let scope: { productId: string; draftId: string; revision: number };
let prepared: Awaited<ReturnType<typeof prepareP3cSource>>;
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  readonly = await authenticateTestOperator(db, "read-only");
  prepared = await prepareP3cSource(`preview-${randomUUID()}`);
  const source = await seedReadyP2b3Source(db, auth, prepared);
  const result = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
  scope = {
    productId: source.scope.productId,
    draftId: result.application.draftId,
    revision: 1,
  };
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
const read = () =>
  safe(() =>
    authorizedPreviewRead(db.app, readonly.credentials, (tx) =>
      readFixedPreviewSource(tx, scope),
    ),
  );
it("read-only actor reads exact v2 and resources without audit/session writes", async () => {
  const [before] = await db.admin
    .sql`SELECT idle_expires_at::text expiry FROM qf.operator_session WHERE operator_id=${readonly.id}`;
  const fixed = await read();
  expect(fixed.content.schemaVersion).toBe("quizpack-content.v2");
  expect(fixed.binding.canonicalContentSha256).toBe(
    prepared.candidate.facts.canonicalContentSha256,
  );
  expect(fixed.binding.assetSetSha256).toBe(
    prepared.candidate.facts.assetSetSha256,
  );
  for (const r of fixed.content.resources) {
    const resolved = await safe(() =>
      authorizedPreviewRead(db.app, readonly.credentials, (tx) =>
        resolveFixedPreviewResource(tx, scope, {
          productId: r.productId,
          id: r.id,
          version: r.version,
        }),
      ),
    );
    expect(resolved.resource.sha256).toBe(r.sha256);
    expect(Object.keys(resolved.resource).sort()).toEqual([
      "bytes",
      "height",
      "mediaType",
      "resourceRef",
      "sha256",
      "width",
    ]);
  }
  const [after] = await db.admin
    .sql`SELECT idle_expires_at::text expiry FROM qf.operator_session WHERE operator_id=${readonly.id}`;
  expect(after).toEqual(before);
  assertPreviewCsrf(readonly.credentials);
});
it("exact revision and full resource membership reject current-pointer fallback and foreign refs", async () => {
  await expect(
    safe(() =>
      authorizedPreviewRead(db.app, readonly.credentials, (tx) =>
        readFixedPreviewSource(tx, { ...scope, revision: 2 }),
      ),
    ),
  ).rejects.toMatchObject({ code: "DRAFT_REVISION_NOT_FOUND" });
  const r = prepared.candidate.facts.content.resources[0]!;
  for (const ref of [
    { productId: "another-product", id: r.id, version: r.version },
    { productId: scope.productId, id: r.id, version: "9.0.0" },
  ])
    await expect(
      safe(() =>
        authorizedPreviewRead(db.app, readonly.credentials, (tx) =>
          resolveFixedPreviewResource(tx, scope, ref),
        ),
      ),
    ).rejects.toMatchObject({ code: "PREVIEW_RESOURCE_UNAVAILABLE" });
});
it("valid alias retains first source while later revision source remains previewable", async () => {
  // The existing first revision can be based on a second ready validation; aliases retain the first source.
  await resetDomainDatabase(db);
  auth = await authenticateTestOperator(db);
  readonly = await authenticateTestOperator(db, "read-only");
  const first = await seedReadyP2b3Source(db, auth, prepared);
  const second = await seedReadyP2b3Source(db, auth, prepared, {
    createProduct: false,
  });
  expect(second.scope.sourceValidationId).not.toBe(
    first.scope.sourceValidationId,
  );
  const created = await createProductDraftService().applyReadyValidation(
    db.app,
    auth.credentials,
    second.scope,
    second.input,
  );
  scope = {
    productId: second.scope.productId,
    draftId: created.application.draftId,
    revision: 1,
  };
  const fixed = await read();
  expect(fixed.content.resources).toHaveLength(5);
  const rows = await db.admin
    .sql`SELECT DISTINCT source_validation_id FROM qf.product_asset WHERE product_id=${scope.productId}`;
  expect(rows).toEqual([
    { source_validation_id: first.scope.sourceValidationId },
  ]);
});
it("new transaction sees actual operator disable and session revoke", async () => {
  await read();
  await db.admin
    .sql`UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE operator_id=${readonly.id}`;
  await expect(
    reauthorizePreview(db.app, readonly.credentials),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(read()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  readonly = await authenticateTestOperator(db, "read-only");
  await db.admin
    .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${readonly.id}`;
  await expect(read()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
});
it("service revalidates fixed hash before invoking projection and needs CSRF without import:create", async () => {
  const fixed = await read();
  const prepare = vi.fn(() => ({
    ok: false as const,
    code: "PREVIEW_UNSUPPORTED" as const,
  }));
  const service = createProductPreviewService({
    preparePreviewContent: prepare,
    scorePreview: () => {
      throw Error("unreachable");
    },
  });
  const budget = {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 15000,
  };
  await expect(
    service.entry(db.app, readonly.credentials, scope, budget),
  ).rejects.toMatchObject({ code: "PREVIEW_UNSUPPORTED" });
  expect(prepare).toHaveBeenCalledOnce();
  const input = {
    binding: { ...fixed.binding, assetSetSha256: "f".repeat(64) },
    requestId: randomUUID(),
    answers: [{ questionId: "q-one", optionId: "a-one" }],
  };
  await expect(
    service.score(db.app, readonly.credentials, scope, input, budget),
  ).rejects.toMatchObject({ code: "PREVIEW_BINDING_MISMATCH" });
  expect(prepare).toHaveBeenCalledOnce();
  await expect(
    service.score(
      db.app,
      { sessionToken: readonly.session.raw },
      scope,
      input,
      budget,
    ),
  ).rejects.toMatchObject({ code: "CSRF_REJECTED" });
  await expect(
    service.entry(db.app, readonly.credentials, scope, {
      ...budget,
      deadlineMonotonicMs: 0,
    }),
  ).rejects.toMatchObject({ code: "PREVIEW_TIMEOUT" });
  await expect(
    service.entry(db.app, readonly.credentials, scope, {
      ...budget,
      signal: AbortSignal.abort(),
    }),
  ).rejects.toMatchObject({ code: "PREVIEW_CANCELLED" });
});
it("historical v1 raw GET service remains readable while new preview rejects v1", async () => {
  const p = await prepareP2b3Source(`legacy-preview-${randomUUID()}`);
  const source = await seedReadyP2b3Source(db, auth, p);
  const service = createProductDraftService();
  const created = await service.applyReadyValidation(
    db.app,
    auth.credentials,
    source.scope,
    source.input,
  );
  const s = {
    productId: p.productId,
    draftId: created.application.draftId,
    revision: 1,
  };
  const raw = await service.readDraftRevision(
    db.app,
    readonly.session.raw,
    s.productId,
    s.draftId,
    s.revision,
  );
  expect(raw.draft.contentSchemaVersion).toBe("quizpack-content.v1");
  await expect(
    safe(() =>
      authorizedPreviewRead(db.app, readonly.credentials, (tx) =>
        readFixedPreviewSource(tx, s),
      ),
    ),
  ).rejects.toMatchObject({ code: "PREVIEW_UNSUPPORTED" });
});
// Explicitly preserve stable service errors; no assertion logs credentials or source bodies.
it("rejects missing authorization before source work", async () => {
  await expect(
    authorizedPreviewRead(db.app, { sessionToken: null }, async () => {
      throw Error("unreachable");
    }),
  ).rejects.toBeInstanceOf(StudioError);
});
