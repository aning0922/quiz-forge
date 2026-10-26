import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
  authenticateTestOperator,
} from "./p2a-fixture";
import * as service from "@/features/product/workspace/service";
import { migrateDatabase } from "@/lib/db/migrate";
import {
  titleSchema,
  taxonomyNameSchema,
} from "@/features/product/workspace/contracts";
let fixture: TestDatabase;
beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
});
afterAll(async () => {
  await fixture?.close();
});
async function sqlState(work: () => PromiseLike<unknown>) {
  try {
    await work();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}
function insert(kind: "product" | "category" | "tag", text: string | null) {
  const sql = fixture.app.sql;
  const id = kind === "product" ? `probe-${randomUUID()}` : randomUUID();
  const slug = `probe-${randomUUID()}`;
  if (kind === "product")
    return sql`WITH m AS MATERIALIZED(SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT ${id},${slug},${text},at,at FROM m`;
  return sql`WITH m AS MATERIALIZED(SELECT clock_timestamp() at) INSERT INTO ${sql(`qf.${kind}`)}(id,slug,name,created_at,updated_at) SELECT ${id},${slug},${text},at,at FROM m`;
}
describe("B1 single frozen SQL text policy after upgrade", () => {
  it("replays 0005 without changing existing evidence and removes only legacy checks", async () => {
    const history = await safe(
      () =>
        fixture.admin
          .sql`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`,
    );
    expect(history.map((r) => r.version)).toContain(
      "0005_workspace_text_policy_source",
    );
    expect(
      await safe(() => migrateDatabase(fixture.admin.sql, fixture.config)),
    ).toEqual([]);
    expect(
      await safe(
        () =>
          fixture.admin
            .sql`SELECT version,checksum FROM qf_meta.schema_migrations ORDER BY version`,
      ),
    ).toEqual(history);
    const checks = await safe(
      () =>
        fixture.admin
          .sql`SELECT conname name FROM pg_constraint WHERE conrelid IN ('qf.product'::regclass,'qf.category'::regclass,'qf.tag'::regclass) AND contype='c' ORDER BY conname`,
    );
    const names = checks.map((r) => r.name);
    for (const kind of ["product", "category", "tag"]) {
      expect(names).toContain(`${kind}_unicode_text`);
      expect(names).not.toContain(
        kind === "product" ? "product_title_check" : `${kind}_name_check`,
      );
    }
  });
  it.each(["product", "category", "tag"] as const)(
    "%s accepts U2065 and normal non-BMP text admitted by frozen Schema",
    async (kind) => {
      const schema = kind === "product" ? titleSchema : taxonomyNameSchema;
      const allowed = [
        "X\u2065",
        "中文",
        "X\u{20000}",
        "X\u{1f600}",
        "X\u{1d11e}",
        "X\u{13440}",
      ];
      for (const value of allowed) {
        expect(schema.safeParse(value).success).toBe(true);
        expect(await sqlState(() => insert(kind, value))).toBe(null);
      }
    },
  );
  it.each(["product", "category", "tag"] as const)(
    "%s continues to reject blank, controls, formats, angle brackets and null",
    async (kind) => {
      const schema = kind === "product" ? titleSchema : taxonomyNameSchema;
      for (const value of [
        "",
        " ",
        "\u3000",
        "\u00a0",
        "X\u0080",
        "X\u2064",
        "X\u2066",
        "X\ufff9",
        "X\u{110bd}",
        "X\u{1343f}",
        "X\u{e0001}",
        "X<",
      ]) {
        expect(schema.safeParse(value).success).toBe(false);
        expect(await sqlState(() => insert(kind, value))).toBe("23514");
      }
      expect(await sqlState(() => insert(kind, null))).toBe("23502");
    },
  );
  it.each(["product", "category", "tag"] as const)(
    "%s retains exact Unicode code-point length limit",
    async (kind) => {
      const max = kind === "product" ? 120 : 40;
      const schema = kind === "product" ? titleSchema : taxonomyNameSchema;
      const atLimit = "\u{20000}".repeat(max),
        beyond = "\u{20000}".repeat(max + 1);
      expect(schema.safeParse(atLimit).success).toBe(true);
      expect(await sqlState(() => insert(kind, atLimit))).toBe(null);
      expect(schema.safeParse(beyond).success).toBe(false);
      expect(await sqlState(() => insert(kind, beyond))).toBe("22001");
    },
  );
});

describe("invalid UTF-16 fails before persistence", () => {
  it.each(["X\uD800", "X\uDC00"])(
    "rejects %j without revision or audit changes",
    async (value) => {
      const auth = await authenticateTestOperator(fixture);
      const admin = await authenticateTestOperator(fixture, "admin");
      const product = await service.createProduct(
        fixture.app,
        auth.credentials,
        {
          id: "synthetic",
          slug: "synthetic",
          title: "Synthetic",
          primaryCategoryId: null,
          tagIds: [],
        },
      );
      const category = await service.createTaxonomy(
        fixture.app,
        admin.credentials,
        "category",
        { slug: "synthetic", name: "Synthetic" },
      );
      const tag = await service.createTaxonomy(
        fixture.app,
        admin.credentials,
        "tag",
        { slug: "synthetic", name: "Synthetic" },
      );
      const before = await safe(
        () =>
          fixture.app
            .sql`SELECT id FROM qf.audit_event WHERE target_kind IS NOT NULL`,
      );
      await expect(
        service.createProduct(fixture.app, auth.credentials, {
          id: "other",
          slug: "other",
          title: value,
          primaryCategoryId: null,
          tagIds: [],
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(
          service.replaceProductMetadata(
            fixture.app,
            auth.credentials,
            product.id,
            {
              expectedMetadataRevision: 1,
              slug: product.slug,
              title: value,
              primaryCategoryId: null,
              tagIds: [],
            },
          ),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      for (const [kind, item] of [
        ["category", category],
        ["tag", tag],
      ] as const) {
        await expect(
          service.createTaxonomy(fixture.app, admin.credentials, kind, {
            slug: "other",
            name: value,
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(
          service.renameTaxonomy(
            fixture.app,
            admin.credentials,
            kind,
            item.id,
            {
              expectedRevision: 1,
              name: value,
            },
          ),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        await expect(
          service.listTaxonomy(fixture.app, auth.session.raw, kind, {
            page: 1,
            pageSize: 20,
            status: "all",
            q: value,
          }),
        ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
        const list = await service.listTaxonomy(
          fixture.app,
          auth.session.raw,
          kind,
          { page: 1, pageSize: 20, status: "all" },
        );
        expect(list.items).toHaveLength(1);
        expect(list.items[0]).toMatchObject({
          revision: 1,
          name: "Synthetic",
          updatedAt: item.updatedAt,
        });
      }
      await expect(
        service.listProducts(fixture.app, auth.session.raw, {
          page: 1,
          pageSize: 20,
          status: "all",
          unclassified: false,
          q: value,
        }),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(
        await service.readProduct(fixture.app, auth.session.raw, product.id),
      ).toMatchObject({
        metadataRevision: 1,
        title: "Synthetic",
        updatedAt: product.updatedAt,
      });
      expect(
        await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
      ).toHaveLength(1);
      expect(
        await safe(
          () =>
            fixture.app
              .sql`SELECT id FROM qf.audit_event WHERE target_kind IS NOT NULL`,
        ),
      ).toHaveLength(before.length);
    },
  );
  it("valid emoji persists exactly and identical input is a no-op", async () => {
    const auth = await authenticateTestOperator(fixture);
    const admin = await authenticateTestOperator(fixture, "admin");
    const value = "X\uD83D\uDE00";
    const product = await service.createProduct(fixture.app, auth.credentials, {
      id: "synthetic",
      slug: "synthetic",
      title: value,
      primaryCategoryId: null,
      tagIds: [],
    });
    expect(product.title).toBe(value);
    const result = await service.replaceProductMetadata(
      fixture.app,
      auth.credentials,
      product.id,
      {
        expectedMetadataRevision: 1,
        slug: product.slug,
        title: value,
        primaryCategoryId: null,
        tagIds: [],
      },
    );
    expect(result.changed).toBe(false);
    expect(result.product.metadataRevision).toBe(1);
    const item = await service.createTaxonomy(
      fixture.app,
      admin.credentials,
      "tag",
      { slug: "synthetic", name: value },
    );
    expect(item.name).toBe(value);
    expect(
      (
        await service.renameTaxonomy(
          fixture.app,
          admin.credentials,
          "tag",
          item.id,
          { expectedRevision: 1, name: value },
        )
      ).changed,
    ).toBe(false);
    expect(
      (
        await service.listProducts(fixture.app, auth.session.raw, {
          page: 1,
          pageSize: 20,
          status: "all",
          unclassified: false,
          q: value,
        })
      ).total,
    ).toBe(1);
  });
});
