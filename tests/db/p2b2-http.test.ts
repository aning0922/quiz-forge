import { createHash, randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { StudioError } from "@/lib/http-security/errors";
import { workspaceService } from "@/features/product/workspace/service";
import { configureImports } from "@/features/quizpack/import/config-management";
import {
  createImportReceiveService,
  importReceiveService,
} from "@/features/quizpack/import/service";
import {
  handleImportHttp,
  type ImportEndpoint,
} from "@/features/studio/imports/http";
import type { ImportDto, Page } from "@/features/quizpack/import/contracts";

let db: TestDatabase;
let actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
type Actor = typeof actor;
const productId = "http-receive";
const bytes = Buffer.from("synthetic HTTP bytes, not a ZIP");
const input = {
  expectedArchiveBytes: bytes.length,
  expectedArchiveSha256: createHash("sha256").update(bytes).digest("hex"),
  target: { kind: "new-draft" as const },
};
function incoming(
  action: ImportEndpoint["action"],
  auth: Actor | null = actor,
  body: BodyInit = JSON.stringify(input),
  extra: Record<string, string> = {},
  query = "",
) {
  const read = action === "read" || action === "list" || action === "settings";
  return new Request(
    `${db.config.origin}/api/studio/products/${productId}/imports${query}`,
    {
      method: read ? "GET" : action === "archive" ? "PUT" : "POST",
      headers: {
        host: new URL(db.config.origin).host,
        origin: db.config.origin,
        "content-type":
          action === "archive"
            ? "application/octet-stream"
            : "application/json",
        ...(auth
          ? {
              cookie: `${SESSION_COOKIE}=${auth.session.raw}`,
              "x-csrf-token": auth.session.dto.csrfToken,
            }
          : {}),
        ...extra,
      },
      ...(!read ? { body } : {}),
    },
  );
}
function call(
  action: ImportEndpoint["action"],
  request = incoming(action),
  id?: string,
  service = importReceiveService,
  product = productId,
) {
  return handleImportHttp(
    request,
    { action, productId: product, ...(id ? { importId: id } : {}) },
    service,
  );
}
async function code(response: Response) {
  return ((await response.json()) as { code: string }).code;
}
async function intent(key = randomUUID(), body = input) {
  const response = await call(
    "create",
    incoming("create", actor, JSON.stringify(body), { "idempotency-key": key }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as ImportDto;
}
async function product(id: string) {
  await safeTestOperation(() =>
    workspaceService.createProduct(db.app, actor.credentials, {
      id,
      slug: id,
      title: "合成 HTTP 工作区",
      primaryCategoryId: null,
      tagIds: [],
    }),
  );
}
beforeAll(async () => {
  db = await safeTestOperation(openTestDatabase);
});
beforeEach(async () => {
  await safeTestOperation(() => resetTestDatabase(db));
  await safeTestOperation(() => configureImports(db.config.instanceId, true));
  actor = await authenticateTestOperator(db);
  await product(productId);
});
afterAll(async () => {
  if (db) {
    await safeTestOperation(() => resetTestDatabase(db));
    await safeTestOperation(() =>
      configureImports(db.config.instanceId, false),
    );
    await safeTestOperation(() => db.close());
  }
});

describe("real PostgreSQL receipt HTTP boundary", () => {
  it("requires fresh authority and returns disabled settings with no-store", async () => {
    expect(await code(await call("settings", incoming("settings", null)))).toBe(
      "UNAUTHENTICATED",
    );
    await safeTestOperation(() =>
      configureImports(db.config.instanceId, false),
    );
    const readonly = await authenticateTestOperator(db, "read-only");
    const response = await call("settings", incoming("settings", readonly));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      enabled: false,
      maxArchiveBytes: 33554432,
      receiveTimeoutMs: 60000,
    });
    expect(
      await code(
        await call(
          "create",
          incoming("create", actor, JSON.stringify(input), {
            "idempotency-key": randomUUID(),
          }),
        ),
      ),
    ).toBe("IMPORTS_DISABLED");
  });
  it("preserves 201/200 idempotency and exact lookup across terminal states", async () => {
    const key = randomUUID();
    const record = await intent(key);
    const replay = await call(
      "create",
      incoming("create", actor, JSON.stringify(input), {
        "idempotency-key": key,
      }),
    );
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as ImportDto).id).toBe(record.id);
    expect(
      await code(
        await call(
          "create",
          incoming(
            "create",
            actor,
            JSON.stringify({
              ...input,
              expectedArchiveBytes: input.expectedArchiveBytes + 1,
            }),
            { "idempotency-key": key },
          ),
        ),
      ),
    ).toBe("IDEMPOTENCY_CONFLICT");
    expect(
      (await call("archive", incoming("archive", actor, bytes), record.id))
        .status,
    ).toBe(200);
    const lookup = await call(
      "list",
      incoming(
        "list",
        actor,
        "",
        {},
        `?idempotencyKey=${key}&page=1&pageSize=1`,
      ),
    );
    const page = (await lookup.json()) as Page<ImportDto>;
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("received");
    expect(page.items[0]?.validationStatus).toBe("not-run");
    expect(page.items[0]?.publishable).toBe(false);
  });
  it("enforces current read-only capability and cross-product binding", async () => {
    const record = await intent();
    const readonly = await authenticateTestOperator(db, "read-only");
    expect(
      (await call("read", incoming("read", readonly), record.id)).status,
    ).toBe(200);
    for (const action of ["create", "archive", "recover"] as const) {
      const body =
        action === "archive"
          ? bytes
          : action === "recover"
            ? JSON.stringify({ expectedStateRevision: record.stateRevision })
            : JSON.stringify(input);
      expect(
        await code(
          await call(
            action,
            incoming(action, readonly, body, {
              "idempotency-key": randomUUID(),
            }),
            record.id,
          ),
        ),
      ).toBe("CAPABILITY_DENIED");
    }
    await product("other-http");
    expect(
      await code(
        await call(
          "read",
          incoming("read"),
          record.id,
          importReceiveService,
          "other-http",
        ),
      ),
    ).toBe("IMPORT_NOT_FOUND");
  });
  it("rechecks a disabled switch after a true snapshot while preserving readable history", async () => {
    const record = await intent();
    expect((await call("settings")).status).toBe(200);
    await safeTestOperation(() =>
      configureImports(db.config.instanceId, false),
    );
    expect(
      await code(
        await call("archive", incoming("archive", actor, bytes), record.id),
      ),
    ).toBe("IMPORTS_DISABLED");
    expect((await call("read", incoming("read"), record.id)).status).toBe(200);
  });
  it("reads archived history but refuses new receipt operations", async () => {
    const record = await intent();
    const admin = await authenticateTestOperator(db, "admin");
    await safeTestOperation(() =>
      workspaceService.archiveProduct(db.app, admin.credentials, productId, {
        expectedMetadataRevision: 1,
      }),
    );
    expect((await call("read", incoming("read"), record.id)).status).toBe(200);
    expect(
      await code(
        await call("archive", incoming("archive", actor, bytes), record.id),
      ),
    ).toBe("PRODUCT_ARCHIVED");
  });
  it.each([
    "?unknown=1",
    "?page=1&page=2",
    "?page=01",
    "?pageSize=51",
    "?status=all",
    "?idempotencyKey=UPPER",
  ])("rejects strict list query %s", async (query) => {
    expect(
      await code(await call("list", incoming("list", actor, "", {}, query))),
    ).toBe("INVALID_REQUEST");
  });
  it("rejects Host/Origin/CSRF and cancels unstarted raw readers", async () => {
    const record = await intent();
    for (const extra of [
      { host: "localhost:9999" },
      { origin: "null" },
      { "x-csrf-token": "invalid" },
      { "content-type": "multipart/form-data" },
      { "content-encoding": "gzip" },
      { range: "bytes=0-1" },
    ]) {
      const read = vi.fn();
      const cancel = vi.fn(async () => undefined);
      const request = incoming("archive", actor, bytes, extra);
      Object.defineProperty(request, "body", {
        value: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
      });
      const response = await call("archive", request, record.id);
      expect([400, 403]).toContain(response.status);
      expect(read).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it("meters actual raw bytes despite a false Content-Length and cancels repeated received input", async () => {
    const record = await intent();
    const response = await call(
      "archive",
      incoming("archive", actor, bytes, { "content-length": "1" }),
      record.id,
    );
    expect(response.status).toBe(200);
    expect(((await response.json()) as ImportDto).actualArchiveBytes).toBe(
      bytes.length,
    );
    const read = vi.fn();
    const cancel = vi.fn(async () => undefined);
    const request = incoming("archive", actor, bytes);
    Object.defineProperty(request, "body", {
      value: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
    });
    expect((await call("archive", request, record.id)).status).toBe(200);
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("reports actual length/hash rejection without inventing validation", async () => {
    const record = await intent();
    expect(
      await code(
        await call(
          "archive",
          incoming("archive", actor, Buffer.alloc(bytes.length, 120)),
          record.id,
        ),
      ),
    ).toBe("RECEIVE_HASH_MISMATCH");
    const status = await call("read", incoming("read"), record.id);
    expect(await status.json()).toMatchObject({
      status: "rejected",
      validationStatus: "not-run",
      publishable: false,
    });
  });
  it("uses an independent committed-row observation before projecting a lost intent acknowledgment", async () => {
    const key = randomUUID();
    let observed = false;
    const real = createImportReceiveService({
      afterCommit: async (kind, row) => {
        if (kind !== "intent") return;
        const rows = await safeTestOperation(
          () =>
            db.admin.sql<
              { id: string }[]
            >`SELECT id FROM qf.quizpack_import WHERE id=${row.id} AND product_id=${productId} AND idempotency_key=${key}`,
        );
        if (rows.length !== 1) throw new Error("HTTP_COMMIT_PROOF_FAILED");
        observed = true;
        throw new StudioError("WRITE_OUTCOME_UNKNOWN");
      },
    });
    const response = await call(
      "create",
      incoming("create", actor, JSON.stringify(input), {
        "idempotency-key": key,
      }),
      undefined,
      real,
    );
    expect(observed).toBe(true);
    expect(await code(response)).toBe("WRITE_OUTCOME_UNKNOWN");
    const lookup = await call(
      "list",
      incoming(
        "list",
        actor,
        "",
        {},
        `?idempotencyKey=${key}&page=1&pageSize=1`,
      ),
    );
    expect(((await lookup.json()) as Page<ImportDto>).items).toHaveLength(1);
    expect(
      (
        await call(
          "create",
          incoming("create", actor, JSON.stringify(input), {
            "idempotency-key": key,
          }),
        )
      ).status,
    ).toBe(200);
  });
});
