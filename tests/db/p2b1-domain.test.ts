import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { createDatabase } from "@/lib/db/client";
import * as service from "@/features/product/workspace/service";
import {
  productListQuerySchema,
  taxonomyListQuerySchema,
  MAX_METADATA_REVISION,
} from "@/features/product/workspace/contracts";
let fixture: TestDatabase;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
  auth = await authenticateTestOperator(fixture, "admin");
});
afterAll(async () => {
  await fixture?.close();
});
const basic = (id = "synthetic-product") => ({
  id,
  slug: id,
  title: "Synthetic product",
  primaryCategoryId: null as string | null,
  tagIds: [] as string[],
});
const metadata = (expectedMetadataRevision = 1, changes = {}) => ({
  expectedMetadataRevision,
  slug: "synthetic-product",
  title: "Synthetic product",
  primaryCategoryId: null as string | null,
  tagIds: [] as string[],
  ...changes,
});
const productQuery = (changes = {}) => productListQuerySchema.parse(changes);
const taxonomyQuery = (changes = {}) => taxonomyListQuerySchema.parse(changes);
const create = (value = basic()) =>
  service.createProduct(fixture.app, auth.credentials, value);
const category = (slug = "synthetic-category") =>
  service.createTaxonomy(fixture.app, auth.credentials, "category", {
    slug,
    name: "Synthetic category",
  });
const tag = (slug = "synthetic-tag") =>
  service.createTaxonomy(fixture.app, auth.credentials, "tag", {
    slug,
    name: "Synthetic tag",
  });
const auditRows = () =>
  safe(
    () =>
      fixture.app
        .sql`SELECT action,target_kind,target_id,target_revision,actor_id,session_id,reason_code,outcome FROM qf.audit_event WHERE target_kind IS NOT NULL ORDER BY occurred_at`,
  );

describe("B1 real Product and taxonomy", () => {
  it("creates real roots/relations and finite target audit without content", async () => {
    const cat = await category(),
      t = await tag();
    const p = await create({
      ...basic(),
      title: " e\u0301 ",
      primaryCategoryId: cat.id,
      tagIds: [t.id],
    });
    expect(p.title).toBe("é");
    expect(p.createdAt).toBe(p.updatedAt);
    expect(p.metadataRevision).toBe(1);
    expect(p.tags.map((t) => t.id)).toEqual([t.id]);
    expect(p.primaryCategory?.id).toBe(cat.id);
    const rows = await auditRows();
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      action: "product_created",
      target_kind: "product",
      target_id: p.id,
      target_revision: 1,
      actor_id: auth.id,
      reason_code: null,
      outcome: "success",
    });
    const list = await service.listTaxonomy(
      fixture.app,
      auth.session.raw,
      "category",
      taxonomyQuery(),
    );
    expect(list.items[0]?.assignedProductCount).toBe(1);
  });
  it("maps identity and slug uniqueness even after archive", async () => {
    await create();
    await expect(create()).rejects.toMatchObject({
      code: "PRODUCT_ID_CONFLICT",
    });
    await expect(
      create({ ...basic("other"), slug: "synthetic-product" }),
    ).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    await service.archiveProduct(
      fixture.app,
      auth.credentials,
      "synthetic-product",
      { expectedMetadataRevision: 1 },
    );
    await expect(
      create({ ...basic("other"), slug: "synthetic-product" }),
    ).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    await category();
    await expect(category()).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    const all = await service.listTaxonomy(
      fixture.app,
      auth.session.raw,
      "category",
      taxonomyQuery({ slug: "synthetic-category", status: "all" }),
    );
    expect(all.items).toHaveLength(1);
  });
  it("requires explicit valid fields and rolls back missing references", async () => {
    await expect(
      create({ ...basic(), primaryCategoryId: randomUUID() }),
    ).rejects.toMatchObject({ code: "TAXONOMY_NOT_FOUND" });
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery(),
        )
      ).total,
    ).toBe(0);
    expect(await auditRows()).toHaveLength(0);
    await expect(
      create({ ...basic(), tagIds: [randomUUID()] }),
    ).rejects.toMatchObject({ code: "TAXONOMY_NOT_FOUND" });
    await expect(create({ ...basic(), title: "<bad>" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    await expect(
      create({
        ...basic(),
        tagIds: Array.from({ length: 9 }, () => randomUUID()),
      }),
    ).rejects.toMatchObject({ code: "TAG_LIMIT_EXCEEDED" });
    await expect(
      create({ ...basic(), tagIds: Array(2).fill(randomUUID()) }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
  it("CAS comes before no-op and set order does not mutate timestamps or audit", async () => {
    const t1 = await tag("tag-a"),
      t2 = await tag("tag-b");
    const p = await create({ ...basic(), tagIds: [t1.id, t2.id] });
    const no = await service.replaceProductMetadata(
      fixture.app,
      auth.credentials,
      p.id,
      metadata(1, { tagIds: [t2.id, t1.id] }),
    );
    expect(no.changed).toBe(false);
    expect(no.product.updatedAt).toBe(p.updatedAt);
    expect(await auditRows()).toHaveLength(3);
    const yes = await service.replaceProductMetadata(
      fixture.app,
      auth.credentials,
      p.id,
      metadata(1, { title: "Updated", tagIds: [t1.id, t2.id] }),
    );
    expect(yes.product.metadataRevision).toBe(2);
    await expect(
      service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        p.id,
        metadata(1, { title: "Updated", tagIds: [t1.id, t2.id] }),
      ),
    ).rejects.toMatchObject({
      code: "METADATA_REVISION_CONFLICT",
      currentRevision: 2,
    });
  });
  it("two independent connections with same revision commit exactly once", async () => {
    await create();
    const second = await safe(() => createDatabase(fixture.config));
    try {
      const results = await Promise.allSettled([
        service.replaceProductMetadata(
          fixture.app,
          auth.credentials,
          "synthetic-product",
          metadata(1, { title: "First" }),
        ),
        service.replaceProductMetadata(
          second,
          auth.credentials,
          "synthetic-product",
          metadata(1, { title: "Second" }),
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const failure = results.find((r) => r.status === "rejected");
      expect(failure?.status === "rejected" ? failure.reason.code : null).toBe(
        "METADATA_REVISION_CONFLICT",
      );
      expect(
        (
          await service.readProduct(
            fixture.app,
            auth.session.raw,
            "synthetic-product",
          )
        ).metadataRevision,
      ).toBe(2);
      expect(await auditRows()).toHaveLength(2);
    } finally {
      await second.close();
    }
  });
  it("archive and restore retain references, require revisions and provide no-op", async () => {
    const cat = await category(),
      t = await tag();
    const p = await create({
      ...basic(),
      primaryCategoryId: cat.id,
      tagIds: [t.id],
    });
    const archived = await service.archiveProduct(
      fixture.app,
      auth.credentials,
      p.id,
      { expectedMetadataRevision: 1 },
    );
    expect(archived.changed).toBe(true);
    expect(archived.product.tags).toHaveLength(1);
    expect(
      (
        await service.archiveProduct(fixture.app, auth.credentials, p.id, {
          expectedMetadataRevision: 2,
        })
      ).changed,
    ).toBe(false);
    await expect(
      service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        p.id,
        metadata(2),
      ),
    ).rejects.toMatchObject({ code: "PRODUCT_ARCHIVED" });
    await expect(
      service.restoreProduct(fixture.app, auth.credentials, p.id, {
        expectedMetadataRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "METADATA_REVISION_CONFLICT" });
    const restored = await service.restoreProduct(
      fixture.app,
      auth.credentials,
      p.id,
      { expectedMetadataRevision: 2 },
    );
    expect(restored.product.metadataRevision).toBe(3);
    expect(restored.product.primaryCategory?.id).toBe(cat.id);
    expect(
      (
        await service.restoreProduct(fixture.app, auth.credentials, p.id, {
          expectedMetadataRevision: 3,
        })
      ).changed,
    ).toBe(false);
    expect(await auditRows()).toHaveLength(5);
  });
  it.each(["category", "tag"] as const)(
    "archived %s may be retained/removed but never added",
    async (kind) => {
      const item = await service.createTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        { slug: "synthetic", name: "Synthetic" },
      );
      const refs =
        kind === "category"
          ? { primaryCategoryId: item.id }
          : { tagIds: [item.id] };
      await create({ ...basic(), ...refs });
      const archived = await service.archiveTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        item.id,
        { expectedRevision: 1 },
      );
      expect(archived.item.assignedProductCount).toBe(1);
      await expect(
        service.renameTaxonomy(fixture.app, auth.credentials, kind, item.id, {
          expectedRevision: 2,
          name: "Renamed",
        }),
      ).rejects.toMatchObject({ code: "TAXONOMY_ARCHIVED" });
      await service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        "synthetic-product",
        metadata(1, { ...refs, title: "Changed" }),
      );
      await expect(
        create({ ...basic("other"), ...refs }),
      ).rejects.toMatchObject({ code: "TAXONOMY_ARCHIVED" });
      await service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        "synthetic-product",
        metadata(2),
      );
      expect(
        (
          await service.listTaxonomy(
            fixture.app,
            auth.session.raw,
            kind,
            taxonomyQuery({ status: "all" }),
          )
        ).items[0]?.assignedProductCount,
      ).toBe(0);
      expect(
        (
          await service.archiveTaxonomy(
            fixture.app,
            auth.credentials,
            kind,
            item.id,
            { expectedRevision: 2 },
          )
        ).changed,
      ).toBe(false);
      const restored = await service.restoreTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        item.id,
        { expectedRevision: 2 },
      );
      expect(restored.item.revision).toBe(3);
      await create({ ...basic("other"), ...refs });
    },
  );
  it.each(["category", "tag"] as const)(
    "%s rename preserves slug; CAS/no-op and revision limit",
    async (kind) => {
      const item = await service.createTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        { slug: "synthetic", name: "Synthetic" },
      );
      const no = await service.renameTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        item.id,
        { expectedRevision: 1, name: " Synthetic " },
      );
      expect(no.changed).toBe(false);
      expect(no.item.updatedAt).toBe(item.updatedAt);
      const yes = await service.renameTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        item.id,
        { expectedRevision: 1, name: "Renamed" },
      );
      expect(yes.item.slug).toBe("synthetic");
      await expect(
        service.renameTaxonomy(fixture.app, auth.credentials, kind, item.id, {
          expectedRevision: 1,
          name: "Renamed",
        }),
      ).rejects.toMatchObject({
        code: "TAXONOMY_REVISION_CONFLICT",
        currentRevision: 2,
      });
      await safe(
        () =>
          fixture.admin
            .sql`UPDATE ${fixture.admin.sql(`qf.${kind}`)} SET revision=${MAX_METADATA_REVISION} WHERE id=${item.id}`,
      );
      expect(
        (
          await service.renameTaxonomy(
            fixture.app,
            auth.credentials,
            kind,
            item.id,
            { expectedRevision: MAX_METADATA_REVISION, name: "Renamed" },
          )
        ).changed,
      ).toBe(false);
      await expect(
        service.archiveTaxonomy(fixture.app, auth.credentials, kind, item.id, {
          expectedRevision: MAX_METADATA_REVISION,
        }),
      ).rejects.toMatchObject({ code: "REVISION_LIMIT" });
    },
  );
  it("Product revision max allows no-op but rejects all mutations", async () => {
    await create();
    await safe(
      () =>
        fixture.admin
          .sql`UPDATE qf.product SET metadata_revision=${MAX_METADATA_REVISION} WHERE id='synthetic-product'`,
    );
    expect(
      (
        await service.replaceProductMetadata(
          fixture.app,
          auth.credentials,
          "synthetic-product",
          metadata(MAX_METADATA_REVISION),
        )
      ).changed,
    ).toBe(false);
    await expect(
      service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        "synthetic-product",
        metadata(MAX_METADATA_REVISION, { title: "Changed" }),
      ),
    ).rejects.toMatchObject({ code: "REVISION_LIMIT" });
    await expect(
      service.archiveProduct(
        fixture.app,
        auth.credentials,
        "synthetic-product",
        { expectedMetadataRevision: MAX_METADATA_REVISION },
      ),
    ).rejects.toMatchObject({ code: "REVISION_LIMIT" });
  });
  it("read-only reads all, service writes deny, missing entity errors only authenticated", async () => {
    await create();
    const reader = await authenticateTestOperator(fixture, "read-only");
    expect(
      (
        await service.readProduct(
          fixture.app,
          reader.session.raw,
          "synthetic-product",
        )
      ).id,
    ).toBe("synthetic-product");
    await expect(
      service.createProduct(fixture.app, reader.credentials, basic("other")),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(
      service.readProduct(fixture.app, null, "missing"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      service.readProduct(fixture.app, reader.session.raw, "missing"),
    ).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
  });
  it("bounded literal filtering AND taxonomy, archived and stable pagination", async () => {
    const cat = await category(),
      t = await tag();
    await create({
      ...basic("one"),
      title: "100%_\\ literal",
      primaryCategoryId: cat.id,
      tagIds: [t.id],
    });
    await create(basic("two"));
    await create({ ...basic("three"), primaryCategoryId: cat.id });
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ q: "%_\\" }),
        )
      ).items.map((p) => p.id),
    ).toEqual(["one"]);
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ q: "' OR 1=1 --" }),
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ categoryId: cat.id, tagId: t.id }),
        )
      ).total,
    ).toBe(1);
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ categoryId: randomUUID() }),
        )
      ).total,
    ).toBe(0);
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ unclassified: true }),
        )
      ).items.map((p) => p.id),
    ).toEqual(["two"]);
    const first = await service.listProducts(
      fixture.app,
      auth.session.raw,
      productQuery({ pageSize: 2 }),
    );
    expect(first.items.map((p) => p.id)).toEqual(["three", "two"]);
    expect(first.hasNext).toBe(true);
    expect(first.total).toBe(3);
    const beyond = await service.listProducts(
      fixture.app,
      auth.session.raw,
      productQuery({ page: 1000, pageSize: 50 }),
    );
    expect(beyond.items).toHaveLength(0);
    expect(beyond.total).toBe(3);
    await service.archiveProduct(fixture.app, auth.credentials, "one", {
      expectedMetadataRevision: 1,
    });
    expect(
      (
        await service.listProducts(
          fixture.app,
          auth.session.raw,
          productQuery({ status: "archived" }),
        )
      ).items.map((p) => p.id),
    ).toEqual(["one"]);
    const listed = await service.listTaxonomy(
      fixture.app,
      auth.session.raw,
      "tag",
      taxonomyQuery({ slug: "synthetic-tag", status: "all" }),
    );
    expect(listed.total).toBe(1);
    expect(listed.items[0]?.assignedProductCount).toBe(1);
  });
});
