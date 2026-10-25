import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
} from "./p2a-fixture";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { StudioError } from "@/lib/http-security/errors";
import {
  handleWorkspaceHttp,
  type WorkspaceEndpoint,
} from "@/features/studio/workspace/http";
import * as service from "@/features/product/workspace/service";
import type {
  Page,
  ProductDto,
  ProductMutation,
  TaxonomyDto,
  TaxonomyMutation,
} from "@/features/product/workspace/contracts";

let fixture: Awaited<ReturnType<typeof openTestDatabase>>;
async function safe<T>(work: () => PromiseLike<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new Error(
      error instanceof StudioError ? error.code : "STUDIO_UNAVAILABLE",
    );
  }
}
async function session(role: "admin" | "operator" | "read-only" = "admin") {
  return (await safe(() => authenticateTestOperator(fixture, role))).session;
}
type Session = Awaited<ReturnType<typeof session>>;
function request(
  method: string,
  auth?: Session,
  body: unknown = {},
  query = "",
  extra: Record<string, string> = {},
) {
  const origin = fixture.config.origin;
  return new Request(`${origin}/api/studio/products${query}`, {
    method,
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      ...(auth
        ? {
            cookie: `${SESSION_COOKIE}=${auth.raw}`,
            "x-csrf-token": auth.dto.csrfToken,
          }
        : {}),
      ...extra,
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
function call(
  endpoint: WorkspaceEndpoint,
  auth?: Session,
  body: unknown = {},
  query = "",
  extra: Record<string, string> = {},
) {
  const method =
    endpoint.action === "list" || endpoint.action === "read"
      ? "GET"
      : endpoint.action === "replace" || endpoint.action === "rename"
        ? "PATCH"
        : "POST";
  return handleWorkspaceHttp(
    request(method, auth, body, query, extra),
    endpoint,
    service,
  );
}
async function code(response: Response) {
  const value = (await response.json()) as { code: string };
  return value.code;
}
const createInput = (id = "http-product") => ({
  id,
  slug: id,
  title: "合成工作区",
  primaryCategoryId: null,
  tagIds: [],
});
async function create(auth: Session, id = "http-product") {
  const result = await call(
    { domain: "product", action: "create" },
    auth,
    createInput(id),
  );
  expect(result.status).toBe(201);
  return result.json() as Promise<ProductDto>;
}
const metadata = (product: ProductDto) => ({
  expectedMetadataRevision: product.metadataRevision,
  slug: product.slug,
  title: product.title,
  primaryCategoryId: product.primaryCategory?.id ?? null,
  tagIds: product.tags.map((tag) => tag.id),
});

beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
});
afterAll(async () => {
  if (fixture) await safe(() => fixture.close());
});

describe("real PostgreSQL B1 HTTP boundary", () => {
  it("requires real session and refuses mismatched Host/Origin/Fetch Metadata and CSRF", async () => {
    expect(await code(await call({ domain: "product", action: "list" }))).toBe(
      "UNAUTHENTICATED",
    );
    const auth = await session();
    for (const headers of [
      { host: "localhost:9999" },
      { origin: "null" },
      { origin: "" },
      { "sec-fetch-site": "cross-site" },
    ]) {
      expect(
        await code(
          await call(
            { domain: "product", action: "create" },
            auth,
            createInput(),
            "",
            headers,
          ),
        ),
      ).toBe("ORIGIN_REJECTED");
    }
    for (const csrf of ["", "invalid"]) {
      expect(
        await code(
          await call(
            { domain: "product", action: "create" },
            auth,
            createInput(),
            "",
            { "x-csrf-token": csrf },
          ),
        ),
      ).toBe("CSRF_REJECTED");
    }
    const other = await session();
    expect(
      await code(
        await call(
          { domain: "product", action: "create" },
          auth,
          createInput(),
          "",
          { "x-csrf-token": other.dto.csrfToken },
        ),
      ),
    ).toBe("CSRF_REJECTED");
  });
  it("uses no-store and safe error envelopes", async () => {
    const response = await call({ domain: "product", action: "list" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = (await response.json()) as { code: string; requestId: string };
    expect(Object.keys(body).sort()).toEqual(["code", "requestId"]);
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  });
  it.each([
    "?unknown=yes",
    "?page=1&page=2",
    "?page=01",
    "?page=0",
    "?page=1001",
    "?pageSize=51",
    "?pageSize=1.5",
    "?unclassified=1",
    "?categoryId=bad",
    "?status=deleted",
    `?categoryId=${randomUUID()}&unclassified=true`,
  ])("rejects strict product query %s", async (query) => {
    const auth = await session();
    expect(
      await code(
        await call({ domain: "product", action: "list" }, auth, {}, query),
      ),
    ).toBe("INVALID_REQUEST");
  });
  it("rejects body extras, illegal identities, revision strings and query on writes/detail", async () => {
    const auth = await session();
    for (const body of [
      { ...createInput(), role: "operator" },
      { ...createInput(), id: "UPPER" },
      { ...createInput(), title: "<invalid>" },
    ]) {
      expect(
        await code(
          await call({ domain: "product", action: "create" }, auth, body),
        ),
      ).toBe("INVALID_REQUEST");
    }
    expect(
      await code(
        await call({ domain: "product", action: "create" }, auth, {
          ...createInput(),
          tagIds: Array.from({ length: 9 }, () => randomUUID()),
        }),
      ),
    ).toBe("TAG_LIMIT_EXCEEDED");
    const product = await create(auth);
    expect(
      await code(
        await call(
          { domain: "product", action: "replace", id: product.id },
          auth,
          { ...metadata(product), expectedMetadataRevision: "1" },
        ),
      ),
    ).toBe("INVALID_REQUEST");
    expect(
      await code(
        await call(
          { domain: "product", action: "read", id: "../invalid" },
          auth,
        ),
      ),
    ).toBe("INVALID_REQUEST");
    expect(
      await code(
        await call(
          { domain: "product", action: "read", id: product.id },
          auth,
          {},
          "?page=1",
        ),
      ),
    ).toBe("INVALID_REQUEST");
    expect(
      await code(
        await call(
          { domain: "product", action: "create" },
          auth,
          createInput("extra-query"),
          "?ignored=1",
        ),
      ),
    ).toBe("INVALID_REQUEST");
  });
  it("reads actual byte limits rather than Content-Length and rejects non-JSON", async () => {
    const auth = await session();
    const oversized = { ...createInput(), title: "a".repeat(4096) };
    const response = await call(
      { domain: "product", action: "create" },
      auth,
      oversized,
      "",
      { "content-length": "2" },
    );
    expect(response.status).toBe(413);
    expect(await code(response)).toBe("PAYLOAD_TOO_LARGE");
    expect(
      await code(
        await call(
          { domain: "product", action: "create" },
          auth,
          createInput(),
          "",
          { "content-type": "text/plain" },
        ),
      ),
    ).toBe("INVALID_REQUEST");
  });
  it("allows read-only reads but every valid product and taxonomy write is forbidden", async () => {
    const operator = await session();
    const product = await create(operator);
    const readonly = await session("read-only");
    expect(
      (
        await call(
          { domain: "product", action: "read", id: product.id },
          readonly,
        )
      ).status,
    ).toBe(200);
    for (const action of ["archive", "restore"] as const)
      expect(
        await code(
          await call({ domain: "product", action, id: product.id }, readonly, {
            expectedMetadataRevision: 1,
          }),
        ),
      ).toBe("CAPABILITY_DENIED");
    expect(
      await code(
        await call(
          { domain: "product", action: "create" },
          readonly,
          createInput("readonly-create"),
        ),
      ),
    ).toBe("CAPABILITY_DENIED");
    expect(
      await code(
        await call(
          { domain: "product", action: "replace", id: product.id },
          readonly,
          metadata(product),
        ),
      ),
    ).toBe("CAPABILITY_DENIED");
    for (const domain of ["category", "tag"] as const) {
      expect(
        await code(
          await call({ domain, action: "create" }, readonly, {
            slug: `readonly-${domain}`,
            name: "只读目录",
          }),
        ),
      ).toBe("CAPABILITY_DENIED");
      const created = await call({ domain, action: "create" }, operator, {
        slug: `operator-${domain}`,
        name: "合成目录",
      });
      expect(created.status).toBe(201);
      const item = (await created.json()) as TaxonomyDto;
      expect(
        await code(
          await call({ domain, action: "rename", id: item.id }, readonly, {
            expectedRevision: 1,
            name: "禁止改名",
          }),
        ),
      ).toBe("CAPABILITY_DENIED");
      for (const action of ["archive", "restore"] as const) {
        expect(
          await code(
            await call({ domain, action, id: item.id }, readonly, {
              expectedRevision: 1,
            }),
          ),
        ).toBe("CAPABILITY_DENIED");
      }
    }
  });
  it("returns authoritative CAS currentRevision and retains no-op revision", async () => {
    const auth = await session();
    const product = await create(auth);
    const noop = await call(
      { domain: "product", action: "replace", id: product.id },
      auth,
      metadata(product),
    );
    expect(((await noop.json()) as ProductMutation).changed).toBe(false);
    const changed = await call(
      { domain: "product", action: "replace", id: product.id },
      auth,
      { ...metadata(product), title: "修改后标题" },
    );
    expect(
      ((await changed.json()) as ProductMutation).product.metadataRevision,
    ).toBe(2);
    const conflict = await call(
      { domain: "product", action: "replace", id: product.id },
      auth,
      metadata(product),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: "METADATA_REVISION_CONFLICT",
      currentRevision: 2,
    });
  });
  it("provides reversible archival and archived IDs/slugs remain reserved", async () => {
    const auth = await session();
    const product = await create(auth);
    const archived = await call(
      { domain: "product", action: "archive", id: product.id },
      auth,
      { expectedMetadataRevision: 1 },
    );
    expect(
      ((await archived.json()) as ProductMutation).product.archivedAt,
    ).not.toBeNull();
    expect(
      await code(
        await call(
          { domain: "product", action: "replace", id: product.id },
          auth,
          { ...metadata(product), expectedMetadataRevision: 2 },
        ),
      ),
    ).toBe("PRODUCT_ARCHIVED");
    expect(
      await code(
        await call(
          { domain: "product", action: "create" },
          auth,
          createInput(),
        ),
      ),
    ).toBe("PRODUCT_ID_CONFLICT");
    expect(
      await code(
        await call({ domain: "product", action: "create" }, auth, {
          ...createInput("other-id"),
          slug: product.slug,
        }),
      ),
    ).toBe("SLUG_CONFLICT");
    const restored = await call(
      { domain: "product", action: "restore", id: product.id },
      auth,
      { expectedMetadataRevision: 2 },
    );
    expect(
      ((await restored.json()) as ProductMutation).product.archivedAt,
    ).toBeNull();
  });
  it("does literal search and returns bounded empty results for unknown valid filters/out-of-range pages", async () => {
    const auth = await session();
    await create(auth);
    for (const query of [
      "?q=%25",
      "?q=%5F",
      "?q=%5C",
      "?q=' OR 1=1 --",
      `?categoryId=${randomUUID()}`,
      `?tagId=${randomUUID()}`,
      "?page=1000",
    ]) {
      const result = await call(
        { domain: "product", action: "list" },
        auth,
        {},
        query,
      );
      expect(result.status).toBe(200);
      expect(((await result.json()) as Page<ProductDto>).items).toHaveLength(0);
    }
  });
  for (const domain of ["category", "tag"] as const) {
    it(`${domain} supports strict creation/rename/lifecycle and exact archived slug recovery`, async () => {
      const auth = await session();
      const created = await call({ domain, action: "create" }, auth, {
        slug: `${domain}-one`,
        name: "同名目录",
      });
      expect(created.status).toBe(201);
      const item = (await created.json()) as TaxonomyDto;
      expect(
        await code(
          await call({ domain, action: "rename", id: "INVALID" }, auth, {
            expectedRevision: 1,
            name: "名称",
          }),
        ),
      ).toBe("INVALID_REQUEST");
      const renamed = await call(
        { domain, action: "rename", id: item.id },
        auth,
        { expectedRevision: 1, name: "新名称" },
      );
      expect(((await renamed.json()) as TaxonomyMutation).item.revision).toBe(
        2,
      );
      const conflict = await call(
        { domain, action: "rename", id: item.id },
        auth,
        { expectedRevision: 1, name: "保留输入" },
      );
      expect(await conflict.json()).toMatchObject({
        code: "TAXONOMY_REVISION_CONFLICT",
        currentRevision: 2,
      });
      expect(
        (
          await call({ domain, action: "archive", id: item.id }, auth, {
            expectedRevision: 2,
          })
        ).status,
      ).toBe(200);
      const exact = await call(
        { domain, action: "list" },
        auth,
        {},
        `?slug=${item.slug}&status=all`,
      );
      const result = (await exact.json()) as Page<TaxonomyDto>;
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.id).toBe(item.id);
      expect(result.items[0]?.archivedAt).not.toBeNull();
      expect(
        await code(
          await call(
            { domain, action: "list" },
            auth,
            {},
            `?slug=${item.slug}&slug=other`,
          ),
        ),
      ).toBe("INVALID_REQUEST");
      expect(
        await code(
          await call({ domain, action: "create" }, auth, {
            slug: item.slug,
            name: "重复",
          }),
        ),
      ).toBe("SLUG_CONFLICT");
      const restored = await call(
        { domain, action: "restore", id: item.id },
        auth,
        { expectedRevision: 3 },
      );
      expect(
        ((await restored.json()) as TaxonomyMutation).item.archivedAt,
      ).toBeNull();
    });
  }
});
