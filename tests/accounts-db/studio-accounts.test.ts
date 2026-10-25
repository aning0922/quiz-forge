import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { handleAccounts } from "@/lib/auth/accounts/http";
import { passwordSetupCsrf } from "@/features/studio/accounts/password-token";
import { SESSION_COOKIE, PREAUTH_COOKIE } from "@/lib/auth/cookies";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase, disableOperator } from "@/lib/db/management";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { createPreauth, login, readSession } from "@/lib/auth/service";
import {
  issueToken,
  csrfForToken,
  digestToken,
} from "@/lib/security/p2a-tokens";
import {
  accountCall,
  mutateAccount,
  issuePasswordToken,
  passwordTokenDigest,
  completePasswordSetup,
  passwordLogin,
  changeOwnPassword,
  setupResult,
  accountResult,
  readAccount,
  listAccounts,
  readAccountAudit,
} from "@/lib/auth/accounts/service";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";
import type { StudioRole } from "@/lib/auth/role-policy";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { withStudioWrite } from "@/lib/auth/write";
import {
  createTaxonomy,
  archiveProduct,
} from "@/features/product/workspace/service";
import type { AccountMutationDto } from "@/features/studio/accounts/contracts";
let owner: Awaited<ReturnType<typeof openManagedDatabase>>,
  db: P2aDatabase,
  instanceId: string,
  rootId: string,
  root: StudioWriteCredentials,
  fixtureHash: string;
const password = "synthetic accounts alpha passphrase 2026",
  nextPassword = "synthetic accounts beta passphrase 2026";
const op = () => randomUUID();
async function actor(role: StudioRole) {
  const id = op(),
    token = issueToken("session");
  await owner.sql`INSERT INTO qf.operator(id,label,login_name,display_name,password_hash,role,status) VALUES(${id},${"synthetic-" + id},${"synthetic-" + id},'合成账号',${fixtureHash},${role},'active')`;
  await owner.sql`WITH t AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${op()},${token.digest},'authenticated',${id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM t`;
  return {
    id,
    c: {
      sessionToken: token.raw,
      csrfToken: csrfForToken(token.raw, "session"),
      requestId: op(),
    },
  };
}
async function signIn(name: string, pw = password) {
  const pre = await createPreauth(db, null, op());
  const value = await passwordLogin(db, pre.raw, pre.dto.csrfToken, name, pw);
  return {
    sessionToken: value.raw,
    csrfToken: value.dto.csrfToken,
    requestId: op(),
  };
}
async function revision(id: string) {
  const [r] =
    await owner.sql`SELECT account_revision FROM qf.operator WHERE id=${id}`;
  return r!.account_revision as number;
}
const mutate = (c: StudioWriteCredentials, p: Record<string, unknown>) =>
  mutateAccount(db, c, { operationId: op(), ...p });
function tokenOf(result: AccountMutationDto) {
  if (!result.passwordSetup) throw Error("SETUP_LINK_REQUIRED");
  return new URLSearchParams(
    new URL(result.passwordSetup.url).hash.slice(1),
  ).get("token")!;
}
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  instanceId = config.instanceId;
  owner = await openManagedDatabase(instanceId);
  const [r] = await owner.sql`SELECT count(*)::int n FROM qf.operator`;
  if (r?.n !== 0) throw Error("PRISTINE_ACCOUNT_FIXTURE_REQUIRED");
  db = await createDatabase(config);
  fixtureHash = await withPasswordCapacity((k) => k.hash(password));
}, 30000);
afterAll(async () => {
  await db?.close();
  await owner?.close();
});
describe("accounts on a pristine isolated PG; no shared reset or deletion", () => {
  it("bootstraps the explicitly selected legacy identity only on successful setup, preserves IDs and then revokes old credentials/sessions", async () => {
    rootId = op();
    const legacy = issueToken("credential");
    await owner.sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${rootId},'synthetic-legacy',${legacy.digest},'operator','active')`;
    const pre = await createPreauth(db, null, op());
    const old = await login(db, pre.raw, pre.dto.csrfToken, legacy.raw, op());
    const token = issuePasswordToken();
    await accountCall(
      owner as unknown as P2aDatabase,
      "account_local",
      "",
      null,
      {
        action: "bootstrap-admin",
        targetId: rootId,
        operationId: op(),
        loginName: "synthetic-admin",
        displayName: "合成管理员",
        tokenId: token.id,
        tokenDigest: token.digest,
      },
      true,
    );
    expect((await readSession(db, old.raw)).role).toBe("operator");
    const setupId = op();
    await completePasswordSetup(db, token.digest, setupId, password);
    expect((await setupResult(db, token.digest, setupId)).status).toBe("found");
    await expect(readSession(db, old.raw)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const [row] =
      await owner.sql`SELECT id,label,credential_digest IS NULL cleared,role FROM qf.operator WHERE id=${rootId}`;
    expect(row).toMatchObject({
      id: rootId,
      label: "synthetic-legacy",
      cleared: true,
      role: "admin",
    });
    root = await signIn("synthetic-admin");
    expect((await readAccount(db, root.sessionToken)).id).toBe(rootId);
  });
  it("uses minimal DB grants and real granular role guards, with pending admin excluded from last-admin protection", async () => {
    await expect(
      db.sql`SELECT password_hash FROM qf.operator`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.sql`UPDATE qf.operator SET display_name='denied'`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.sql`DELETE FROM qf.operator_password_token`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.sql`SELECT qf.account_local('{}'::jsonb)`,
    ).rejects.toMatchObject({ code: "42501" });
    const staff = await actor("operator"),
      read = await actor("read-only");
    for (const a of [staff, read])
      await expect(
        listAccounts(db, a.c.sessionToken, {
          offset: 0,
          limit: 25,
          q: "",
          status: "all",
        }),
      ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(
      createTaxonomy(db, staff.c, "category", {
        slug: "synthetic-denied",
        name: "合成拒绝",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(
      archiveProduct(db, staff.c, "missing-product", {
        expectedMetadataRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await expect(
      withStudioWrite(db, staff.c, "review:record-baseline", async () => null),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await withStudioWrite(db, staff.c, "access-key:issue", async () => null);
    await withStudioWrite(db, staff.c, "access-key:void", async () => null);
    await expect(
      withStudioWrite(db, read.c, "access-key:issue", async () => null),
    ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
    await mutate(root, {
      action: "create",
      loginName: "synthetic-pending-admin",
      displayName: "合成待设密管理员",
      role: "admin",
    });
    await expect(
      mutate(root, {
        action: "disable",
        targetId: rootId,
        expectedRevision: await revision(rootId),
      }),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
    expect((await readSession(db, root.sessionToken)).role).toBe("admin");
  });
  it("binds receipt operations, rotates setup/reset tokens, consumes once, and keeps original results queryable only in the finite token window", async () => {
    const createId = op(),
      p = {
        operationId: createId,
        action: "create",
        loginName: "synthetic-member",
        displayName: "合成成员",
        role: "operator",
      };
    const first = await mutateAccount(db, root, p);
    expect(first.account.status).toBe("pending");
    const original = tokenOf(first);
    const repeated = await mutateAccount(db, root, p);
    expect(repeated.passwordSetup).toBeUndefined();
    await expect(
      mutateAccount(db, root, { ...p, displayName: "another" }),
    ).rejects.toMatchObject({ code: "OPERATION_BINDING_CONFLICT" });
    const replacement = await mutate(root, {
      action: "issue-setup",
      targetId: first.account.id,
      expectedRevision: first.account.revision,
    });
    await expect(
      completePasswordSetup(db, passwordTokenDigest(original), op(), password),
    ).rejects.toMatchObject({ code: "PASSWORD_TOKEN_INVALID" });
    const raw = tokenOf(replacement),
      digest = passwordTokenDigest(raw),
      setupId = op();
    const settled = await Promise.allSettled([
      completePasswordSetup(db, digest, setupId, password),
      completePasswordSetup(db, digest, op(), password),
    ]);
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const [completed] =
      await owner.sql`SELECT operation_id FROM qf.operator_account_operation WHERE token_id=${replacement.passwordSetup!.tokenId} AND action='password-setup'`;
    expect(
      (await setupResult(db, digest, completed!.operation_id)).status,
    ).toBe("found");
    expect((await setupResult(db, digest, op())).status).toBe("unknown");
    const member = await signIn("synthetic-member");
    const reset = await mutate(root, {
      action: "issue-reset",
      targetId: first.account.id,
      expectedRevision: await revision(first.account.id),
    });
    expect((await readSession(db, member.sessionToken)).id).toBe(
      first.account.id,
    );
    const resetId = op();
    await completePasswordSetup(
      db,
      passwordTokenDigest(tokenOf(reset)),
      resetId,
      nextPassword,
    );
    await expect(readSession(db, member.sessionToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const newLogin = await signIn("synthetic-member", nextPassword);
    expect((await readAccount(db, newLogin.sessionToken)).role).toBe(
      "operator",
    );
    await owner.sql`WITH t AS(SELECT clock_timestamp() at) UPDATE qf.operator_password_token SET issued_at=t.at-interval '26 hours',expires_at=t.at-interval '26 hours'+interval '30 minutes',consumed_at=t.at,revoked_at=t.at FROM t WHERE id=${reset.passwordSetup!.tokenId}`;
    expect(
      (await setupResult(db, passwordTokenDigest(tokenOf(reset)), resetId))
        .status,
    ).toBe("unknown");
    expect((await accountResult(db, root.sessionToken, resetId)).status).toBe(
      "found",
    );
  });
  it("revocation revision prevents an in-flight password login from creating a later session", async () => {
    const member = await actor("operator");
    const pre = await createPreauth(db, null, op());
    const digest = digestToken(pre.raw, "preauth")!,
      attemptId = op();
    await accountCall(
      db,
      "account_password",
      "reserve-login",
      digest,
      { attemptId, loginName: "synthetic-" + member.id },
      true,
    );
    await mutate(root, {
      action: "revoke-sessions",
      targetId: member.id,
      expectedRevision: await revision(member.id),
    });
    const token = issueToken("session");
    await expect(
      accountCall(
        db,
        "account_password",
        "finish-login",
        digest,
        {
          attemptId,
          verified: true,
          sessionId: op(),
          sessionDigest: token.digest,
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });
    await expect(readSession(db, token.raw)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("self password change and logout-all commit controlled self-revocation and retain receipts across reauthentication", async () => {
    const change = op();
    await changeOwnPassword(db, root, change, password, nextPassword);
    await expect(readSession(db, root.sessionToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    root = await signIn("synthetic-admin", nextPassword);
    expect((await accountResult(db, root.sessionToken, change)).status).toBe(
      "found",
    );
    const logout = op();
    const value = await mutateAccount(db, root, {
      operationId: logout,
      action: "logout-all",
      targetId: rootId,
    });
    expect(value.operation.status).toBe("completed");
    await expect(readSession(db, root.sessionToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    root = await signIn("synthetic-admin", nextPassword);
    expect((await accountResult(db, root.sessionToken, logout)).status).toBe(
      "found",
    );
    const audit = await readAccountAudit(db, root.sessionToken, {
      offset: 0,
      limit: 50,
    });
    expect(audit.items.some((x) => x.operationId === change)).toBe(true);
    expect(JSON.stringify(audit).includes("$argon2")).toBe(false);
  });
  it("persists bound rejection receipts when current-password verification fails or authority/token is revoked during KDF", async () => {
    const member = await actor("operator"),
      rejected = op();
    await expect(
      changeOwnPassword(
        db,
        member.c,
        rejected,
        "synthetic incorrect phrase 2026",
        nextPassword,
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_CONFIRMATION_FAILED" });
    expect(
      await accountResult(db, member.c.sessionToken, rejected),
    ).toMatchObject({
      status: "found",
      operation: {
        status: "rejected",
        errorCode: "PASSWORD_CONFIRMATION_FAILED",
      },
    });
    const change = op(),
      attemptId = op(),
      digest = digestToken(member.c.sessionToken!, "session");
    await accountCall(
      db,
      "account_password",
      "reserve-change",
      digest,
      { operationId: change, attemptId },
      true,
    );
    await mutate(root, {
      action: "revoke-sessions",
      targetId: member.id,
      expectedRevision: await revision(member.id),
    });
    await expect(
      accountCall(
        db,
        "account_password",
        "finish-change",
        digest,
        {
          operationId: change,
          attemptId,
          verified: true,
          passwordHash: fixtureHash,
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(await accountResult(db, root.sessionToken, change)).toMatchObject({
      status: "found",
      operation: { status: "rejected", errorCode: "UNAUTHENTICATED" },
    });
    const pending = await mutate(root, {
      action: "create",
      loginName: "synthetic-race",
      displayName: "合成撤销",
      role: "operator",
    });
    const raw = tokenOf(pending),
      setupDigest = passwordTokenDigest(raw),
      setup = op(),
      setupAttempt = op();
    await accountCall(
      db,
      "account_password",
      "reserve-setup",
      setupDigest,
      { operationId: setup, attemptId: setupAttempt },
      true,
    );
    await mutate(root, {
      action: "issue-setup",
      targetId: pending.account.id,
      expectedRevision: pending.account.revision,
    });
    await expect(
      accountCall(
        db,
        "account_password",
        "finish-setup",
        setupDigest,
        {
          operationId: setup,
          attemptId: setupAttempt,
          passwordHash: fixtureHash,
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "PASSWORD_TOKEN_INVALID" });
    expect(await setupResult(db, setupDigest, setup)).toMatchObject({
      status: "found",
      operation: { status: "rejected", errorCode: "PASSWORD_TOKEN_INVALID" },
    });
    const [row] =
      await owner.sql`SELECT password_hash IS NULL pending FROM qf.operator WHERE id=${pending.account.id}`;
    expect(row!.pending).toBe(true);
  });
  it("enforces real HTTP source/schema/CSRF checks, bearer-only setup and session cookie lifecycle", async () => {
    const origin = db.config.origin;
    const post = (
      endpoint: Parameters<typeof handleAccounts>[1],
      body: unknown,
      csrf: string | null,
      cookie = "",
      extra: Record<string, string> = {},
    ) =>
      handleAccounts(
        new Request(origin + "/api/studio/auth/test", {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            "content-type": "application/json",
            ...(csrf ? { "x-csrf-token": csrf } : {}),
            cookie,
            ...extra,
          },
          body: JSON.stringify(body),
        }),
        endpoint,
      );
    const pending = await mutate(root, {
      action: "create",
      loginName: "synthetic-http",
      displayName: "合成 HTTP",
      role: "operator",
    });
    const raw = tokenOf(pending),
      csrf = await passwordSetupCsrf(raw),
      setup = op();
    expect(
      new URLSearchParams(
        new URL(pending.passwordSetup!.url).hash.slice(1),
      ).get("tokenId"),
    ).toBe(pending.passwordSetup!.tokenId);
    expect(
      (
        await post("setup-inspect", { token: raw }, csrf, "", {
          origin: "http://evil.invalid",
        })
      ).status,
    ).toBe(403);
    expect((await post("setup-inspect", { token: raw }, null)).status).toBe(
      403,
    );
    expect(
      (await post("setup-inspect", { token: raw, unexpected: true }, csrf))
        .status,
    ).toBe(400);
    const unrelated = SESSION_COOKIE + "=" + root.sessionToken;
    const inspected = await post(
      "setup-inspect",
      { token: raw },
      csrf,
      unrelated,
    );
    expect(inspected.status).toBe(200);
    expect(inspected.headers.get("cache-control")).toContain("no-store");
    const completed = await post(
      "setup",
      { token: raw, operationId: setup, password },
      csrf,
      unrelated,
    );
    expect(completed.status).toBe(200);
    expect(completed.headers.get("set-cookie")).toBeNull();
    expect((await readSession(db, root.sessionToken)).id).toBe(rootId);
    expect((await post("setup-inspect", { token: raw }, csrf)).status).toBe(
      400,
    );
    const result = await post(
      "setup-result",
      { token: raw, operationId: setup },
      csrf,
    );
    expect(await result.json()).toMatchObject({
      status: "found",
      operation: { operationId: setup },
    });
    const pre = await createPreauth(db, null, op());
    const logged = await post(
      "password-login",
      { loginName: "synthetic-http", password },
      pre.dto.csrfToken,
      PREAUTH_COOKIE + "=" + pre.raw,
    );
    expect(logged.status).toBe(200);
    const setCookie = logged.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    const session = setCookie.match(
      new RegExp(SESSION_COOKIE + "=([^;]+)"),
    )![1]!;
    const dto = await logged.json();
    const logout = await post(
      "logout-all",
      { operationId: op() },
      dto.csrfToken,
      SESSION_COOKIE + "=" + session,
    );
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(readSession(db, session)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("keeps the original durable receipt after an injected lost commit acknowledgement", async () => {
    const operationId = op();
    const faulty = {
      ...db,
      sql: new Proxy(db.sql, {
        get(target, key, receiver) {
          if (key === "begin")
            return async (work: (tx: unknown) => Promise<unknown>) => {
              await target.begin(async (tx) => work(tx));
              throw Object.assign(new Error("synthetic lost acknowledgement"), {
                code: "ECONNRESET",
              });
            };
          return Reflect.get(target, key, receiver);
        },
      }),
    } as P2aDatabase;
    await expect(
      mutateAccount(faulty, root, {
        operationId,
        action: "create",
        loginName: "synthetic-unknown",
        displayName: "合成未知回执",
        role: "read-only",
      }),
    ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    expect(
      await accountResult(db, root.sessionToken, operationId),
    ).toMatchObject({
      status: "found",
      operation: { operationId, status: "completed" },
    });
    const [r] =
      await owner.sql`SELECT count(*)::int n FROM qf.operator WHERE id=${operationId}`;
    expect(r!.n).toBe(1);
  });
  it("runs owner CLI enrollment and recovery with private files and preserves legacy identity and live sessions until consumption", async () => {
    const execute = promisify(execFile),
      legacy = op(),
      credential = issueToken("credential"),
      operationId = op();
    await owner.sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${legacy},'synthetic-cli',${credential.digest},'read-only','active')`;
    const folder = path.dirname(process.env.QUIZFORGE_P2A_CONFIG!),
      setupFile = path.join(folder, "account-setup-" + operationId + ".json");
    const args = [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/studio-accounts.ts",
    ];
    const { stdout } = await execute(process.execPath, [
      ...args,
      "enroll",
      "--instance",
      instanceId,
      "--operator-id",
      legacy,
      "--operation-id",
      operationId,
      "--setup-file",
      setupFile,
      "--login-name",
      "synthetic-cli",
      "--display-name",
      "合成 CLI",
    ]);
    expect(JSON.parse(stdout)).toMatchObject({
      id: legacy,
      operationId,
      setupFile,
    });
    expect(stdout).not.toContain("#token=");
    expect((await stat(setupFile)).mode & 0o777).toBe(0o600);
    const file = JSON.parse(await readFile(setupFile, "utf8")),
      params = new URLSearchParams(new URL(file.url).hash.slice(1));
    expect(params.get("tokenId")).toMatch(/^[0-9a-f-]{36}$/);
    const [r] =
      await owner.sql`SELECT id,label,role,credential_digest=${credential.digest} intact,password_hash IS NULL pending FROM qf.operator WHERE id=${legacy}`;
    expect(r).toMatchObject({
      id: legacy,
      label: "synthetic-cli",
      role: "read-only",
      intact: true,
      pending: true,
    });
    const recovery = op(),
      recoveryFile = path.join(folder, "account-setup-" + recovery + ".json");
    await execute(process.execPath, [
      ...args,
      "recover-admin",
      "--instance",
      instanceId,
      "--operator-id",
      rootId,
      "--operation-id",
      recovery,
      "--setup-file",
      recoveryFile,
    ]);
    expect((await readSession(db, root.sessionToken)).role).toBe("admin");
    expect((await stat(recoveryFile)).mode & 0o777).toBe(0o600);
  });
  it("serializes two admins attempting mutual demotion and protects the survivor through both web and local maintenance", async () => {
    const other = await actor("admin");
    const settled = await Promise.allSettled([
      mutate(root, {
        action: "role",
        targetId: other.id,
        expectedRevision: await revision(other.id),
        role: "operator",
      }),
      mutate(other.c, {
        action: "role",
        targetId: rootId,
        expectedRevision: await revision(rootId),
        role: "operator",
      }),
    ]);
    expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rows =
      await owner.sql`SELECT id FROM qf.operator WHERE role='admin' AND status='active' AND password_hash IS NOT NULL`;
    expect(rows).toHaveLength(1);
    await expect(
      disableOperator(instanceId, rows[0]!.id),
    ).rejects.toMatchObject({ code: "LAST_ACTIVE_ADMIN" });
  });
  it("applies current-password and all-KDF budgets before work and retains window-protected reservations", async () => {
    // Wait for the real rolling window; never clear/age existing unknown reservations to make quota pass.
    const deadline = Date.now() + 65000;
    while (true) {
      const [r] =
        await owner.sql`SELECT count(*)::int n FROM qf.operator_kdf_attempt WHERE created_at>clock_timestamp()-interval '60 seconds'`;
      if (r!.n === 0) break;
      if (Date.now() > deadline) throw Error("REAL_BUDGET_WINDOW_NOT_READY");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const member = await actor("operator");
    for (let i = 0; i < 5; i++)
      await accountCall(
        db,
        "account_password",
        "reserve-change",
        digestToken(member.c.sessionToken!, "session"),
        { operationId: op(), attemptId: op() },
        true,
      );
    await expect(
      accountCall(
        db,
        "account_password",
        "reserve-change",
        digestToken(member.c.sessionToken!, "session"),
        { operationId: op(), attemptId: op() },
        true,
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    for (let i = 0; i < 10; i++) await signIn("synthetic-" + member.id);
    const pre = await createPreauth(db, null, op());
    await expect(
      passwordLogin(
        db,
        pre.raw,
        pre.dto.csrfToken,
        "synthetic-" + member.id,
        password,
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    const [r] =
      await owner.sql`SELECT sum(cost)::int n FROM qf.operator_kdf_attempt WHERE created_at>clock_timestamp()-interval '60 seconds'`;
    expect(r!.n).toBe(20);
  }, 90000);
});
