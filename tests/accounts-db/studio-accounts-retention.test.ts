import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, it, expect } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import {
  accountCall,
  issuePasswordToken,
  setupResult,
  inspectPasswordSetup,
} from "@/lib/auth/accounts/service";
import { createPreauth } from "@/lib/auth/service";
import { digestToken } from "@/lib/security/p2a-tokens";
let owner: Awaited<ReturnType<typeof openManagedDatabase>>, db: P2aDatabase;
beforeAll(async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test") throw Error("OWNED_TEST_DATABASE_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  db = await createDatabase(config);
});
afterAll(async () => {
  await db?.close();
  await owner?.close();
});
it("expires bearer result access at issuance plus 24 hours even when consume/revoke is late; strict inspection never revives a consumed token", async () => {
  const target = randomUUID();
  await owner.sql`INSERT INTO qf.operator(id,label,role,status) VALUES(${target},${"synthetic-window-" + target},'operator','active')`;
  for (const hours of [23, 26]) {
    const token = issuePasswordToken(),
      operationId = randomUUID(),
      issuance = randomUUID();
    await owner.sql`WITH t AS(SELECT clock_timestamp() AS moment) INSERT INTO qf.operator_password_token(id,operator_id,purpose,token_digest,operation_id,issued_at,expires_at,consumed_at,revoked_at) SELECT ${token.id},${target},'setup',${token.digest},${issuance},moment-${hours}*interval '1 hour',moment-${hours}*interval '1 hour'+interval '30 minutes',moment,moment FROM t`;
    await owner.sql`SELECT qf.account_record(${operationId}::uuid,NULL,${target}::uuid,'password-setup',jsonb_build_object('targetId',${target}::text),${token.id}::uuid)`;
    expect((await setupResult(db, token.digest, operationId)).status).toBe(
      hours === 23 ? "found" : "unknown",
    );
    await expect(inspectPasswordSetup(db, token.digest)).rejects.toMatchObject({
      code: "PASSWORD_TOKEN_INVALID",
    });
    expect((await setupResult(db, token.digest, randomUUID())).status).toBe(
      "unknown",
    );
  }
});
it("bounds expired-ledger cleanup and preserves active/24-hour unknown attempts plus every durable receipt even on rate rejection", async () => {
  const pre = await createPreauth(db, null, randomUUID()),
    digest = digestToken(pre.raw, "preauth"),
    seed = randomUUID();
  const [session] =
    await owner.sql`SELECT id FROM qf.operator_session WHERE token_digest=${digest}`;
  const current =
    await owner.sql`SELECT id FROM qf.operator_kdf_attempt WHERE expires_at>clock_timestamp()-interval '24 hours'`;
  const [receipts] =
    await owner.sql`SELECT count(*)::int n FROM qf.operator_account_operation`;
  const [oldBefore] =
    await owner.sql`SELECT count(*)::int n FROM qf.operator_kdf_attempt WHERE expires_at<clock_timestamp()-interval '24 hours'`;
  await owner.sql`WITH t AS(SELECT clock_timestamp()-interval '25 hours' AS moment) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,session_id,created_at,expires_at) SELECT md5(${seed}||g::text)::uuid,1,'login',${session!.id},moment,moment+interval '30 seconds' FROM t,generate_series(1,260) g`;
  const protectedId = randomUUID();
  await owner.sql`WITH t AS(SELECT clock_timestamp()-interval '23 hours' AS moment) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,session_id,created_at,expires_at) SELECT ${protectedId},1,'login',${session!.id},moment,moment+interval '30 seconds' FROM t`;
  // Add owned synthetic current reservations; never erase or age previous unknown attempts to manipulate the budget.
  await owner.sql`WITH t AS(SELECT clock_timestamp() AS moment) INSERT INTO qf.operator_kdf_attempt(id,cost,kind,session_id,created_at,expires_at) SELECT md5(${seed}||'current'||g::text)::uuid,1,'login',${session!.id},moment,moment+interval '30 seconds' FROM t,generate_series(1,20) g`;
  await expect(
    accountCall(
      db,
      "account_password",
      "reserve-login",
      digest,
      { attemptId: randomUUID(), loginName: "absent" },
      true,
    ),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  const [remaining] =
    await owner.sql`SELECT count(*)::int n FROM qf.operator_kdf_attempt WHERE expires_at<clock_timestamp()-interval '24 hours'`;
  expect(remaining!.n).toBe(oldBefore!.n + 132);
  const after =
    await owner.sql`SELECT id FROM qf.operator_kdf_attempt WHERE expires_at>clock_timestamp()-interval '24 hours'`;
  const ids = new Set(after.map((r) => r.id));
  expect(ids.has(protectedId)).toBe(true);
  expect(current.every((r) => ids.has(r.id))).toBe(true);
  const [finalReceipts] =
    await owner.sql`SELECT count(*)::int n FROM qf.operator_account_operation`;
  expect(finalReceipts!.n).toBe(receipts!.n);
});
