import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  createDatabase,
  openSql,
  verifyDatabaseIdentity,
} from "@/lib/db/client";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { withStudioWrite } from "@/lib/auth/write";
import { readSession } from "@/lib/auth/service";
import { disableOperator } from "@/lib/db/management";
import * as service from "@/features/product/workspace/service";
let fixture: TestDatabase;
let auth: Awaited<ReturnType<typeof authenticateTestOperator>>;
beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
  auth = await authenticateTestOperator(fixture);
});
afterAll(async () => {
  await fixture?.close();
});
const basic = () => ({
  id: "synthetic",
  slug: "synthetic",
  title: "Synthetic",
  primaryCategoryId: null as string | null,
  tagIds: [] as string[],
});
function gate() {
  let release = () => {};
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
async function waitForLocks(count = 1, authOnly = true) {
  for (let i = 0; i < 100; i++) {
    const [row] = await safe(
      () =>
        fixture.admin
          .sql`SELECT count(*)::int n FROM pg_locks WHERE NOT granted AND (${authOnly} = false OR (locktype='advisory' AND classid=72461 AND objid=1))`,
    );
    if (row && row.n >= count) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("TEST_LOCK_WAIT_NOT_OBSERVED");
}
async function expireIn(milliseconds: number) {
  const actor = await readSession(fixture.app, auth.session.raw);
  await safe(
    () =>
      fixture.admin
        .sql`UPDATE qf.operator_session SET idle_expires_at=clock_timestamp()+${milliseconds}*interval '1 millisecond' WHERE id=${actor.sessionId}`,
  );
}
const settle = (promise: Promise<unknown>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({
      ok: false as const,
      code: (error as { code?: string }).code ?? "TEST_FAILED",
    }),
  );

describe("B1 real lock order and current-session races", () => {
  it.each(["category", "tag"] as const)(
    "%s archive before allocation rejects; reverse order retains reference",
    async (kind) => {
      auth = await authenticateTestOperator(fixture, "admin");
      const item = await service.createTaxonomy(
        fixture.app,
        auth.credentials,
        kind,
        { slug: "synthetic", name: "Synthetic" },
      );
      const second = await safe(() => createDatabase(fixture.config));
      try {
        for (const archiveFirst of [true, false]) {
          if (!archiveFirst)
            await service.restoreTaxonomy(
              fixture.app,
              auth.credentials,
              kind,
              item.id,
              { expectedRevision: 2 },
            );
          const hold = gate(),
            entered = gate();
          const blocker = safe(() =>
            fixture.admin.sql.begin(async (tx) => {
              await acquireAuthWriteLock(tx);
              entered.release();
              await hold.promise;
            }),
          );
          await entered.promise;
          const refs =
            kind === "category"
              ? { primaryCategoryId: item.id }
              : { tagIds: [item.id] };
          const archive = () =>
            service.archiveTaxonomy(
              fixture.app,
              auth.credentials,
              kind,
              item.id,
              { expectedRevision: archiveFirst ? 1 : 3 },
            );
          const allocate = () =>
            service.createProduct(second, auth.credentials, {
              ...basic(),
              ...refs,
            });
          const first = settle(archiveFirst ? archive() : allocate());
          try {
            await waitForLocks();
            const next = settle(archiveFirst ? allocate() : archive());
            await waitForLocks(2);
            hold.release();
            await blocker;
            const a = await first,
              b = await next;
            expect(a.ok).toBe(true);
            if (archiveFirst)
              expect(b).toMatchObject({ ok: false, code: "TAXONOMY_ARCHIVED" });
            else {
              expect(b.ok).toBe(true);
              const p = await service.readProduct(
                second,
                auth.session.raw,
                "synthetic",
              );
              expect(
                kind === "category"
                  ? p.primaryCategory?.archivedAt
                  : p.tags[0]?.archivedAt,
              ).toBeTruthy();
            }
          } finally {
            hold.release();
            await blocker;
            await first;
          }
        }
      } finally {
        await second.close();
      }
    },
  );
  it("auth wait checks current role under READ COMMITTED even when role defaults to RR", async () => {
    const actor = await readSession(fixture.app, auth.session.raw);
    expect(actor.role).toBe("operator");
    const sql = openSql(fixture.config.database, 1);
    await safe(() => verifyDatabaseIdentity(sql, fixture.config));
    await safe(
      () => sql`SET SESSION default_transaction_isolation='repeatable read'`,
    );
    const second = {
      ...fixture.app,
      sql,
      close: () => sql.end({ timeout: 3 }),
    };
    const hold = gate(),
      entered = gate();
    let pending: ReturnType<typeof settle> | undefined;
    const blocker = safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        await tx`UPDATE qf.operator SET role='read-only' WHERE id=${auth.id}`;
        entered.release();
        await hold.promise;
      }),
    );
    try {
      await entered.promise;
      pending = settle(
        service.createProduct(second, auth.credentials, basic()),
      );
      await waitForLocks();
      hold.release();
      await blocker;
      expect(await pending).toMatchObject({
        ok: false,
        code: "CAPABILITY_DENIED",
      });
      expect(
        await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
      ).toHaveLength(0);
    } finally {
      hold.release();
      await blocker;
      await pending;
      await second.close();
    }
  });
  it("pending disable commits before write and old actor cannot authorize", async () => {
    await readSession(fixture.app, auth.session.raw);
    const hold = gate(),
      entered = gate();
    const blocker = safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        await tx`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${auth.id}`;
        entered.release();
        await hold.promise;
      }),
    );
    await entered.promise;
    const pending = settle(
      service.createProduct(fixture.app, auth.credentials, basic()),
    );
    try {
      await waitForLocks();
      hold.release();
      await blocker;
      expect(await pending).toMatchObject({
        ok: false,
        code: "UNAUTHENTICATED",
      });
    } finally {
      hold.release();
      await blocker;
      await pending;
    }
  });
  it("business owns auth first, commits, then actual management disable revokes", async () => {
    await service.createProduct(fixture.app, auth.credentials, basic());
    const hold2 = gate(),
      entered2 = gate();
    const blocker2 = safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await tx`SELECT id FROM qf.product WHERE id='synthetic' FOR UPDATE`;
        entered2.release();
        await hold2.promise;
      }),
    );
    await entered2.promise;
    const changed = settle(
      service.replaceProductMetadata(
        fixture.app,
        auth.credentials,
        "synthetic",
        {
          expectedMetadataRevision: 1,
          slug: "synthetic",
          title: "Changed",
          primaryCategoryId: null,
          tagIds: [],
        },
      ),
    );
    let disabling: Promise<unknown> | undefined;
    try {
      await waitForLocks(1, false);
      disabling = safe(() =>
        disableOperator(fixture.config.instanceId, auth.id),
      );
      await waitForLocks();
      hold2.release();
      await blocker2;
      expect((await changed).ok).toBe(true);
      expect(await disabling).toMatchObject({ changed: true });
      expect(
        await safe(
          () =>
            fixture.app
              .sql`SELECT metadata_revision FROM qf.product WHERE id='synthetic'`,
        ),
      ).toMatchObject([{ metadata_revision: 2 }]);
      await expect(
        service.readProduct(fixture.app, auth.session.raw, "synthetic"),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      const receipts = await safe(
        () => fixture.admin.sql<{ operation_id: string }[]>`
        SELECT operation_id FROM qf.operator_account_operation
        WHERE target_id=${auth.id} AND actor_id IS NULL AND action='disable' AND status='completed'`,
      );
      expect(receipts).toHaveLength(1);
      // All assertions succeeded; remove only this unique target's confirmed maintenance receipt.
      await safe(
        () => fixture.admin.sql`DELETE FROM qf.operator_account_operation
        WHERE operation_id=${receipts[0]!.operation_id} AND target_id=${auth.id}
          AND actor_id IS NULL AND action='disable' AND status='completed'`,
      );
    } finally {
      hold2.release();
      await blocker2;
      await changed;
      await disabling;
    }
  });
  it.each(["auth", "product", "category"] as const)(
    "expiry after waiting for %s rolls back all business and audit",
    async (lock) => {
      if (lock === "category")
        auth = await authenticateTestOperator(fixture, "admin");
      const item =
        lock === "category"
          ? await service.createTaxonomy(
              fixture.app,
              auth.credentials,
              "category",
              { slug: "synthetic", name: "Synthetic" },
            )
          : null;
      if (lock === "product")
        await service.createProduct(fixture.app, auth.credentials, basic());
      const before = await safe(
        () =>
          fixture.app
            .sql`SELECT id FROM qf.audit_event WHERE target_kind IS NOT NULL`,
      );
      await expireIn(350);
      const hold = gate(),
        entered = gate();
      const blocker = safe(() =>
        fixture.admin.sql.begin(async (tx) => {
          if (lock === "auth") await acquireAuthWriteLock(tx);
          else if (lock === "product")
            await tx`SELECT id FROM qf.product WHERE id='synthetic' FOR UPDATE`;
          else
            await tx`SELECT id FROM qf.category WHERE id=${item!.id} FOR UPDATE`;
          entered.release();
          await hold.promise;
        }),
      );
      await entered.promise;
      const pending = settle(
        lock === "product"
          ? service.replaceProductMetadata(
              fixture.app,
              auth.credentials,
              "synthetic",
              {
                expectedMetadataRevision: 1,
                slug: "synthetic",
                title: "Changed",
                primaryCategoryId: null,
                tagIds: [],
              },
            )
          : service.createProduct(fixture.app, auth.credentials, {
              ...basic(),
              primaryCategoryId: item?.id ?? null,
            }),
      );
      try {
        await waitForLocks(1, lock === "auth");
        await safe(() => fixture.admin.sql`SELECT pg_sleep(0.4)`);
        hold.release();
        await blocker;
        expect(await pending).toMatchObject({
          ok: false,
          code: "UNAUTHENTICATED",
        });
        expect(
          await safe(
            () =>
              fixture.app
                .sql`SELECT id FROM qf.audit_event WHERE target_kind IS NOT NULL`,
          ),
        ).toHaveLength(before.length);
        if (lock === "product")
          expect(
            await safe(
              () => fixture.app.sql`SELECT metadata_revision FROM qf.product`,
            ),
          ).toMatchObject([{ metadata_revision: 1 }]);
        else
          expect(
            await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
          ).toHaveLength(0);
      } finally {
        hold.release();
        await blocker;
        await pending;
      }
    },
  );
  it("confirmed lock timeout returns WRITE_BUSY without partial write or retries", async () => {
    const hold = gate(),
      entered = gate();
    const blocker = safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        entered.release();
        await hold.promise;
      }),
    );
    await entered.promise;
    try {
      await expect(
        service.createProduct(fixture.app, auth.credentials, basic()),
      ).rejects.toMatchObject({ code: "WRITE_BUSY" });
      expect(
        await safe(() => fixture.admin.sql`SELECT id FROM qf.product`),
      ).toHaveLength(0);
    } finally {
      hold.release();
      await blocker;
    }
  });
  it("statement cancellation after mutation confirms rollback and returns WRITE_BUSY", async () => {
    let attempts = 0;
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          attempts++;
          await tx`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic','Synthetic',at,at FROM m`;
          await tx`SELECT pg_sleep(6)`;
        },
      ),
    ).rejects.toMatchObject({ code: "WRITE_BUSY" });
    expect(attempts).toBe(1);
    expect(
      await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
    ).toHaveLength(0);
  });
});

describe("B1 uncertain outcomes", () => {
  it("lost acknowledgement after real commit returns unknown once and can be verified by stable identity", async () => {
    let attempts = 0;
    const sql = new Proxy(fixture.app.sql, {
      get(target, property, receiver) {
        if (property !== "begin")
          return Reflect.get(target, property, receiver);
        return async (
          options: string,
          callback: Parameters<typeof target.begin>[1],
        ) => {
          attempts++;
          await target.begin(options, callback!);
          // Fault injection at the exact boundary after the real DB commit, before its receipt.
          throw new Error("TEST_COMMIT_ACKNOWLEDGEMENT_LOST");
        };
      },
    });
    await expect(
      service.createProduct({ ...fixture.app, sql }, auth.credentials, basic()),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(attempts).toBe(1);
    expect(
      (await service.readProduct(fixture.app, auth.session.raw, "synthetic"))
        .metadataRevision,
    ).toBe(1);
    expect(
      await safe(
        () =>
          fixture.app
            .sql`SELECT id FROM qf.audit_event WHERE action='product_created'`,
      ),
    ).toHaveLength(1);
  });
  it("backend termination during work is unknown, never automatic callback replay", async () => {
    const isolated = await safe(() => createDatabase(fixture.config));
    let attempts = 0;
    await expect(
      withStudioWrite(
        isolated,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          attempts++;
          await tx`SELECT pg_terminate_backend(pg_backend_pid())`;
        },
      ),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(attempts).toBe(1);
    await isolated.close();
  });
  it("transaction deadline termination is unknown rather than confirmed WRITE_BUSY", async () => {
    const isolated = await safe(() => createDatabase(fixture.config));
    let attempts = 0;
    await expect(
      withStudioWrite(
        isolated,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          attempts++;
          await tx`SET LOCAL statement_timeout='0'`;
          await tx`SELECT pg_sleep(11)`;
        },
      ),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(attempts).toBe(1);
    await isolated.close();
  });
});

describe("B1 read snapshot transport protection", () => {
  it.each(["backend", "deadline"] as const)(
    "read %s termination closes request client without driver uncaught exception",
    async (mode) => {
      const isolated = await safe(() => createDatabase(fixture.config));
      const sql = new Proxy(isolated.sql, {
        get(target, property, receiver) {
          if (property !== "begin")
            return Reflect.get(target, property, receiver);
          return (
            options: string,
            callback: (
              tx: Parameters<Parameters<typeof target.begin>[1]>[0],
            ) => Promise<unknown>,
          ) =>
            target.begin(options, async (tx) => {
              const faultTx = new Proxy(tx, {
                apply(targetTx, thisArg, args) {
                  const chunks = args[0] as string[] | undefined;
                  if (
                    chunks?.[0]?.includes(
                      "SELECT count(*)::int total FROM qf.product p",
                    )
                  ) {
                    if (mode === "backend")
                      return tx`SELECT pg_terminate_backend(pg_backend_pid())`;
                    return (async () => {
                      await tx`SET LOCAL statement_timeout='0'`;
                      return tx`SELECT pg_sleep(11)`;
                    })();
                  }
                  return Reflect.apply(targetTx, thisArg, args);
                },
              });
              return callback(faultTx);
            });
        },
      });
      try {
        await expect(
          service.listProducts({ ...isolated, sql }, auth.session.raw, {
            page: 1,
            pageSize: 20,
            status: "active",
            unclassified: false,
          }),
        ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
      } finally {
        await isolated.close();
      }
    },
  );
});
