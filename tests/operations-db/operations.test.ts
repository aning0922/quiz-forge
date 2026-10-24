import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  openTestDatabase,
  authenticateTestOperator,
  safeTestOperation,
  type TestDatabase,
} from "../db/p2a-fixture";
import { prepareConsumerFixture } from "../db/p4-consumer-fixture";
import { prepareP4ConsumerSource } from "../db/p4-source-fixture";
import { prepareP2b3Source, seedReadyP2b3Source } from "../db/p2b3-fixture";
import { createProductDraftService } from "@/features/product/drafts/service";
import { createProductDraftRevisionService } from "@/features/product/draft-revisions/service";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createInternalPlayService } from "@/features/product/internal-play/service";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { createProduct } from "@/features/product/workspace/service";
import {
  operationsService,
  listProductOperations,
  readProductOperations,
  readOperationsDashboard,
} from "@/features/studio/operations/service";
import * as repository from "@/features/studio/operations/repository";
import { parseOperationsQuery } from "@/features/studio/operations/query";
import {
  parseProductOperations,
  parseProductOperationsPage,
  parseOperationsDashboard,
} from "@/features/studio/operations/response";
import { handleOperationsHttp } from "@/features/studio/operations/http";
import { read } from "@/features/quizpack/import/repository";
import type { ProductOperationsPage } from "@/features/studio/operations/contracts";

let db: TestDatabase,
  operator: Awaited<ReturnType<typeof authenticateTestOperator>>,
  reader: typeof operator;
let fixture: Awaited<ReturnType<typeof prepareConsumerFixture>>,
  empty: ProductOperationsPage;
const query = (text = "") => parseOperationsQuery(new URLSearchParams(text));
const list = (text = "") =>
  listProductOperations(db.app, operator.session.raw, query(text));
const detail = () =>
  readProductOperations(db.app, operator.session.raw, fixture.productId);
const safe = <T>(work: () => PromiseLike<T>) => safeTestOperation(work);
function request(
  path: string,
  token: string | null = operator.session.raw,
  signal?: AbortSignal,
) {
  return new Request(`${db.config.origin}${path}`, {
    headers: {
      host: new URL(db.config.origin).host,
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    },
    ...(signal ? { signal } : {}),
  });
}
async function createDirectory(id: string) {
  return createProduct(
    db.app,
    { ...operator.credentials, requestId: randomUUID() },
    {
      id,
      slug: id,
      title: `Synthetic ${id}`,
      primaryCategoryId: null,
      tagIds: [],
    },
  );
}
beforeAll(async () => {
  db = await openTestDatabase();
  if (db.config.database.port !== 55435)
    throw Error("OPERATIONS_OWNED_FRESH_PORT_REQUIRED");
  // Recheck a selected counterexample against this retained owned instance.
  if (process.env.QUIZFORGE_OPERATIONS_RECHECK_RELATIONS === "1") {
    operator = await authenticateTestOperator(db);
    return;
  }
  const [row] = await db.admin.sql<
    { empty: boolean }[]
  >`SELECT NOT EXISTS(SELECT 1 FROM qf.product) empty`;
  if (row?.empty !== true) throw Error("OPERATIONS_FRESH_DATABASE_REQUIRED");
  operator = await authenticateTestOperator(db);
  reader = await authenticateTestOperator(db, "read-only");
  empty = await list("status=all");
  fixture = await prepareConsumerFixture(db, randomUUID());
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db?.close();
});

describe.sequential("A2a real isolated read-only operations", () => {
  it("returns an actual empty directory and explicit absence observations", async () => {
    expect(parseProductOperationsPage(empty).items).toEqual([]);
    expect(empty.total).toBe(0);
    await createDirectory("operations-empty");
    const value = parseProductOperations(
      await readProductOperations(
        db.app,
        operator.session.raw,
        "operations-empty",
      ),
    );
    expect(value.content.reception.total).toBe(0);
    expect(value.content.draft.state).toBe("none");
    expect(value.review.current.state).toBe("not-applicable");
  });
  it("keeps received/validated source metadata independent from an absent draft", async () => {
    const source = await seedReadyP2b3Source(
      db,
      operator,
      await prepareP2b3Source("operations-received"),
    );
    const value = parseProductOperations(
      await readProductOperations(
        db.app,
        operator.session.raw,
        source.scope.productId,
      ),
    );
    expect(value.content.reception.latest.state).toBe("present");
    expect(value.content.validation.latest.state).toBe("present");
    expect(value.content.draft.state).toBe("none");
    expect(value.review.current.state).toBe("not-applicable");
    expect(value.browserOperations.state).toBe("indeterminate");
  });
  it("preserves current exact review/version/play before and historical relationships after a new draft", async () => {
    let value = parseProductOperations(await detail());
    expect(value.review.current.state).toBe("present");
    expect(value.versions.currentCount).toBe(1);
    const clock = createStudioRequestBudget(new AbortController().signal),
      owner = createConsumerRequestOwner(db.config, clock);
    try {
      await createInternalPlayService(owner).create(
        { ...operator.credentials, requestId: randomUUID() },
        fixture.productId,
        {
          schemaVersion: "quizforge.internal-play-create.v1",
          operationKey: randomUUID(),
          parent: {
            productId: fixture.productId,
            versionId: fixture.parent!.version.id,
            snapshotSha256: fixture.parent!.version.snapshotSha256,
          },
          renderer: fixture.consumerRenderer!,
        },
      );
    } finally {
      await owner.closeIfNotTransferred();
    }
    value = parseProductOperations(await detail());
    expect(value.testing.currentCount).toBe(1);
    const source = await seedReadyP2b3Source(
      db,
      operator,
      await prepareP4ConsumerSource(randomUUID(), 2),
      { createProduct: false },
    );
    await createProductDraftRevisionService().appendReadyValidation(
      db.app,
      { ...operator.credentials, requestId: randomUUID() },
      source.scope,
      {
        idempotencyKey: randomUUID(),
        expectedValidationStateRevision:
          source.input.expectedValidationStateRevision,
        expectedCandidateSha256: source.input.expectedCandidateSha256,
        target: {
          kind: "append-revision",
          draftId: fixture.target!.draftId,
          expectedRevision: 1,
          expectedCanonicalContentSha256:
            fixture.target!.canonicalContentSha256,
          expectedAssetSetSha256: fixture.target!.assetSetSha256,
        },
      },
    );
    value = parseProductOperations(await detail());
    expect(
      value.content.draft.state === "present" &&
        value.content.draft.value.target.revision,
    ).toBe(2);
    expect(value.review.current.state).toBe("none");
    expect(value.review.historicalCount).toBe(1);
    expect(value.versions.currentCount).toBe(0);
    expect(value.versions.historicalCount).toBe(1);
    expect(value.testing.currentCount).toBe(0);
    expect(value.testing.historicalCount).toBe(1);
    expect(
      value.testing.historical.state === "present" &&
        value.testing.historical.value.parentVersionId,
    ).toBe(fixture.parent!.version.id);
  });
  it("reads sealed version/play metadata without selecting or hashing snapshot bodies", async () => {
    const statements: string[] = [];
    const values = await read(db.app, operator.session.raw, async (tx) => {
      // Record template text only; no query arguments, credentials, or snapshot payloads.
      const metadataTx = new Proxy(tx, {
        apply(target, receiver, args: unknown[]) {
          const parts = args[0];
          if (Array.isArray(parts) && "raw" in parts)
            statements.push(parts.join("?"));
          return Reflect.apply(target, receiver, args);
        },
      });
      const rows = await repository.operationsRows(
        tx,
        query("status=all&q=consumer-flow-fixture"),
      );
      return repository.projectOperationsRows(
        metadataTx,
        rows,
        await repository.observationTime(tx),
      );
    });
    const versions = statements.filter((text) =>
      /FROM qf\.(product_version|internal_play_version)\b/.test(text),
    );
    expect(versions).toHaveLength(2);
    for (const statement of versions) {
      expect(statement).not.toMatch(
        /snapshot_text|sha256_utf8|internal_version_valid|consumer_play_valid/,
      );
      expect(statement).toContain("snapshot_sha256");
    }
    expect(versions[0]).toContain(
      "rv.product_id=pv.product_id AND rv.id=pv.review_id AND rv.review_sha256=pv.review_sha256",
    );
    expect(versions[1]).toContain(
      "pv.product_id=play.product_id AND pv.id=play.parent_version_id AND pv.snapshot_sha256=play.parent_snapshot_sha256",
    );
    const value = parseProductOperations(values[0], "consumer-flow-fixture");
    const version =
      value.versions.current.state === "present"
        ? value.versions.current
        : value.versions.historical;
    const play =
      value.testing.current.state === "present"
        ? value.testing.current
        : value.testing.historical;
    expect(version.state).toBe("present");
    expect(play.state).toBe("present");
    if (version.state !== "present" || play.state !== "present")
      throw Error("SEALED_RELATION_REQUIRED");
    expect(play.value.parentVersionId).toBe(version.value.id);
    expect(play.value.parentSnapshotSha256).toBe(version.value.snapshotSha256);
    expect(play.value.target).toEqual(version.value.target);
  });
  it("filters before pagination, keeps AND semantics and dashboard drill-down counts", async () => {
    const source = await seedReadyP2b3Source(
      db,
      operator,
      await prepareP2b3Source("operations-draft"),
    );
    await createProductDraftService().applyReadyValidation(
      db.app,
      operator.credentials,
      source.scope,
      source.input,
    );
    for (let n = 0; n < 4; n++)
      await createDirectory(`operations-catalog-${n}`);
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.product SET archived_at=clock_timestamp(),updated_at=clock_timestamp(),metadata_revision=metadata_revision+1 WHERE id='operations-draft'`,
    );
    const missing = await list("status=all&review=missing&pageSize=1");
    expect(missing.total).toBe(2);
    expect(missing.items).toHaveLength(1);
    expect(missing.hasNext).toBe(true);
    const second = await list("status=all&review=missing&pageSize=1&page=2");
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.directory.id).not.toBe(
      missing.items[0]!.directory.id,
    );
    expect((await list("status=all&draft=absent&review=missing")).total).toBe(
      0,
    );
    expect((await list("status=all&review=current")).total).toBe(0);
    const dashboard = parseOperationsDashboard(
      await readOperationsDashboard(db.app, operator.session.raw),
    );
    expect(dashboard.activeDrafts.count).toBe(1);
    expect(dashboard.activeMissingReview.count).toBe(1);
    for (const metric of [
      dashboard.directoryTotal,
      dashboard.activeDrafts,
      dashboard.activeMissingReview,
    ]) {
      const result = await listProductOperations(
        db.app,
        operator.session.raw,
        metric.query,
      );
      expect(result.total).toBe(metric.count);
    }
    expect(dashboard.recentCreated).toHaveLength(5);
  });
  it("uses one RR snapshot when a directory row is inserted between count and page", async () => {
    const original = repository.operationsRows;
    const previous = (await list("status=all")).total;
    vi.spyOn(repository, "operationsRows").mockImplementationOnce(
      async (tx, input) => {
        await createDirectory("operations-concurrent");
        return original(tx, input);
      },
    );
    const result = parseProductOperationsPage(await list("status=all"));
    expect(result.total).toBe(previous);
    expect(
      result.items.some(
        (item) => item.directory.id === "operations-concurrent",
      ),
    ).toBe(false);
    expect((await list("status=all")).total).toBe(previous + 1);
  });
  it("keeps draft hashes and historical parents in the same snapshot during a concurrent append", async () => {
    const productId = "consumer-flow-fixture";
    const before = await readProductOperations(
      db.app,
      operator.session.raw,
      productId,
    );
    if (before.content.draft.state !== "present")
      throw Error("CURRENT_DRAFT_REQUIRED");
    const target = before.content.draft.value.target;
    const source = await seedReadyP2b3Source(
      db,
      operator,
      await prepareP4ConsumerSource(randomUUID(), 3),
      { createProduct: false },
    );
    const original = repository.operationsRows;
    vi.spyOn(repository, "operationsRows").mockImplementationOnce(
      async (tx, input) => {
        await createProductDraftRevisionService().appendReadyValidation(
          db.app,
          { ...operator.credentials, requestId: randomUUID() },
          source.scope,
          {
            idempotencyKey: randomUUID(),
            expectedValidationStateRevision:
              source.input.expectedValidationStateRevision,
            expectedCandidateSha256: source.input.expectedCandidateSha256,
            target: {
              kind: "append-revision",
              draftId: target.draftId,
              expectedRevision: target.revision,
              expectedCanonicalContentSha256: target.canonicalContentSha256,
              expectedAssetSetSha256: target.assetSetSha256,
            },
          },
        );
        return original(tx, input);
      },
    );
    const page = parseProductOperationsPage(
      await list(`status=all&q=${productId}`),
    );
    const observed = page.items[0]!;
    expect(page.total).toBe(1);
    expect(
      observed.content.draft.state === "present" &&
        observed.content.draft.value.target,
    ).toEqual(target);
    expect(observed.versions.historicalCount).toBe(1);
    expect(observed.testing.historicalCount).toBe(1);
    const after = await readProductOperations(
      db.app,
      operator.session.raw,
      productId,
    );
    expect(
      after.content.draft.state === "present" &&
        after.content.draft.value.target.revision,
    ).toBe(target.revision + 1);
  });
  it("supports read-only reads and rejects fresh missing/expired/disabled authority", async () => {
    expect(
      (await listProductOperations(db.app, reader.session.raw, query())).items
        .length,
    ).toBeGreaterThan(0);
    await expect(
      listProductOperations(db.app, null, query()),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await safe(
      () =>
        db.admin
          .sql`WITH t AS (SELECT clock_timestamp() at) UPDATE qf.operator_session SET created_at=t.at-interval '9 hours',last_seen_at=t.at-interval '90 minutes',idle_expires_at=t.at-interval '1 hour',absolute_expires_at=t.at-interval '1 hour' FROM t WHERE operator_id=${reader.id} AND kind='authenticated'`,
    );
    await expect(
      listProductOperations(db.app, reader.session.raw, query()),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const original = repository.projectOperationsRows;
    vi.spyOn(repository, "projectOperationsRows").mockImplementationOnce(
      async (...args) => {
        const value = await original(...args);
        await safe(
          () =>
            db.admin
              .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${operator.id}`,
        );
        return value;
      },
    );
    try {
      await expect(list("status=all")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    } finally {
      await safe(
        () =>
          db.admin
            .sql`UPDATE qf.operator SET status='active',disabled_at=NULL WHERE id=${operator.id}`,
      );
    }
  });
  it("rejects cross-product references and reports broken same-product relations as errors", async () => {
    await expect(
      safe(
        () =>
          db.admin
            .sql`UPDATE qf.internal_play_version SET product_id='operations-empty' WHERE product_id=${"consumer-flow-fixture"}`,
      ),
    ).rejects.toThrow();
    const result = await readProductOperations(
      db.app,
      operator.session.raw,
      "operations-empty",
    );
    expect(result.testing.currentCount + result.testing.historicalCount).toBe(
      0,
    );
    // A rolled-back owner-only fault cannot bypass the app response by becoming missing/none.
    await db.admin.sql
      .begin(async (tx) => {
        await tx`UPDATE qf.product_draft SET current_revision=current_revision+1 WHERE product_id='consumer-flow-fixture'`;
        const row = await tx<
          {
            id: string;
            slug: string;
            title: string;
            primary_category_id: string | null;
            metadata_revision: number;
            created_at: Date;
            updated_at: Date;
            archived_at: Date | null;
          }[]
        >`SELECT id,slug,title,primary_category_id,metadata_revision,created_at,updated_at,archived_at FROM qf.product WHERE id=${"consumer-flow-fixture"}`;
        await expect(
          repository.projectOperationsRows(tx, row, new Date().toISOString()),
        ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
        throw new Error("EXPECTED_FAULT_ROLLBACK");
      })
      .catch((error) => {
        if (error.message !== "EXPECTED_FAULT_ROLLBACK") throw error;
      });
  });
  it("does not write business/auth/audit rows and returns finite HTTP errors, never fake empty success", async () => {
    const state = async () =>
      db.admin.sql<
        { value: string }[]
      >`SELECT qf.sha256_utf8(jsonb_build_object('products',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM qf.product p),'draft',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM qf.product_draft d),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM qf.audit_event a),'sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM qf.operator_session s))::text) value`;
    const before = await state();
    const response = await handleOperationsHttp(
      request("/api/studio/operations/products?status=all"),
      { action: "list" },
      operationsService,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    parseProductOperationsPage(await response.json());
    await readOperationsDashboard(db.app, operator.session.raw);
    await detail();
    expect(await state()).toEqual(before);
    const missing = await handleOperationsHttp(
      request("/api/studio/operations/products", null),
      { action: "list" },
      operationsService,
    );
    expect(missing.status).toBe(401);
    const invalid = await handleOperationsHttp(
      request("/api/studio/operations/products?review=unknown"),
      { action: "list" },
      operationsService,
    );
    expect(invalid.status).toBe(400);
    const failed = await handleOperationsHttp(
      request("/api/studio/operations/dashboard"),
      { action: "dashboard" },
      {
        ...operationsService,
        readOperationsDashboard: async () => {
          throw Error("synthetic failure");
        },
      },
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: "STUDIO_UNAVAILABLE" });
  });
});
