import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import {
  issueToken,
  csrfForToken,
  digestToken,
} from "@/lib/security/p2a-tokens";
import {
  accountCall,
  mutateAccount,
  issuePasswordToken,
  completePasswordSetup,
  changeOwnPassword,
  setupResult,
} from "@/lib/auth/accounts/service";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";
import { createPreauth, readSession } from "@/lib/auth/service";
let owner: Awaited<ReturnType<typeof openManagedDatabase>>,
  db: P2aDatabase,
  fixtureHash: string;
const password = "synthetic authority passphrase 2026";
const op = () => randomUUID();
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  db = await createDatabase(config);
  fixtureHash = await withPasswordCapacity((k) => k.hash(password));
});
afterAll(async () => {
  await db?.close();
  await owner?.close();
});
async function actor(role: "admin" | "operator" | "read-only" = "admin") {
  const id = op(),
    token = issueToken("session");
  await owner.sql`INSERT INTO qf.operator(id,label,login_name,display_name,password_hash,role,status) VALUES(${id},${"synthetic-" + id},${"synthetic-" + id},'合成身份',${fixtureHash},${role},'active')`;
  await owner.sql`WITH t AS(SELECT clock_timestamp() AS moment) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${op()},${token.digest},'authenticated',${id},moment,moment,moment+interval '30 minutes',moment+interval '8 hours' FROM t`;
  return {
    id,
    c: {
      sessionToken: token.raw,
      csrfToken: csrfForToken(token.raw, "session"),
      requestId: op(),
    },
  };
}
async function pending() {
  const id = op(),
    token = issuePasswordToken();
  await owner.sql`INSERT INTO qf.operator(id,label,login_name,display_name,role,status) VALUES(${id},${"pending-" + id},${"pending-" + id},'合成待设密','operator','active')`;
  await owner.sql`SELECT qf.account_issue(${id}::uuid,'setup',${token.digest},${token.id}::uuid,NULL,${op()}::uuid)`;
  return { id, token };
}
async function waitUntil(check: () => Promise<boolean>, milliseconds = 1800) {
  const deadline = Date.now() + milliseconds;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw Error("BOUNDED_LOCK_OR_DEADLINE_NOT_OBSERVED");
    await new Promise((r) => setTimeout(r, 5));
  }
}
// Observe a real app-backend lock wait, then release only after its DB deadline.
async function acrossDeadline(
  lockSql: string,
  params: string[],
  start: () => Promise<unknown>,
  expired: () => Promise<boolean>,
  rollback = false,
) {
  let unlock!: () => void, ready!: () => void;
  let blockerPid = 0;
  const entered = new Promise<void>((r) => {
      ready = r;
    }),
    release = new Promise<void>((r) => {
      unlock = r;
    });
  const sentinel = new Error("SYNTHETIC_BLOCKER_ROLLBACK");
  const blocker = owner.sql
    .begin(async (tx) => {
      const [pid] = await tx`SELECT pg_backend_pid()::int pid`;
      blockerPid = pid!.pid as number;
      await tx.unsafe(lockSql, params);
      ready();
      await release;
      if (rollback) throw sentinel;
      return pid!.pid as number;
    })
    .catch((e) => {
      if (e !== sentinel) throw e;
      return 0;
    });
  await entered;
  const work = start().then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
  try {
    await waitUntil(async () => {
      const [r] =
        await db.sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename=${db.config.database.user} AND wait_event_type='Lock' AND ${blockerPid}=ANY(pg_blocking_pids(pid))) blocked`;
      return r!.blocked as boolean;
    });
    await waitUntil(expired);
  } finally {
    unlock();
    await blocker;
    await work;
  }
  return work;
}
it("owner CLI reconciles the original bootstrap/recovery receipt and token binding without a web session or any writes", async () => {
  const [pristine] = await owner.sql`SELECT count(*)::int n FROM qf.operator`;
  if (pristine!.n !== 0) throw Error("PRISTINE_ACCOUNT_FIXTURE_REQUIRED");
  const execute = promisify(execFile),
    target = op(),
    operationId = op(),
    folder = path.dirname(process.env.QUIZFORGE_P2A_CONFIG!),
    file = path.join(folder, "account-setup-" + operationId + ".json");
  const base = [
    "--conditions=react-server",
    "--import",
    "tsx",
    "scripts/studio-accounts.ts",
  ];
  // Deliberately discard the successful issuance response; reconcile only the original identifiers/file.
  await execute(process.execPath, [
    ...base,
    "bootstrap-admin",
    "--instance",
    db.config.instanceId,
    "--operator-id",
    target,
    "--operation-id",
    operationId,
    "--setup-file",
    file,
    "--login-name",
    "synthetic-owner",
    "--display-name",
    "合成恢复",
  ]);
  const inspect = async (action: string, id: string, setupFile: string) => {
    const { stdout } = await execute(process.execPath, [
      ...base,
      "inspect-operation",
      "--instance",
      db.config.instanceId,
      "--operation-id",
      id,
      "--operator-id",
      target,
      "--action",
      action,
      "--setup-file",
      setupFile,
    ]);
    return { value: JSON.parse(stdout), stdout };
  };
  const rawFile = JSON.parse(await readFile(file, "utf8")),
    raw = new URLSearchParams(new URL(rawFile.url).hash.slice(1)).get("token")!;
  const [before] =
    await owner.sql`SELECT (SELECT count(*)::int FROM qf.operator_account_operation) operations,(SELECT count(*)::int FROM qf.operator_password_token) tokens,(SELECT count(*)::int FROM qf.audit_event) audits`;
  const found = await inspect("bootstrap-admin", operationId, file);
  expect(found.value).toMatchObject({
    status: "found",
    binding: "matched",
    operation: {
      operationId,
      targetId: target,
      action: "bootstrap-admin",
      status: "completed",
    },
    passwordSetup: { state: "active" },
  });
  expect(found.stdout).not.toContain(raw);
  expect(found.stdout).not.toContain("$argon2");
  const fakeToken = issuePasswordToken(),
    badFile = path.join(folder, "account-setup-bad-" + op() + ".json");
  await writeFile(
    badFile,
    JSON.stringify({
      ...rawFile,
      url:
        db.config.origin +
        "/studio/set-password#token=" +
        fakeToken.raw +
        "&tokenId=" +
        fakeToken.id,
    }),
    { mode: 0o600, flag: "wx" },
  );
  expect(
    (await inspect("bootstrap-admin", operationId, badFile)).value,
  ).toMatchObject({ status: "binding-mismatch", binding: "database" });
  const missing = op(),
    missingFile = path.join(folder, "account-setup-" + missing + ".json");
  await writeFile(
    missingFile,
    JSON.stringify({ ...rawFile, operationId: missing }),
    { mode: 0o600, flag: "wx" },
  );
  expect(
    (await inspect("bootstrap-admin", missing, missingFile)).value,
  ).toMatchObject({ status: "unknown", operationId: missing });
  const [after] =
    await owner.sql`SELECT (SELECT count(*)::int FROM qf.operator_account_operation) operations,(SELECT count(*)::int FROM qf.operator_password_token) tokens,(SELECT count(*)::int FROM qf.audit_event) audits`;
  expect(after).toEqual(before);
  const digest = new URLSearchParams(new URL(rawFile.url).hash.slice(1)).get(
    "token",
  )!;
  const { passwordTokenDigest } = await import("@/lib/auth/accounts/service");
  await completePasswordSetup(db, passwordTokenDigest(digest), op(), password);
  const recovery = op(),
    recoveryFile = path.join(folder, "account-setup-" + recovery + ".json");
  await execute(process.execPath, [
    ...base,
    "recover-admin",
    "--instance",
    db.config.instanceId,
    "--operator-id",
    target,
    "--operation-id",
    recovery,
    "--setup-file",
    recoveryFile,
  ]);
  expect(
    (await inspect("admin-recovery", recovery, recoveryFile)).value,
  ).toMatchObject({
    status: "found",
    binding: "matched",
    operation: { operationId: recovery, action: "admin-recovery" },
    passwordSetup: { state: "active" },
  });
});
it("rejects management writes when idle or absolute session expiry is crossed while waiting for the target row", async () => {
  for (const kind of ["idle", "absolute"]) {
    const admin = await actor(),
      target = await actor("operator"),
      operationId = op();
    await owner.sql`WITH t AS(SELECT clock_timestamp()+interval '700 milliseconds' AS deadline) UPDATE qf.operator_session SET idle_expires_at=t.deadline,created_at=CASE WHEN ${kind}='absolute' THEN t.deadline-interval '8 hours' ELSE created_at END,absolute_expires_at=CASE WHEN ${kind}='absolute' THEN t.deadline ELSE absolute_expires_at END FROM t WHERE token_digest=${digestToken(admin.c.sessionToken, "session")}`;
    const result = await acrossDeadline(
      "SELECT id FROM qf.operator WHERE id=$1::uuid FOR UPDATE",
      [target.id],
      () =>
        mutateAccount(db, admin.c, {
          operationId,
          action: "display-name",
          targetId: target.id,
          expectedRevision: 1,
          displayName: "must not commit",
        }),
      async () => {
        const [r] =
          await owner.sql`SELECT idle_expires_at<=clock_timestamp() expired FROM qf.operator_session WHERE token_digest=${digestToken(admin.c.sessionToken, "session")}`;
        return r!.expired as boolean;
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    const [row] =
      await owner.sql`SELECT display_name,account_revision,(SELECT count(*)::int FROM qf.operator_account_operation WHERE operation_id=${operationId}) receipts FROM qf.operator WHERE id=${target.id}`;
    expect(row).toMatchObject({
      display_name: "合成身份",
      account_revision: 1,
      receipts: 0,
    });
  }
});
it("rolls back a management write if session expiry is crossed at the final audit/receipt insertion", async () => {
  const admin = await actor(),
    target = await actor("operator"),
    operationId = op(),
    pre = await createPreauth(db, null, op());
  const [session] =
    await owner.sql`SELECT id FROM qf.operator_session WHERE token_digest=${digestToken(pre.raw, "preauth")}`;
  await owner.sql`UPDATE qf.operator_session SET idle_expires_at=clock_timestamp()+interval '700 milliseconds' WHERE token_digest=${digestToken(admin.c.sessionToken, "session")}`;
  const result = await acrossDeadline(
    "INSERT INTO qf.audit_event(id,action,outcome,session_id,request_id) VALUES($1::uuid,'preauth_created','success',$2::uuid,$1::uuid)",
    [operationId, session!.id as string],
    () =>
      mutateAccount(db, admin.c, {
        operationId,
        action: "display-name",
        targetId: target.id,
        expectedRevision: 1,
        displayName: "must roll back",
      }),
    async () => {
      const [r] =
        await owner.sql`SELECT idle_expires_at<=clock_timestamp() expired FROM qf.operator_session WHERE token_digest=${digestToken(admin.c.sessionToken, "session")}`;
      return r!.expired as boolean;
    },
    true,
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "UNAUTHENTICATED" },
  });
  const [row] =
    await owner.sql`SELECT display_name,account_revision,(SELECT count(*)::int FROM qf.operator_account_operation WHERE operation_id=${operationId}) receipts FROM qf.operator WHERE id=${target.id}`;
  expect(row).toMatchObject({
    display_name: "合成身份",
    account_revision: 1,
    receipts: 0,
  });
});
it("rejects setup reservation when the bearer expires while waiting for its operator row", async () => {
  const p = await pending(),
    operationId = op(),
    attemptId = op();
  await owner.sql`WITH t AS(SELECT clock_timestamp()+interval '700 milliseconds' AS deadline) UPDATE qf.operator_password_token SET issued_at=t.deadline-interval '30 minutes',expires_at=t.deadline FROM t WHERE id=${p.token.id}`;
  const result = await acrossDeadline(
    "SELECT id FROM qf.operator WHERE id=$1::uuid FOR UPDATE",
    [p.id],
    () =>
      accountCall(
        db,
        "account_password",
        "reserve-setup",
        p.token.digest,
        { operationId, attemptId },
        true,
      ),
    async () => {
      const [r] =
        await owner.sql`SELECT expires_at<=clock_timestamp() expired FROM qf.operator_password_token WHERE id=${p.token.id}`;
      return r!.expired as boolean;
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "PASSWORD_TOKEN_INVALID" },
  });
  const [r] =
    await owner.sql`SELECT count(*)::int n FROM qf.operator_kdf_attempt WHERE id=${attemptId}`;
  expect(r!.n).toBe(0);
});
it("rejects completion and retains a bound receipt if a 30-second attempt expires while its row lock is awaited", async () => {
  const p = await pending(),
    operationId = op(),
    attemptId = op();
  // New synthetic reservation already near its policy deadline; do not alter/age any existing UNKNOWN attempt.
  await owner.sql`WITH t AS(SELECT clock_timestamp()+interval '700 milliseconds' AS deadline) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,operator_id,token_id,operation_id,account_revision,created_at,expires_at) SELECT ${attemptId},1,'setup',${p.id},${p.token.id},${operationId},1,t.deadline-interval '30 seconds',t.deadline FROM t`;
  await owner.sql`UPDATE qf.operator_password_token SET attempt_id=${attemptId} WHERE id=${p.token.id}`;
  const result = await acrossDeadline(
    "SELECT id FROM qf.operator_kdf_attempt WHERE id=$1::uuid FOR UPDATE",
    [attemptId],
    () =>
      accountCall(
        db,
        "account_password",
        "finish-setup",
        p.token.digest,
        { operationId, attemptId, passwordHash: fixtureHash },
        true,
      ),
    async () => {
      const [r] =
        await owner.sql`SELECT expires_at<=clock_timestamp() expired FROM qf.operator_kdf_attempt WHERE id=${attemptId}`;
      return r!.expired as boolean;
    },
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "PASSWORD_TOKEN_INVALID" },
  });
  expect(await setupResult(db, p.token.digest, operationId)).toMatchObject({
    status: "found",
    operation: { status: "rejected", errorCode: "PASSWORD_TOKEN_INVALID" },
  });
  const [r] =
    await owner.sql`SELECT o.password_hash IS NULL pending,o.account_revision,t.consumed_at IS NULL unconsumed FROM qf.operator o JOIN qf.operator_password_token t ON t.operator_id=o.id WHERE t.id=${p.token.id}`;
  expect(r).toMatchObject({
    pending: true,
    account_revision: 1,
    unconsumed: true,
  });
});
it("rolls back tentative password/revocation writes and keeps a rejection if the attempt expires at final audit insertion", async () => {
  const p = await pending(),
    operationId = op(),
    attemptId = op(),
    pre = await createPreauth(db, null, op());
  const [session] =
    await owner.sql`SELECT id FROM qf.operator_session WHERE token_digest=${digestToken(pre.raw, "preauth")}`;
  await owner.sql`WITH t AS(SELECT clock_timestamp()+interval '700 milliseconds' AS deadline) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,operator_id,token_id,operation_id,account_revision,created_at,expires_at) SELECT ${attemptId},1,'setup',${p.id},${p.token.id},${operationId},1,t.deadline-interval '30 seconds',t.deadline FROM t`;
  await owner.sql`UPDATE qf.operator_password_token SET attempt_id=${attemptId} WHERE id=${p.token.id}`;
  const result = await acrossDeadline(
    "INSERT INTO qf.audit_event(id,action,outcome,session_id,request_id) VALUES($1::uuid,'preauth_created','success',$2::uuid,$1::uuid)",
    [operationId, session!.id as string],
    () =>
      accountCall(
        db,
        "account_password",
        "finish-setup",
        p.token.digest,
        { operationId, attemptId, passwordHash: fixtureHash },
        true,
      ),
    async () => {
      const [r] =
        await owner.sql`SELECT expires_at<=clock_timestamp() expired FROM qf.operator_kdf_attempt WHERE id=${attemptId}`;
      return r!.expired as boolean;
    },
    true,
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "PASSWORD_TOKEN_INVALID" },
  });
  expect(await setupResult(db, p.token.digest, operationId)).toMatchObject({
    status: "found",
    operation: { status: "rejected", errorCode: "PASSWORD_TOKEN_INVALID" },
  });
  const [row] =
    await owner.sql`SELECT o.password_hash IS NULL pending,o.account_revision,t.consumed_at IS NULL unconsumed,t.revoked_at IS NULL unrevoked FROM qf.operator o JOIN qf.operator_password_token t ON t.operator_id=o.id WHERE t.id=${p.token.id}`;
  expect(row).toMatchObject({
    pending: true,
    account_revision: 1,
    unconsumed: true,
    unrevoked: true,
  });
});
it("commits intentional self revocation through its dedicated final state for role, disable, revoke and logout-all", async () => {
  for (const action of ["role", "disable", "revoke-sessions", "logout-all"]) {
    const a = await actor(action === "logout-all" ? "read-only" : "admin"),
      operationId = op();
    const result = await mutateAccount(db, a.c, {
      operationId,
      action,
      targetId: a.id,
      expectedRevision: 1,
      ...(action === "role" ? { role: "operator" } : {}),
    });
    expect(result.operation.status).toBe("completed");
    await expect(readSession(db, a.c.sessionToken)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  }
});
it("RATE_LIMITED from setup/change is a definite pre-change rejection; lost reservation acknowledgement remains UNKNOWN", async () => {
  const a = await actor("operator"),
    p = await pending(),
    pre = await createPreauth(db, null, op()),
    seed = op();
  const [session] =
    await owner.sql`SELECT id FROM qf.operator_session WHERE token_digest=${digestToken(pre.raw, "preauth")}`;
  await owner.sql`WITH t AS(SELECT clock_timestamp() AS moment) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,session_id,created_at,expires_at) SELECT md5(${seed}||g::text)::uuid,1,'login',${session!.id},moment,moment+interval '30 seconds' FROM t,generate_series(1,20) g`;
  const setup = op(),
    change = op();
  await expect(
    completePasswordSetup(db, p.token.digest, setup, password),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  await expect(
    changeOwnPassword(
      db,
      a.c,
      change,
      password,
      "synthetic next authority phrase 2026",
    ),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
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
    completePasswordSetup(faulty, p.token.digest, op(), password),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  const [r] =
    await owner.sql`SELECT (SELECT count(*)::int FROM qf.operator_account_operation WHERE operation_id IN(${setup},${change})) receipts,(SELECT password_hash IS NULL FROM qf.operator WHERE id=${p.id}) pending,(SELECT account_revision FROM qf.operator WHERE id=${a.id}) revision`;
  expect(r).toMatchObject({ receipts: 0, pending: true, revision: 1 });
  expect((await readSession(db, a.c.sessionToken)).id).toBe(a.id);
});
