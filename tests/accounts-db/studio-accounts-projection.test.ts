import { randomUUID } from "node:crypto";
import { afterAll, it, expect } from "vitest";
import { openManagedDatabase } from "@/lib/db/management";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { handleAccounts } from "@/lib/auth/accounts/http";
import { withPasswordCapacity } from "@/lib/auth/accounts/password";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import { passwordSetupCsrf } from "@/features/studio/accounts/password-token";
import type {
  AccountMutationDto,
  AccountOperationDto,
  AccountOperationResultDto,
  PasswordSetupInspectionDto,
} from "@/features/studio/accounts/contracts";
import {
  inspectLocalAccountOperation,
  prepareLocalAccount,
} from "@/lib/auth/accounts/management";
import { readFile } from "node:fs/promises";
import path from "node:path";
let owner: Awaited<ReturnType<typeof openManagedDatabase>> | undefined;
afterAll(async () => {
  await owner?.close();
});
function iso(value: unknown) {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") throw Error("ISO_STRING_REQUIRED");
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isFinite(Date.parse(value))).toBe(true);
  expect(new Date(value).toISOString()).toBe(value);
  return Date.parse(value);
}
it("returns bound ISO-millisecond account/link/inspection/setup/result DTOs while preserving the original microsecond token expiry", async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  owner = await openManagedDatabase(config.instanceId);
  const id = randomUUID(),
    session = issueToken("session"),
    password = "synthetic datetime projection 2026",
    hash = await withPasswordCapacity((k) => k.hash(password));
  await owner.sql`INSERT INTO qf.operator(id,label,login_name,display_name,password_hash,role,status) VALUES(${id},${"projection-" + id},${"projection-" + id},'合成时间管理员',${hash},'admin','active')`;
  await owner.sql`WITH t AS(SELECT clock_timestamp() AS moment) INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) SELECT ${randomUUID()},${session.digest},'authenticated',${id},moment,moment,moment+interval '30 minutes',moment+interval '8 hours' FROM t`;
  const post = (
    endpoint: Parameters<typeof handleAccounts>[1],
    body: unknown,
    csrf: string,
    cookie = "",
  ) =>
    handleAccounts(
      new Request(config.origin + "/api/studio/accounts/test", {
        method: "POST",
        headers: {
          host: new URL(config.origin).host,
          origin: config.origin,
          "content-type": "application/json",
          "x-csrf-token": csrf,
          cookie,
        },
        body: JSON.stringify(body),
      }),
      endpoint,
    );
  const operationId = randomUUID(),
    before = Date.now();
  const response = await post(
    "create",
    {
      operationId,
      loginName: "projection-" + operationId,
      displayName: "合成新账号",
      role: "operator",
    },
    csrfForToken(session.raw, "session")!,
    SESSION_COOKIE + "=" + session.raw,
  );
  expect(response.status).toBe(200);
  const created = (await response.json()) as AccountMutationDto;
  expect(created.account).toMatchObject({ id: operationId, status: "pending" });
  expect(created.operation).toMatchObject({
    operationId,
    targetId: created.account.id,
    actorId: id,
    action: "create",
    status: "completed",
  });
  expect(iso(created.account.createdAt)).toBeGreaterThanOrEqual(before - 1000);
  expect(iso(created.operation.createdAt)).toBeGreaterThanOrEqual(
    before - 1000,
  );
  const expires = iso(created.passwordSetup!.expiresAt);
  expect(expires).toBeGreaterThan(before + 29 * 60 * 1000);
  expect(expires).toBeLessThan(Date.now() + 31 * 60 * 1000);
  const tokenId = created.passwordSetup!.tokenId,
    raw = new URLSearchParams(
      new URL(created.passwordSetup!.url).hash.slice(1),
    ).get("token")!,
    csrf = (await passwordSetupCsrf(raw))!;
  const [original] =
    await owner.sql`SELECT expires_at::text original,qf.consumer_moment(date_trunc('milliseconds',expires_at)) projected FROM qf.operator_password_token WHERE id=${tokenId}`;
  expect(created.passwordSetup!.expiresAt).toBe(original!.projected);
  const inspection = await post("setup-inspect", { token: raw }, csrf);
  expect(inspection.status).toBe(200);
  const inspected = (await inspection.json()) as PasswordSetupInspectionDto;
  expect(inspected).toMatchObject({
    tokenId,
    purpose: "setup",
    expiresAt: created.passwordSetup!.expiresAt,
  });
  iso(inspected.expiresAt);
  const setupId = randomUUID(),
    setup = await post(
      "setup",
      { token: raw, operationId: setupId, password },
      csrf,
    );
  expect(setup.status).toBe(200);
  const completed = (await setup.json()) as AccountOperationDto;
  expect(completed).toMatchObject({
    operationId: setupId,
    targetId: created.account.id,
    action: "password-setup",
    status: "completed",
  });
  iso(completed.createdAt);
  const result = await post(
    "setup-result",
    { token: raw, operationId: setupId },
    csrf,
  );
  expect(result.status).toBe(200);
  const receipt = (await result.json()) as AccountOperationResultDto;
  expect(receipt).toMatchObject({ status: "found", operation: completed });
  const [after] =
    await owner.sql`SELECT expires_at::text original FROM qf.operator_password_token WHERE id=${tokenId}`;
  expect(after!.original).toBe(original!.original);
  // Canonical projection fixes precision only; the strict consumer formatter still rejects microseconds.
  const [strict] =
    await owner.sql`SELECT qf.consumer_moment('2026-10-25 12:00:00.123456+00'::timestamptz) IS NULL rejected`;
  expect(strict!.rejected).toBe(true);
});
it("owner reconciliation returns an ISO expiry for a preserved original issuance", async () => {
  const config = await loadRuntimeConfig();
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw Error("OWNED_TEST_DATABASE_REQUIRED");
  const folder = path.dirname(process.env.QUIZFORGE_P2A_CONFIG!);
  if (!owner) owner = await openManagedDatabase(config.instanceId);
  const targetId = randomUUID(),
    operationId = randomUUID(),
    hash = await withPasswordCapacity((k) =>
      k.hash("synthetic owner projection 2026"),
    );
  await owner.sql`INSERT INTO qf.operator(id,label,login_name,display_name,password_hash,role,status) VALUES(${targetId},${"projection-owner-" + targetId},${"projection-owner-" + targetId},'合成核实管理员',${hash},'admin','active')`;
  const file = path.join(folder, "account-setup-" + operationId + ".json");
  await prepareLocalAccount(config.instanceId, "admin-recovery", {
    operatorId: targetId,
    operationId,
    setupFile: file,
  });
  const evidence = JSON.parse(await readFile(file, "utf8"));
  const result = await inspectLocalAccountOperation(
    config.instanceId,
    "admin-recovery",
    {
      operatorId: targetId,
      operationId,
      setupFile: file,
    },
  );
  expect(result.status).toBe("found");
  if (result.status !== "found") throw Error("ORIGINAL_RECEIPT_REQUIRED");
  iso(result.passwordSetup.expiresAt);
  expect(JSON.stringify(result)).not.toContain(
    new URLSearchParams(new URL(evidence.url).hash.slice(1)).get("token")!,
  );
});
