import { randomUUID } from "node:crypto";
import type { TestDatabase } from "./p2a-fixture";
import { createPreauth } from "@/lib/auth/service";
import { passwordLogin } from "@/lib/auth/accounts/service";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";
import { digestToken } from "@/lib/security/p2a-tokens";

export type FixtureAccount = { identifier: string; secret: string };
export type FixtureAccountRow = {
  id: string;
  login_name: string;
  display_name: string;
  password_hash: string | null;
  role: string;
};
function requireOwnedTest(db: TestDatabase) {
  if (db.config.purpose !== "test" && db.config.purpose !== "ci")
    throw Error("OWNED_VERSION_ACCOUNT_FIXTURE_REQUIRED");
}
/** Private version/consumer fixtures use current password accounts, never legacy admin login. */
export async function seedVersionFixtureAccount(
  db: TestDatabase,
  actor: FixtureAccount,
  displayName: string,
  role: "admin" | "operator" | "read-only",
  loginName = `test-${actor.identifier}`,
) {
  requireOwnedTest(db);
  const hash = await withPasswordCapacity((k) => k.hash(actor.secret));
  await db.admin
    .sql`INSERT INTO qf.operator(id,login_name,display_name,password_hash,role,status)
    VALUES(${actor.identifier},${loginName},${displayName},${hash},${role},'active')`;
}
/** Cleanup needs both exact fixture identity and its private password, never just a UUID. */
export async function fixtureAccountMatches(
  row: FixtureAccountRow,
  actor: FixtureAccount,
  displayName: string,
  role: string,
) {
  if (
    row.id !== actor.identifier ||
    row.login_name !== `test-${actor.identifier}` ||
    row.display_name !== displayName ||
    row.role !== role ||
    !row.password_hash
  )
    return false;
  return withPasswordCapacity((k) =>
    k.verify(actor.secret, row.password_hash!),
  );
}
export async function loginVersionFixtureAccount(
  db: TestDatabase,
  actor: FixtureAccount,
) {
  requireOwnedTest(db);
  const pre = await createPreauth(db.app, null, randomUUID());
  const [challenge] = await db.admin.sql<{ id: string }[]>`
    SELECT id FROM qf.operator_session WHERE token_digest=${digestToken(pre.raw, "preauth")} AND kind='preauth'`;
  if (!challenge) throw Error("VERSION_FIXTURE_PREAUTH_MISSING");
  const session = await passwordLogin(
    db.app,
    pre.raw,
    pre.dto.csrfToken,
    `test-${actor.identifier}`,
    actor.secret,
  );
  if (session.dto.operator.id !== actor.identifier)
    throw Error("VERSION_FIXTURE_LOGIN_IDENTITY_MISMATCH");
  // These business fixtures own this one newly created preauth only. Account-budget
  // tests run separately and retain their attempts. Any uncertain login leaves evidence.
  await db.admin.sql.begin(async (tx) => {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM qf.operator_kdf_attempt
      WHERE session_id=${challenge.id} AND operator_id=${actor.identifier}
        AND kind='login' AND finished_at IS NOT NULL AND token_id IS NULL AND operation_id IS NULL
      FOR UPDATE`;
    if (rows.length !== 1)
      throw Error("VERSION_FIXTURE_COMPLETED_LOGIN_REQUIRED");
    await tx`DELETE FROM qf.operator_kdf_attempt WHERE id=${rows[0]!.id}
      AND session_id=${challenge.id} AND operator_id=${actor.identifier} AND kind='login'
      AND finished_at IS NOT NULL AND token_id IS NULL AND operation_id IS NULL`;
  });
  return session;
}
