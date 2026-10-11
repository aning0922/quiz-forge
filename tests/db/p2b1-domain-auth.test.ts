import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import { withStudioWrite } from "@/lib/auth/write";
import { readSession, logout } from "@/lib/auth/service";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
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
describe("B1 shared write authority", () => {
  it("rechecks current role rather than accepting an old actor", async () => {
    const auth = await authenticateTestOperator(fixture);
    const old = await readSession(fixture.app, auth.session.raw);
    expect(old.role).toBe("operator");
    await safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        await tx`UPDATE qf.operator SET role='read-only' WHERE id=${auth.id}`;
      }),
    );
    let executed = false;
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async () => {
          executed = true;
        },
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    expect(executed).toBe(false);
  });
  it("rejects revoked sessions after an earlier read", async () => {
    const auth = await authenticateTestOperator(fixture);
    await readSession(fixture.app, auth.session.raw);
    await logout(
      fixture.app,
      auth.session.raw,
      auth.session.dto.csrfToken,
      auth.credentials.requestId,
    );
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async () => true,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
  it("checks CSRF and rolls back callbacks without exposing raw faults", async () => {
    const auth = await authenticateTestOperator(fixture);
    await expect(
      withStudioWrite(
        fixture.app,
        { ...auth.credentials, csrfToken: null },
        "workspace:write",
        async () => true,
      ),
    ).rejects.toMatchObject({ code: "CSRF_REJECTED" });
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          await tx`SELECT 1/0`;
        },
      ),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    expect(await safe(() => fixture.app.sql`SELECT 1`)).toHaveLength(1);
  });
  it("revalidates expiry at commit and rolls back domain writes", async () => {
    const auth = await authenticateTestOperator(fixture);
    const actor = await readSession(fixture.app, auth.session.raw);
    await safe(
      () =>
        fixture.admin
          .sql`UPDATE qf.operator_session SET idle_expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=${actor.sessionId}`,
    );
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          await tx`INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic','Synthetic',at,at FROM (SELECT clock_timestamp() at) m`;
          await tx`SELECT pg_sleep(0.4)`;
        },
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(
      await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
    ).toHaveLength(0);
  });
});

describe("B1 rollback evidence", () => {
  it("ordinary internal callback failure is definite after actual rollback", async () => {
    const auth = await authenticateTestOperator(fixture);
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          await tx`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic','Synthetic',at,at FROM m`;
          throw new Error("TEST_INTERNAL_FAILURE");
        },
      ),
    ).rejects.toMatchObject({ code: "STUDIO_UNAVAILABLE" });
    expect(
      await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
    ).toHaveLength(0);
  });
  it("business failure retains only its stable code after actual rollback", async () => {
    const { StudioError } = await import("@/lib/http-security/errors");
    const auth = await authenticateTestOperator(fixture);
    await expect(
      withStudioWrite(
        fixture.app,
        auth.credentials,
        "workspace:write",
        async (tx) => {
          await tx`WITH m AS(SELECT clock_timestamp() at) INSERT INTO qf.product(id,slug,title,created_at,updated_at) SELECT 'synthetic','synthetic','Synthetic',at,at FROM m`;
          throw new StudioError("TAXONOMY_ARCHIVED");
        },
      ),
    ).rejects.toMatchObject({ code: "TAXONOMY_ARCHIVED" });
    expect(
      await safe(() => fixture.app.sql`SELECT id FROM qf.product`),
    ).toHaveLength(0);
  });
  it("rollback receipt loss overrides a definite callback error and does not replay", async () => {
    const auth = await authenticateTestOperator(fixture);
    let attempts = 0;
    const sql = new Proxy(fixture.app.sql, {
      get(target, property, receiver) {
        if (property !== "begin")
          return Reflect.get(target, property, receiver);
        return async (
          options: string,
          callback: Parameters<typeof target.begin>[1],
        ) => {
          try {
            return await target.begin(options, callback!);
          } catch {
            throw new Error("TEST_ROLLBACK_RECEIPT_LOST");
          }
        };
      },
    });
    await expect(
      withStudioWrite(
        { ...fixture.app, sql },
        auth.credentials,
        "workspace:write",
        async (tx) => {
          attempts++;
          await tx`SELECT 1/0`;
        },
      ),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(attempts).toBe(1);
  });
});
