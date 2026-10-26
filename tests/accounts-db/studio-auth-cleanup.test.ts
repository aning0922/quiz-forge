import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { createPreauth, readSession } from "@/lib/auth/service";
import { withStudioWrite } from "@/lib/auth/write";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import {
  accountCall,
  issuePasswordToken,
  inspectPasswordSetup,
  completePasswordSetup,
} from "@/lib/auth/accounts/service";
import {
  executeLocalAccountOperation,
  inspectLocalAccountOperation,
  type LocalAccountBinding,
} from "@/lib/auth/accounts/management";
import { localAccountReceiptSchema } from "@/lib/auth/accounts/local-contracts";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";

let owner: Awaited<ReturnType<typeof openManagedDatabase>>,
  db: P2aDatabase,
  fixtureHash: string,
  folder: string;
const op = () => randomUUID();
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  db = await createDatabase(config);
  folder = path.dirname(process.env.QUIZFORGE_P2A_CONFIG!);
  fixtureHash = await withPasswordCapacity((k) =>
    k.hash("synthetic cleanup passphrase 2026"),
  );
});
afterAll(async () => {
  await db?.close();
  await owner?.close();
});
async function actor(role: "admin" | "operator" = "operator", pending = false) {
  const id = op(),
    session = issueToken("session");
  await owner.sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status)
    VALUES(${id},${"synthetic-" + id},'合成清理账号',${pending ? null : fixtureHash},${role},'active')`;
  await owner.sql`WITH t AS(SELECT clock_timestamp() at)
    INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at)
    SELECT ${op()},${session.digest},'authenticated',${id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM t`;
  return {
    id,
    session,
    credentials: {
      sessionToken: session.raw,
      csrfToken: csrfForToken(session.raw, "session"),
      requestId: op(),
    },
  };
}
const operationFile = (id: string) =>
  path.join(folder, `account-operation-${id}.json`);
const local = async (binding: LocalAccountBinding) => {
  const value = await accountCall<{ receipt: unknown; first: boolean }>(
    owner as unknown as P2aDatabase,
    "account_local",
    "",
    null,
    binding,
    true,
  );
  return { ...value, receipt: localAccountReceiptSchema.parse(value.receipt) };
};
async function revision(id: string) {
  const [row] =
    await owner.sql`SELECT account_revision FROM qf.operator WHERE id=${id}`;
  return row!.account_revision as number;
}

it("denies a complete pending identity's old session at all current auth surfaces without app PHC access", async () => {
  const pending = await actor("admin", true);
  await expect(readSession(db, pending.session.raw)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  let reached = false;
  await expect(
    withStudioWrite(db, pending.credentials, "workspace:write", async () => {
      reached = true;
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(reached).toBe(false);
  await expect(
    accountCall(db, "account_command", "me", pending.session.digest, {}),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  await expect(
    accountCall(
      db,
      "account_directory_read",
      "list",
      pending.session.digest,
      {},
    ),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  const [eligible] =
    await db.sql`SELECT (qf.account_actor(${pending.session.digest})).id id`;
  expect(eligible!.id).toBeNull();
  await expect(
    db.sql`SELECT password_hash FROM qf.operator WHERE id=${pending.id}`,
  ).rejects.toMatchObject({ code: "42501" });
  const [acl] =
    await db.sql`SELECT has_function_privilege(current_user,'qf.account_local(jsonb)','EXECUTE') local,
    (SELECT prosecdef AND proconfig=ARRAY['search_path=pg_catalog'] FROM pg_proc WHERE oid='qf.account_actor(text)'::regprocedure) narrow,
    NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='qf.account_actor(text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') private`;
  expect(acl).toEqual({ local: false, narrow: true, private: true });
  // Preauth is allowed, but it cannot turn this pending session into an authenticated Actor.
  expect(
    (await createPreauth(db, pending.session.raw, op())).dto.csrfToken,
  ).toBeTruthy();
});

it("persists changed/noop receipts, checks original binding before CAS, and never revives session or bearer on restore", async () => {
  const member = await actor();
  const token = issuePasswordToken();
  await owner.sql`SELECT qf.account_issue(${member.id}::uuid,'reset',${token.digest},${token.id}::uuid,NULL,${op()}::uuid)`;
  const disable = {
    operationId: op(),
    targetId: member.id,
    action: "disable" as const,
    expectedRevision: 1,
  };
  const firstFile = operationFile(disable.operationId);
  const first = await executeLocalAccountOperation(
    db.config.instanceId,
    disable,
    firstFile,
  );
  expect(first.receipt.result).toEqual({
    changed: true,
    previousRevision: 1,
    resultingRevision: 2,
    resultingStatus: "disabled",
  });
  const noop = { ...disable, operationId: op(), expectedRevision: 2 };
  const noChange = await executeLocalAccountOperation(
    db.config.instanceId,
    noop,
    operationFile(noop.operationId),
  );
  expect(noChange.receipt.result).toEqual({
    changed: false,
    previousRevision: 2,
    resultingRevision: 2,
    resultingStatus: "disabled",
  });
  const restore = {
    operationId: op(),
    targetId: member.id,
    action: "restore" as const,
    expectedRevision: 2,
  };
  expect(
    (
      await executeLocalAccountOperation(
        db.config.instanceId,
        restore,
        operationFile(restore.operationId),
      )
    ).receipt.result,
  ).toEqual({
    changed: true,
    previousRevision: 2,
    resultingRevision: 3,
    resultingStatus: "active",
  });
  expect((await local(disable)).receipt).toEqual(first.receipt);
  expect((await local(noop)).receipt).toEqual(noChange.receipt);
  expect(
    await inspectLocalAccountOperation(db.config.instanceId, firstFile),
  ).toEqual({ status: "found", receipt: first.receipt });
  await expect(
    local({ ...disable, expectedRevision: 3 }),
  ).rejects.toMatchObject({ code: "OPERATION_BINDING_CONFLICT" });
  const stale = await local({ ...disable, operationId: op() });
  expect(stale.receipt.operation).toMatchObject({
    status: "rejected",
    errorCode: "ACCOUNT_CONFLICT",
  });
  expect(stale.receipt.result).toEqual({
    changed: false,
    previousRevision: 3,
    resultingRevision: 3,
    resultingStatus: "active",
  });
  const originalBytes = await readFile(firstFile);
  await expect(
    executeLocalAccountOperation(db.config.instanceId, disable, firstFile),
  ).rejects.toThrow("ACCOUNT_OPERATION_ALREADY_RECORDED_INSPECT_ORIGINAL");
  expect(await readFile(firstFile)).toEqual(originalBytes);
  const [audit] =
    await owner.sql`SELECT count(*)::int n FROM qf.audit_event WHERE request_id IN(${disable.operationId},${noop.operationId},${restore.operationId})`;
  expect(audit!.n).toBe(3);
  await expect(readSession(db, member.session.raw)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
  await expect(inspectPasswordSetup(db, token.digest)).rejects.toMatchObject({
    code: "PASSWORD_TOKEN_INVALID",
  });
  const pending = await actor("operator", true);
  await local({
    action: "disable",
    targetId: pending.id,
    expectedRevision: 1,
    operationId: op(),
  });
  const restored = await local({
    action: "restore",
    targetId: pending.id,
    expectedRevision: 2,
    operationId: op(),
  });
  expect(restored.receipt.result.resultingStatus).toBe("pending");
  await expect(readSession(db, pending.session.raw)).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

it("retains an UNKNOWN noop's original file and receipt after injected lost commit acknowledgement; inspection never writes", async () => {
  const member = await actor(),
    binding = {
      action: "restore" as const,
      operationId: op(),
      targetId: member.id,
      expectedRevision: 1,
    };
  const file = operationFile(binding.operationId);
  await writeFile(
    file,
    JSON.stringify({
      schemaVersion: "quizforge.local-account-operation.v1",
      instanceId: db.config.instanceId,
      binding,
    }),
    { mode: 0o600, flag: "wx" },
  );
  const original = await readFile(file);
  const faulty = {
    ...owner,
    sql: new Proxy(owner.sql, {
      get(target, key, receiver) {
        if (key === "begin")
          return async (work: (tx: unknown) => Promise<unknown>) => {
            await target.begin(async (tx) => work(tx));
            throw Object.assign(Error("synthetic lost acknowledgement"), {
              code: "ECONNRESET",
            });
          };
        return Reflect.get(target, key, receiver);
      },
    }),
  } as unknown as P2aDatabase;
  await expect(
    accountCall(faulty, "account_local", "", null, binding, true),
  ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  const [before] =
    await owner.sql`SELECT (SELECT count(*)::int FROM qf.operator_account_operation) operations,(SELECT count(*)::int FROM qf.audit_event) audits`;
  const evidence = await inspectLocalAccountOperation(
    db.config.instanceId,
    file,
  );
  expect(evidence).toMatchObject({
    status: "found",
    receipt: {
      operation: { operationId: binding.operationId, status: "completed" },
      result: { changed: false, previousRevision: 1, resultingRevision: 1 },
    },
  });
  expect(await readFile(file)).toEqual(original);
  const missing = { ...binding, operationId: op() },
    missingFile = operationFile(missing.operationId);
  await writeFile(
    missingFile,
    JSON.stringify({
      schemaVersion: "quizforge.local-account-operation.v1",
      instanceId: db.config.instanceId,
      binding: missing,
    }),
    { mode: 0o600, flag: "wx" },
  );
  expect(
    await inspectLocalAccountOperation(db.config.instanceId, missingFile),
  ).toEqual({ status: "unknown", operationId: missing.operationId });
  const mismatch = { ...binding, expectedRevision: 2 },
    mismatchFile = operationFile(op());
  await writeFile(
    mismatchFile,
    JSON.stringify({
      schemaVersion: "quizforge.local-account-operation.v1",
      instanceId: db.config.instanceId,
      binding: mismatch,
    }),
    { mode: 0o600, flag: "wx" },
  );
  expect(
    await inspectLocalAccountOperation(db.config.instanceId, mismatchFile),
  ).toEqual({ status: "binding-mismatch", binding: "database" });
  const [after] =
    await owner.sql`SELECT (SELECT count(*)::int FROM qf.operator_account_operation) operations,(SELECT count(*)::int FROM qf.audit_event) audits`;
  expect(after).toEqual(before);
});

it("protects the last password-ready admin during concurrent local disable and binds recovery to exact CAS/token", async () => {
  // This suite may follow the existing accounts suite, whose final invariant is one valid admin.
  const rows =
    await owner.sql`SELECT id FROM qf.operator WHERE role='admin' AND status='active' AND password_hash IS NOT NULL`;
  const firstAdmin =
    rows.length === 0 ? (await actor("admin")).id : (rows[0]!.id as string);
  if (rows.length > 1) throw Error("ISOLATED_SINGLE_EFFECTIVE_ADMIN_REQUIRED");
  await actor("admin", true); // a pending admin never satisfies the survivor check.
  const blocked = await local({
    action: "disable",
    operationId: op(),
    targetId: firstAdmin,
    expectedRevision: await revision(firstAdmin),
  });
  expect(blocked.receipt.operation).toMatchObject({
    status: "rejected",
    errorCode: "LAST_ACTIVE_ADMIN",
  });
  const nonAdmin = await actor();
  const rejected = await executeLocalAccountOperation(
    db.config.instanceId,
    {
      action: "admin-recovery",
      operationId: op(),
      targetId: nonAdmin.id,
      expectedRevision: 1,
    },
    operationFile(op()),
  );
  expect(rejected.receipt.operation).toMatchObject({
    status: "rejected",
    errorCode: "ACCOUNT_CONFLICT",
  });
  expect(rejected.receipt.result.changed).toBe(false);
  expect(
    await inspectLocalAccountOperation(
      db.config.instanceId,
      rejected.operationFile,
    ),
  ).toEqual({ status: "found", receipt: rejected.receipt });
  const other = await actor("admin");
  const outcomes = await Promise.all(
    [firstAdmin, other.id].map(async (targetId) =>
      local({
        action: "disable",
        operationId: op(),
        targetId,
        expectedRevision: await revision(targetId),
      }),
    ),
  );
  expect(
    outcomes.filter((r) => r.receipt.operation.status === "completed"),
  ).toHaveLength(1);
  expect(
    outcomes.filter(
      (r) => r.receipt.operation.errorCode === "LAST_ACTIVE_ADMIN",
    ),
  ).toHaveLength(1);
  const [survivor] =
    await owner.sql`SELECT id,account_revision FROM qf.operator WHERE role='admin' AND status='active' AND password_hash IS NOT NULL`;
  const binding = {
    action: "admin-recovery" as const,
    operationId: op(),
    targetId: survivor!.id as string,
    expectedRevision: survivor!.account_revision as number,
  };
  const file = operationFile(binding.operationId);
  const issued = await executeLocalAccountOperation(
    db.config.instanceId,
    binding,
    file,
  );
  expect(issued.receipt.result.changed).toBe(true);
  expect(
    await inspectLocalAccountOperation(db.config.instanceId, file),
  ).toMatchObject({
    status: "found",
    receipt: issued.receipt,
    passwordSetup: { state: "active", purpose: "admin-recovery" },
  });
  const original = JSON.parse(await readFile(file, "utf8"));
  const request = {
    ...binding,
    tokenId: original.passwordSetup.tokenId,
    tokenDigest: original.passwordSetup.tokenDigest,
  };
  const repeated = await accountCall<{ receipt: unknown }>(
    owner as unknown as P2aDatabase,
    "account_local",
    "",
    null,
    request,
    true,
  );
  expect(localAccountReceiptSchema.parse(repeated.receipt)).toEqual(
    issued.receipt,
  );
  await expect(
    accountCall(
      owner as unknown as P2aDatabase,
      "account_local",
      "",
      null,
      { ...request, tokenId: op() },
      true,
    ),
  ).rejects.toMatchObject({ code: "OPERATION_BINDING_CONFLICT" });
  await completePasswordSetup(
    db,
    original.passwordSetup.tokenDigest,
    op(),
    "synthetic recovered cleanup passphrase 2026",
  );
  expect(
    await inspectLocalAccountOperation(db.config.instanceId, file),
  ).toMatchObject({
    status: "found",
    receipt: issued.receipt,
    passwordSetup: { state: "consumed" },
  });
});
