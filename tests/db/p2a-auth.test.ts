import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
} from "./p2a-fixture";
import { createDatabase } from "@/lib/db/client";
import { acquireAuthWriteLock } from "@/lib/db/auth-lock";
import { createPreauth, logout, readSession } from "@/lib/auth/service";
import { handleStudioAuth } from "@/lib/auth/http";
import { requireCapability } from "@/lib/auth/capabilities";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import {
  csrfForToken,
  digestToken,
  issueToken,
} from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";

let fixture: Awaited<ReturnType<typeof openTestDatabase>>;

/** Strip raw driver exceptions even on test failure; never print credentials/cookies. */
async function safe<T>(work: () => PromiseLike<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new Error(
      error instanceof StudioError ? error.code : "STUDIO_UNAVAILABLE",
    );
  }
}
const rid = () => randomUUID();

// Password login, challenge consumption, KDF budgets and disable races are
// covered by tests/accounts-db. These tests exercise current sessions and HTTP guards.
async function authenticated(role: "operator" | "read-only" = "operator") {
  const identity = await authenticateTestOperator(fixture, role);
  return { id: identity.id, ...identity.session };
}
function request(
  endpoint: string,
  body = "{}",
  extra: Record<string, string> = {},
  method = "POST",
) {
  const origin = fixture.config.origin;
  return new Request(`${origin}/api/studio/auth/${endpoint}`, {
    method,
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      ...extra,
    },
    ...(method === "GET" ? {} : { body }),
  });
}
async function code(response: Response) {
  const value: unknown = await response.json();
  return value && typeof value === "object" && "code" in value
    ? value.code
    : null;
}

beforeAll(async () => {
  fixture = await safe(openTestDatabase);
});
beforeEach(async () => {
  await safe(() => resetTestDatabase(fixture));
});
afterAll(async () => {
  if (fixture) await safe(() => fixture.close());
});

describe("real PostgreSQL Studio auth", () => {
  it("records audit DB time after waiting for the shared auth lock", async () => {
    let pending: Promise<Awaited<ReturnType<typeof createPreauth>>> | undefined;
    let releasedAt = new Date(0);
    await safe(() =>
      fixture.admin.sql.begin(async (tx) => {
        await acquireAuthWriteLock(tx);
        pending = safe(() => createPreauth(fixture.app, null, rid()));
        await tx`SELECT pg_sleep(0.08)`;
        const [moment] = await tx<
          { at: Date }[]
        >`SELECT clock_timestamp() AS at`;
        releasedAt = moment!.at;
      }),
    );
    await pending;
    const [record] = await safe(
      () =>
        fixture.admin.sql<
          { occurred_at: Date }[]
        >`SELECT occurred_at FROM qf.audit_event WHERE action='preauth_created'`,
    );
    expect(record!.occurred_at.getTime() >= releasedAt.getTime()).toBe(true);
  });

  it("serializes disable/revoke vs touch and cannot revive the session", async () => {
    for (const disabled of [true, false]) {
      const current = await authenticated();
      const second = await safe(() => createDatabase(fixture.config));
      let outcome: Promise<string> | undefined;
      try {
        await safe(() =>
          fixture.admin.sql.begin(async (tx) => {
            await acquireAuthWriteLock(tx);
            outcome = safe(() => readSession(second, current.raw)).then(
              () => "success",
              (error) =>
                error instanceof Error ? error.message : "STUDIO_UNAVAILABLE",
            );
            await tx`SELECT pg_sleep(0.05)`;
            if (disabled)
              await tx`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${current.id}`;
            await tx`UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE token_digest=${digestToken(current.raw, "session")}`;
          }),
        );
        expect(await outcome).toBe("UNAUTHENTICATED");
        const [record] = await safe(
          () =>
            fixture.admin
              .sql`SELECT revoked_at IS NOT NULL AS revoked FROM qf.operator_session WHERE token_digest=${digestToken(current.raw, "session")}`,
        );
        expect(record?.revoked).toBe(true);
      } finally {
        await safe(() => second.close());
      }
    }
  });

  it("rejects revoked, disabled, idle-expired and absolute-expired sessions", async () => {
    for (const mode of ["revoked", "disabled", "idle", "absolute"]) {
      const current = await authenticated();
      if (mode === "revoked")
        await safe(
          () =>
            fixture.admin
              .sql`UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE token_digest=${digestToken(current.raw, "session")}`,
        );
      if (mode === "disabled")
        await safe(
          () =>
            fixture.admin
              .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${current.id}`,
        );
      if (mode === "idle")
        await safe(
          () =>
            fixture.admin
              .sql`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at) UPDATE qf.operator_session SET created_at=at-interval '1 hour',last_seen_at=at-interval '1 hour',idle_expires_at=at-interval '30 minutes',absolute_expires_at=at+interval '7 hours' FROM moment WHERE token_digest=${digestToken(current.raw, "session")}`,
        );
      if (mode === "absolute")
        await safe(
          () =>
            fixture.admin
              .sql`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at) UPDATE qf.operator_session SET created_at=at-interval '9 hours',last_seen_at=at-interval '61 minutes',idle_expires_at=at-interval '1 hour',absolute_expires_at=at-interval '1 hour' FROM moment WHERE token_digest=${digestToken(current.raw, "session")}`,
        );
      await expect(
        safe(() => readSession(fixture.app, current.raw)),
      ).rejects.toThrow("UNAUTHENTICATED");
    }
  });

  it("reads role changes from the DB and denies read-only writes at the data source", async () => {
    const current = await authenticated();
    await safe(
      () =>
        fixture.admin
          .sql`UPDATE qf.operator SET role='read-only' WHERE id=${current.id}`,
    );
    const actor = await safe(() => readSession(fixture.app, current.raw));
    expect(actor.role).toBe("read-only");
    expect(() => requireCapability(actor, "workspace:write")).toThrow(
      "CAPABILITY_DENIED",
    );
    await safe(() =>
      logout(fixture.app, current.raw, current.dto.csrfToken, rid()),
    );
    await expect(
      safe(() => readSession(fixture.app, current.raw)),
    ).rejects.toThrow("UNAUTHENTICATED");
  });

  it("rejects cross-session CSRF before any authentication mutation", async () => {
    const current = await authenticated();
    await expect(
      safe(() =>
        logout(
          fixture.app,
          current.raw,
          csrfForToken(issueToken("session").raw, "session"),
          rid(),
        ),
      ),
    ).rejects.toThrow("CSRF_REJECTED");
    expect((await safe(() => readSession(fixture.app, current.raw))).id).toBe(
      current.id,
    );
  });

  it("serializes preauth rate competition and caps audit insertion at twenty", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 24 }, () =>
        safe(() => createPreauth(fixture.app, null, rid())),
      ),
    );
    expect(
      outcomes.filter((value) => value.status === "fulfilled").length,
    ).toBe(20);
    const [audits] = await safe(
      () =>
        fixture.admin
          .sql`SELECT count(*)::int AS count FROM qf.audit_event WHERE action='preauth_created'`,
    );
    expect(audits?.count).toBe(20);
  });

  it("caps outstanding preauth even without recent audit rows", async () => {
    await safe(
      () => fixture.admin
        .sql`WITH moment AS MATERIALIZED (SELECT clock_timestamp() AS at)
      INSERT INTO qf.operator_session(id,token_digest,kind,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
      SELECT gen_random_uuid(), lpad(to_hex(n),64,'0'),'preauth',at,at,at+interval '5 minutes',at+interval '5 minutes' FROM moment,generate_series(1,100) n`,
    );
    await expect(
      safe(() => createPreauth(fixture.app, null, rid())),
    ).rejects.toThrow("RATE_LIMITED");
  });

  it("commits preauth and logout cookies with fixed attributes and no-cache session reads", async () => {
    const preauth = await handleStudioAuth(request("preauth"), "preauth");
    expect(preauth.status).toBe(201);
    const setCookie = preauth.headers.get("set-cookie") ?? "";
    expect(
      setCookie.includes("HttpOnly") &&
        setCookie.includes("SameSite=strict") &&
        setCookie.includes("Max-Age=300") &&
        !setCookie.includes("Domain=") &&
        !setCookie.includes("Secure"),
    ).toBe(true);
    // Real password-login cookie rotation is verified by the dedicated account suite.
    const fixtureSession = await authenticated();
    const sessionRaw = fixtureSession.raw;
    const response = await handleStudioAuth(
      request(
        "session",
        "",
        { cookie: `${SESSION_COOKIE}=${sessionRaw}` },
        "GET",
      ),
      "session",
    );
    expect(response.status).toBe(200);
    const dto: unknown = await response.json();
    expect(Object.keys(dto as object).sort()).toEqual([
      "absoluteExpiresAt",
      "csrfToken",
      "idleExpiresAt",
      "operator",
    ]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const conflict = await handleStudioAuth(
      request("preauth", "{}", { cookie: `${SESSION_COOKIE}=${sessionRaw}` }),
      "preauth",
    );
    expect(conflict.status).toBe(409);
    expect(await code(conflict)).toBe("ALREADY_AUTHENTICATED");
    expect(conflict.headers.has("set-cookie")).toBe(false);
    const exited = await handleStudioAuth(
      request("logout", "{}", {
        cookie: `${SESSION_COOKIE}=${sessionRaw}`,
        "x-csrf-token": csrfForToken(sessionRaw, "session")!,
      }),
      "logout",
    );
    expect(exited.status).toBe(204);
    expect((exited.headers.get("set-cookie") ?? "").includes("Max-Age=0")).toBe(
      true,
    );
    const old = await handleStudioAuth(
      request(
        "session",
        "",
        { cookie: `${SESSION_COOKIE}=${sessionRaw}` },
        "GET",
      ),
      "session",
    );
    expect(old.status).toBe(401);
  });

  it("enforces HTTP Host/Origin/CSRF/strict DTO and actual byte limits", async () => {
    const invalids: Array<[Request, number]> = [
      [request("preauth", "{}", { host: "localhost:3100" }), 403],
      [request("preauth", "{}", { origin: "null" }), 403],
      [request("preauth", "{}", { "sec-fetch-site": "same-site" }), 403],
      [request("preauth", '{"role":"operator"}'), 400],
      [
        request("preauth", '"' + "a".repeat(4095) + '"', {
          "content-length": "1",
        }),
        413,
      ],
    ];
    const missingOrigin = request("preauth");
    missingOrigin.headers.delete("origin");
    invalids.push([missingOrigin, 403]);
    for (const [incoming, status] of invalids)
      expect((await handleStudioAuth(incoming, "preauth")).status).toBe(status);
    const current = await authenticated();
    const badCsrf = await handleStudioAuth(
      request("logout", "{}", { cookie: `${SESSION_COOKIE}=${current.raw}` }),
      "logout",
    );
    expect(badCsrf.status).toBe(403);
    expect(await code(badCsrf)).toBe("CSRF_REJECTED");
  });

  it("rejects an actual stalled HTTP body at the five-second total deadline", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
    });
    const incoming = new Request(
      fixture.config.origin + "/api/studio/auth/preauth",
      {
        method: "POST",
        headers: {
          host: new URL(fixture.config.origin).host,
          origin: fixture.config.origin,
          "content-type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit,
    );
    const started = performance.now();
    const response = await handleStudioAuth(incoming, "preauth");
    expect(response.status).toBe(400);
    expect(performance.now() - started >= 4900).toBe(true);
    expect(body.locked).toBe(false);
  });
});
