import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";
import { issueToken } from "@/lib/security/p2a-tokens";
import { listAccounts, readAccountAudit } from "@/lib/auth/accounts/service";
import { handleAccounts } from "@/lib/auth/accounts/http";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

let owner: Awaited<ReturnType<typeof openManagedDatabase>>, db: P2aDatabase;
const root = issueToken("session"),
  operator = issueToken("session"),
  reader = issueToken("session");
const people = [
  {
    id: randomUUID(),
    login: "directory.admin",
    name: "目录管理员（合成）",
    role: "admin",
    status: "active",
  },
  {
    id: randomUUID(),
    login: "directory.pending-admin",
    name: "待设置管理员（合成）",
    role: "admin",
    status: "pending",
  },
  {
    id: randomUUID(),
    login: "directory.operator",
    name: "计划100%运营",
    role: "operator",
    status: "active",
  },
  {
    id: randomUUID(),
    login: "directory.pending-operator",
    name: "待设置运营（合成）",
    role: "operator",
    status: "pending",
  },
  {
    id: randomUUID(),
    login: "directory.reader",
    name: "只读人员（合成）",
    role: "read-only",
    status: "active",
  },
  {
    id: randomUUID(),
    login: "audit.needle",
    name: "历史目标（合成）",
    role: "read-only",
    status: "disabled",
  },
] as const;
const syntheticPassword = "synthetic directory acceptance passphrase 2026";
async function session(id: string, token: ReturnType<typeof issueToken>) {
  await owner.sql`WITH t AS(SELECT clock_timestamp() at) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${randomUUID()},${token.digest},'authenticated',${id},at,at,at+interval '30 minutes',at+interval '8 hours' FROM t`;
}
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  const [count] = await owner.sql`SELECT count(*)::int n FROM qf.operator`;
  if (count?.n !== 0) throw Error("FRESH_ACCOUNT_DIRECTORY_FIXTURE_REQUIRED");
  const hash = await withPasswordCapacity((k) => k.hash(syntheticPassword));
  await owner.sql.begin(async (tx) => {
    for (const person of people)
      await tx`WITH moment AS(SELECT clock_timestamp() at) INSERT INTO qf.operator(id,label,login_name,display_name,role,status,password_hash,created_at,disabled_at) SELECT ${person.id},${"directory-" + person.id},${person.login},${person.name},${person.role},${person.status === "disabled" ? "disabled" : "active"},${person.status === "pending" ? null : hash},at,CASE WHEN ${person.status === "disabled"} THEN at ELSE NULL END FROM moment`;
  });
  await session(people[0].id, root);
  await session(people[2].id, operator);
  await session(people[4].id, reader);
  for (let i = 0; i < 28; i++)
    await owner.sql`INSERT INTO qf.operator_account_operation(operation_id,actor_id,target_id,action,binding,status,created_at) VALUES(${randomUUID()},${people[0].id},${i === 27 ? people[5].id : people[2].id},${i === 27 ? "disable" : "display-name"},'{}'::jsonb,'completed',clock_timestamp()-${String(i)}::integer*interval '1 second')`;
  db = await createDatabase(config);
});
afterAll(async () => {
  await db?.close();
  await owner?.close();
});

it("returns exact global status counts and server-wide role/status/name filtering with stable pages", async () => {
  const first = await listAccounts(db, root.raw, { offset: 0, limit: 2 });
  expect(first.summary).toEqual({
    total: 6,
    active: 3,
    pending: 2,
    disabled: 1,
  });
  expect(first.total).toBe(6);
  expect(first.hasMore).toBe(true);
  const second = await listAccounts(db, root.raw, { offset: 2, limit: 2 });
  const third = await listAccounts(db, root.raw, { offset: 4, limit: 2 });
  expect(
    [...first.items, ...second.items, ...third.items].map((x) => x.id),
  ).toEqual(people.map((x) => x.id).sort());
  expect(third.hasMore).toBe(false);
  const filtered = await listAccounts(db, root.raw, {
    q: "DIRECTORY",
    role: "admin",
    status: "pending",
    offset: 0,
    limit: 25,
  });
  expect(filtered.items.map((x) => x.id)).toEqual([people[1].id]);
  expect(filtered.total).toBe(1);
  expect(filtered.summary).toEqual(first.summary);
  const literal = await listAccounts(db, root.raw, {
    q: "%",
    offset: 0,
    limit: 25,
  });
  expect(literal.items.map((x) => x.id)).toEqual([people[2].id]);
  const empty = await listAccounts(db, root.raw, {
    q: "no-such-synthetic-member",
    offset: 0,
    limit: 25,
  });
  expect(empty.items).toEqual([]);
  expect(empty.total).toBe(0);
  expect(empty.summary.total).toBe(6);
  expect(first.snapshotAt).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
  );
});
it("searches audits beyond the first page and returns only the existing safe DTO fields", async () => {
  const page = await readAccountAudit(db, root.raw, { offset: 0, limit: 25 });
  expect(page.items).toHaveLength(25);
  expect(page.hasMore).toBe(true);
  expect(page.total).toBe(28);
  const found = await readAccountAudit(db, root.raw, {
    q: "AUDIT.NEEDLE",
    action: "disable",
    offset: 0,
    limit: 25,
  });
  expect(found.items).toHaveLength(1);
  expect(found.total).toBe(1);
  expect(found.items[0]).toMatchObject({
    actorDisplayName: people[0].name,
    targetDisplayName: people[5].name,
    action: "disable",
  });
  expect(Object.keys(found.items[0]!).sort()).toEqual(
    [
      "operationId",
      "action",
      "actorId",
      "targetId",
      "status",
      "errorCode",
      "createdAt",
      "actorDisplayName",
      "targetDisplayName",
    ].sort(),
  );
  const list = await listAccounts(db, root.raw, { offset: 0, limit: 25 });
  expect(Object.keys(list.items[0]!).sort()).toEqual(
    [
      "id",
      "label",
      "loginName",
      "displayName",
      "role",
      "status",
      "revision",
      "createdAt",
      "disabledAt",
    ].sort(),
  );
  const [state] =
    await owner.sql`SELECT (SELECT count(*) FROM qf.operator_account_operation)::int operations,(SELECT count(*) FROM qf.operator_password_token)::int tokens,(SELECT sum(account_revision) FROM qf.operator)::int revisions`;
  expect(state).toMatchObject({ operations: 28, tokens: 0, revisions: 6 });
});
it("keeps both read projections admin-only and does not grant access to password or raw operation tables", async () => {
  for (const actor of [operator, reader])
    for (const read of [listAccounts, readAccountAudit])
      await expect(
        read(db, actor.raw, { offset: 0, limit: 25 }),
      ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  expect(() => listAccounts(db, null, { offset: 0, limit: 25 })).toThrow(
    "UNAUTHENTICATED",
  );
  await expect(
    db.sql`SELECT password_hash FROM qf.operator`,
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    db.sql`SELECT binding FROM qf.operator_account_operation`,
  ).rejects.toMatchObject({ code: "42501" });
  const [functionInfo] =
    await db.sql`SELECT p.prosecdef,p.proconfig,has_function_privilege(current_user,p.oid,'EXECUTE') executable,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_execute FROM pg_proc p WHERE p.oid='qf.account_directory_read(text,text,jsonb)'::regprocedure`;
  expect(functionInfo).toMatchObject({
    prosecdef: true,
    proconfig: ["search_path=pg_catalog"],
    executable: true,
    public_execute: false,
  });
});
it("rejects malformed and unbounded direct SQL inputs as well as duplicate or unsupported HTTP filters", async () => {
  for (const input of [
    null,
    [],
    { limit: null },
    { limit: 0 },
    { limit: 51 },
    { limit: 1.5 },
    { offset: null },
    { offset: 1000001 },
    { role: null },
    { role: "owner" },
    { status: "unknown" },
    { q: [] },
    { q: "\n" },
    { q: "x".repeat(81) },
    { extra: true },
  ])
    await expect(
      db.sql`SELECT qf.account_directory_read('list',${root.digest},${JSON.stringify(input)}::jsonb)`,
    ).rejects.toThrow("INVALID_REQUEST");
  await expect(
    db.sql`SELECT qf.account_directory_read(NULL,${root.digest},'{}'::jsonb)`,
  ).rejects.toThrow("INVALID_REQUEST");
  for (const suffix of [
    "?role=owner",
    "?role=admin&role=operator",
    "?limit=0",
    "?unknown=value",
  ]) {
    const r = await handleAccounts(
      new Request(db.config.origin + "/api/studio/accounts" + suffix, {
        headers: {
          host: new URL(db.config.origin).host,
          cookie: SESSION_COOKIE + "=" + root.raw,
        },
      }),
      "list",
    );
    expect(r.status).toBe(400);
  }
  const r = await handleAccounts(
    new Request(
      db.config.origin +
        "/api/studio/accounts/audit?q=audit.needle&action=disable",
      {
        headers: {
          host: new URL(db.config.origin).host,
          cookie: SESSION_COOKIE + "=" + root.raw,
        },
      },
    ),
    "audit",
  );
  expect(r.status).toBe(200);
  expect((await r.json()).total).toBe(1);
});
it("rechecks a session that expires while the read waits for the shared authorization lock", async () => {
  const waiting = issueToken("session");
  await session(people[0].id, waiting);
  let outcome: Promise<unknown> | undefined;
  await owner.sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(72461,1)`;
    await tx`UPDATE qf.operator_session SET idle_expires_at=clock_timestamp()+interval '200 milliseconds' WHERE token_digest=${waiting.digest}`;
    outcome = listAccounts(db, waiting.raw, { offset: 0, limit: 25 }).catch(
      (e) => e,
    );
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      const [row] =
        await tx`SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename=${db.config.database.user} AND l.locktype='advisory' AND NOT l.granted AND l.classid=72461 AND l.objid=1) waiting,(SELECT idle_expires_at<=clock_timestamp() FROM qf.operator_session WHERE token_digest=${waiting.digest}) expired`;
      if (row?.waiting && row?.expired) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw Error("EXPECTED_LOCK_WAIT_AND_EXPIRY_NOT_OBSERVED");
  });
  expect(await outcome).toMatchObject({ code: "UNAUTHENTICATED" });
});
