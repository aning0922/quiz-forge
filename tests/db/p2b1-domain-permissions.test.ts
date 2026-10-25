import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { migrateDatabase } from "@/lib/db/migrate";
import {
  createProduct,
  createTaxonomy,
} from "@/features/product/workspace/service";
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
/** Inspect only SQLSTATE; driver exceptions can contain query parameters. */
async function sqlState(work: () => PromiseLike<unknown>) {
  try {
    await work();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "UNKNOWN";
  }
}
describe("B1 database constraints and least privilege", () => {
  it("migration replay retains new table grants and old column restrictions", async () => {
    expect(
      await safe(() => migrateDatabase(fixture.admin.sql, fixture.config)),
    ).toEqual([]);
    const auth = await authenticateTestOperator(fixture);
    const p = await createProduct(fixture.app, auth.credentials, {
      id: "synthetic",
      slug: "synthetic",
      title: "Synthetic",
      primaryCategoryId: null,
      tagIds: [],
    });
    const admin = await authenticateTestOperator(fixture, "admin");
    const cat = await createTaxonomy(
      fixture.app,
      admin.credentials,
      "category",
      { slug: "synthetic", name: "Synthetic" },
    );
    expect(p.id).toBe("synthetic");
    expect(cat.revision).toBe(1);
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`UPDATE qf.operator SET role='read-only' WHERE id=${auth.id}`,
      ),
    ).toBe("42501");
    expect(
      await sqlState(
        () => fixture.app.sql`UPDATE qf.operator_session SET operator_id=NULL`,
      ),
    ).toBe("42501");
    expect(
      await sqlState(
        () => fixture.app.sql`UPDATE qf.audit_event SET target_revision=2`,
      ),
    ).toBe("42501");
    expect(
      await sqlState(() => fixture.app.sql`DELETE FROM qf.audit_event`),
    ).toBe("42501");
    expect(
      await sqlState(() => fixture.app.sql`CREATE TABLE qf.synthetic(x int)`),
    ).toBe("42501");
  });
  it.each(["product", "category", "tag"])(
    "%s denies mutable identity/created_at, hard delete and truncate",
    async (name) => {
      const table = fixture.app.sql(`qf.${name}`);
      expect(
        await sqlState(
          () =>
            fixture.app
              .sql`UPDATE ${table} SET id=${name === "product" ? "new-id" : randomUUID()}`,
        ),
      ).toBe("42501");
      expect(
        await sqlState(
          () =>
            fixture.app.sql`UPDATE ${table} SET created_at=clock_timestamp()`,
        ),
      ).toBe("42501");
      expect(await sqlState(() => fixture.app.sql`DELETE FROM ${table}`)).toBe(
        "42501",
      );
      expect(await sqlState(() => fixture.app.sql`TRUNCATE ${table}`)).toBe(
        "42501",
      );
      if (name !== "product")
        expect(
          await sqlState(
            () => fixture.app.sql`UPDATE ${table} SET slug='changed'`,
          ),
        ).toBe("42501");
    },
  );
  it("product_tag permits relation removal but denies UPDATE/TRUNCATE and caps slots", async () => {
    const auth = await authenticateTestOperator(fixture);
    const admin = await authenticateTestOperator(fixture, "admin");
    const ids: string[] = [];
    for (let i = 0; i < 9; i++)
      ids.push(
        (
          await createTaxonomy(fixture.app, admin.credentials, "tag", {
            slug: `tag-${i}`,
            name: "Synthetic",
          })
        ).id,
      );
    await createProduct(fixture.app, auth.credentials, {
      id: "synthetic",
      slug: "synthetic",
      title: "Synthetic",
      primaryCategoryId: null,
      tagIds: ids.slice(0, 8),
    });
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`INSERT INTO qf.product_tag(product_id,tag_id,slot) VALUES('synthetic',${ids[8]!},9)`,
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`INSERT INTO qf.product_tag(product_id,tag_id,slot) VALUES('synthetic',${ids[8]!},1)`,
      ),
    ).toBe("23505");
    expect(
      await sqlState(() => fixture.app.sql`UPDATE qf.product_tag SET slot=2`),
    ).toBe("42501");
    expect(await sqlState(() => fixture.app.sql`TRUNCATE qf.product_tag`)).toBe(
      "42501",
    );
    await safe(
      () =>
        fixture.app
          .sql`DELETE FROM qf.product_tag WHERE product_id='synthetic'`,
    );
    expect(
      await safe(() => fixture.app.sql`SELECT * FROM qf.product_tag`),
    ).toHaveLength(0);
  });
  it.each([
    "",
    " ",
    "\t",
    "a\nb",
    "<x>",
    "a\u200bb",
    "\u3000",
    "\u00a0",
    "X\u0600",
    "X\ufff9",
    "X\u{e0001}",
  ])("SQL rejects invalid text %j", async (title) => {
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic',${title},at,at FROM (SELECT clock_timestamp() at) m`,
      ),
    ).toBe("23514");
  });
  it("all three SQL text columns share frozen whitespace/format policy and normal Unicode limits", async () => {
    const invalid = ["\u3000", "\u00a0", "X\u0600", "X\ufff9", "X\u{e0001}"];
    for (const kind of ["category", "tag"] as const) {
      for (const name of invalid)
        expect(
          await sqlState(
            () =>
              fixture.app
                .sql`INSERT INTO ${fixture.app.sql(`qf.${kind}`)}(id,slug,name,created_at,updated_at) SELECT ${randomUUID()},'synthetic',${name},at,at FROM (SELECT clock_timestamp() at) m`,
          ),
        ).toBe("23514");
      const auth = await authenticateTestOperator(fixture, "admin");
      const dto = await createTaxonomy(fixture.app, auth.credentials, kind, {
        slug: "synthetic",
        name: "中文😀".repeat(10),
      });
      expect([...dto.name].length).toBe(30);
    }
  });
  it("SQL validates identity, lengths, times and revisions", async () => {
    for (const id of ["Upper", "-bad", "a--b", "a".repeat(81)])
      expect(
        await sqlState(
          () =>
            fixture.app
              .sql`INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT ${id},'synthetic','Synthetic',at,at FROM (SELECT clock_timestamp() at) m`,
        ),
      ).toMatch(/^(23514|22001)$/);
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`INSERT INTO qf.tag(id,slug,name,created_at,updated_at) SELECT ${randomUUID()},'synthetic',${"😀".repeat(41)},at,at FROM (SELECT clock_timestamp() at) m`,
      ),
    ).toBe("22001");
    const auth = await authenticateTestOperator(fixture);
    await createProduct(fixture.app, auth.credentials, {
      id: "synthetic",
      slug: "synthetic",
      title: "😀".repeat(120),
      primaryCategoryId: null,
      tagIds: [],
    });
    expect(
      await sqlState(
        () => fixture.app.sql`UPDATE qf.product SET metadata_revision=0`,
      ),
    ).toBe("23514");
    expect(
      await sqlState(
        () =>
          fixture.app
            .sql`UPDATE qf.product SET updated_at=created_at-interval '1 second'`,
      ),
    ).toBe("23514");
  });
  it("audit targets are all-null auth or matching finite business identity/revision", async () => {
    const auth = await authenticateTestOperator(fixture);
    const actor = auth.id,
      session = auth.session.dto.operator.id;
    const insert = (
      action: string,
      kind: string | null,
      id: string | null,
      revision: number | null,
    ) =>
      fixture.app
        .sql`INSERT INTO qf.audit_event(id,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},${action},'success',${actor},${session},${randomUUID()},${kind},${id},${revision})`;
    for (const [action, kind, id, revision] of [
      ["product_created", null, null, null],
      ["logout", "product", "synthetic", 1],
      ["tag_updated", "product", "synthetic", 1],
      ["category_updated", "category", "not-uuid", 1],
      ["product_updated", "product", "synthetic", 0],
      ["product_updated", "product", null, 1],
    ] as const)
      expect(await sqlState(() => insert(action, kind, id, revision))).toBe(
        "23514",
      );
    expect(
      await sqlState(() =>
        insert("product_created", "product", "synthetic", 1),
      ),
    ).toBe(null);
  });
});
