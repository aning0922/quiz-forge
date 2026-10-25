import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { P2aDatabase } from "@/lib/db/client";
import { StudioError, type StudioErrorCode } from "@/lib/http-security/errors";
import {
  isStudioConnectionFailure,
  type StudioWriteCredentials,
} from "@/lib/auth/write";
import { digestToken, issueToken, verifyCsrf } from "@/lib/security/p2a-tokens";
import {
  passwordTokenBytes,
  PASSWORD_TOKEN_PREFIX,
  passwordSetupCsrf,
} from "@/features/studio/accounts/password-token";
import type {
  AccountDto,
  AccountListDto,
  AccountAuditListDto,
  AccountMutationDto,
  AccountOperationDto,
  AccountOperationResultDto,
  PasswordSetupInspectionDto,
  PasswordSetupLinkDto,
} from "@/features/studio/accounts/contracts";
import { normalizePassword, withPasswordCapacity } from "./password";
import { readSession, sessionDto } from "../service";
const known = new Set<StudioErrorCode>([
  "INVALID_REQUEST",
  "UNAUTHENTICATED",
  "CAPABILITY_DENIED",
  "ACCOUNT_CONFLICT",
  "LOGIN_NAME_TAKEN",
  "LAST_ACTIVE_ADMIN",
  "PASSWORD_POLICY_REJECTED",
  "PASSWORD_CONFIRMATION_FAILED",
  "PASSWORD_TOKEN_INVALID",
  "OPERATION_BINDING_CONFLICT",
  "AUTHENTICATION_FAILED",
  "RATE_LIMITED",
  "REVISION_LIMIT",
]);
export async function accountCall<T>(
  db: P2aDatabase,
  fn:
    | "account_command"
    | "account_password"
    | "account_local"
    | "account_directory_read",
  mode: string,
  digest: string | null,
  p: Record<string, unknown>,
  mutation = false,
): Promise<T> {
  let committed = false,
    ready = false,
    callbackFailure: unknown;
  try {
    const value = await db.sql.begin(async (tx) => {
      try {
        await tx`SET LOCAL lock_timeout='2s'`;
        await tx`SET LOCAL statement_timeout='5s'`;
        await tx`SET LOCAL transaction_timeout='10s'`;
        const [row] =
          fn === "account_local"
            ? await tx<
                { value: T }[]
              >`SELECT qf.account_local(${JSON.stringify(p)}::text::jsonb) AS value`
            : fn === "account_password"
              ? await tx<
                  { value: T }[]
                >`SELECT qf.account_password(${mode},${digest},${JSON.stringify(p)}::text::jsonb) AS value`
              : fn === "account_directory_read"
                ? await tx<
                    { value: T }[]
                  >`SELECT qf.account_directory_read(${mode},${digest},${JSON.stringify(p)}::text::jsonb) AS value`
                : await tx<
                    { value: T }[]
                  >`SELECT qf.account_command(${mode},${digest},${JSON.stringify(p)}::text::jsonb) AS value`;
        if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
        ready = true;
        return row.value;
      } catch (e) {
        callbackFailure = e;
        throw e;
      }
    });
    committed = true;
    if (value && typeof value === "object" && "error" in value) {
      const code = (value as { error: StudioErrorCode }).error;
      throw new StudioError(known.has(code) ? code : "STUDIO_UNAVAILABLE");
    }
    return value as T;
  } catch (e) {
    if (committed && e instanceof StudioError) throw e;
    if (
      mutation &&
      (isStudioConnectionFailure(e) || ready || e !== callbackFailure)
    )
      throw new StudioError("WRITE_OUTCOME_UNKNOWN");
    if (e instanceof StudioError) throw e;
    const code = e as {
      code?: string;
      message?: string;
      constraint_name?: string;
    };
    if (code.code === "P0001" && known.has(code.message as StudioErrorCode))
      throw new StudioError(code.message as StudioErrorCode);
    if (code.code === "23505" && code.constraint_name === "operator_login")
      throw new StudioError("LOGIN_NAME_TAKEN");
    if (code.code === "55P03" || code.code === "57014")
      throw new StudioError("WRITE_BUSY");
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
}
export function accountSessionDigest(raw: string | null) {
  const d = raw && digestToken(raw, "session");
  if (!d) throw new StudioError("UNAUTHENTICATED");
  return d;
}
export function requireAccountCsrf(c: StudioWriteCredentials) {
  accountSessionDigest(c.sessionToken);
  if (!c.csrfToken || !verifyCsrf(c.sessionToken!, "session", c.csrfToken))
    throw new StudioError("CSRF_REJECTED");
}
export function passwordTokenDigest(raw: string) {
  const bytes = passwordTokenBytes(raw);
  if (!bytes) throw new StudioError("PASSWORD_TOKEN_INVALID");
  return createHash("sha256")
    .update("quizforge.accounts.setup.token.v1:")
    .update(bytes)
    .digest("hex");
}
export function issuePasswordToken() {
  const raw = PASSWORD_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { raw, digest: passwordTokenDigest(raw), id: randomUUID() };
}
export async function requirePasswordTokenCsrf(
  raw: string,
  csrf: string | null,
) {
  const expected = await passwordSetupCsrf(raw);
  if (!expected || !csrf || expected !== csrf)
    throw new StudioError("CSRF_REJECTED");
  return passwordTokenDigest(raw);
}
export function readAccount(db: P2aDatabase, raw: string | null) {
  return accountCall<AccountDto>(
    db,
    "account_command",
    "me",
    accountSessionDigest(raw),
    {},
  );
}
export function listAccounts(
  db: P2aDatabase,
  raw: string | null,
  p: Record<string, unknown>,
) {
  return accountCall<AccountListDto>(
    db,
    "account_directory_read",
    "list",
    accountSessionDigest(raw),
    p,
  );
}
export function readAccountAudit(
  db: P2aDatabase,
  raw: string | null,
  p: Record<string, unknown>,
) {
  return accountCall<AccountAuditListDto>(
    db,
    "account_directory_read",
    "audit",
    accountSessionDigest(raw),
    p,
  );
}
export function accountResult(
  db: P2aDatabase,
  raw: string | null,
  operationId: string,
) {
  return accountCall<AccountOperationResultDto>(
    db,
    "account_command",
    "result",
    accountSessionDigest(raw),
    { operationId },
  );
}
export async function mutateAccount(
  db: P2aDatabase,
  c: StudioWriteCredentials,
  p: Record<string, unknown>,
): Promise<AccountMutationDto> {
  requireAccountCsrf(c);
  const token = issuePasswordToken();
  const result = await accountCall<
    AccountMutationDto & {
      first: boolean;
      passwordSetup?: Omit<PasswordSetupLinkDto, "url"> | null;
    }
  >(
    db,
    "account_command",
    "mutate",
    accountSessionDigest(c.sessionToken),
    { ...p, tokenId: token.id, tokenDigest: token.digest },
    true,
  );
  const { first, passwordSetup, ...safe } = result;
  return {
    ...safe,
    ...(first && passwordSetup
      ? {
          passwordSetup: {
            ...passwordSetup,
            url:
              db.config.origin +
              "/studio/set-password#token=" +
              token.raw +
              "&tokenId=" +
              passwordSetup.tokenId,
          },
        }
      : {}),
  };
}
export async function passwordLogin(
  db: P2aDatabase,
  preauth: string | null,
  csrf: string | null,
  loginName: string,
  passwordInput: string,
) {
  return withPasswordCapacity(async ({ verify }) => {
    if (!preauth || !csrf || !verifyCsrf(preauth, "preauth", csrf))
      throw new StudioError("CSRF_REJECTED");
    const digest = digestToken(preauth, "preauth");
    if (!digest) throw new StudioError("AUTHENTICATION_FAILED");
    let password: string;
    try {
      password = normalizePassword(passwordInput);
    } catch {
      throw new StudioError("AUTHENTICATION_FAILED");
    }
    const attemptId = randomUUID();
    const reservation = await accountCall<{ passwordHash: string | null }>(
      db,
      "account_password",
      "reserve-login",
      digest,
      { attemptId, loginName },
      true,
    );
    const verified = await verify(password, reservation.passwordHash);
    const token = issueToken("session");
    await accountCall(
      db,
      "account_password",
      "finish-login",
      digest,
      {
        attemptId,
        verified,
        sessionId: randomUUID(),
        sessionDigest: token.digest,
      },
      true,
    );
    const actor = await readSession(db, token.raw);
    return { raw: token.raw, dto: sessionDto(actor, token.raw) };
  });
}
export function inspectPasswordSetup(db: P2aDatabase, digest: string) {
  return accountCall<PasswordSetupInspectionDto>(
    db,
    "account_password",
    "inspect",
    digest,
    {},
  );
}
export function setupResult(
  db: P2aDatabase,
  digest: string,
  operationId: string,
) {
  return accountCall<AccountOperationResultDto>(
    db,
    "account_password",
    "setup-result",
    digest,
    { operationId },
  );
}
export async function completePasswordSetup(
  db: P2aDatabase,
  digest: string,
  operationId: string,
  passwordInput: string,
) {
  return withPasswordCapacity(async ({ hash }) => {
    const password = normalizePassword(passwordInput),
      attemptId = randomUUID();
    await accountCall(
      db,
      "account_password",
      "reserve-setup",
      digest,
      { operationId, attemptId },
      true,
    );
    const passwordHash = await hash(password);
    return accountCall<AccountOperationDto>(
      db,
      "account_password",
      "finish-setup",
      digest,
      { operationId, attemptId, passwordHash },
      true,
    );
  });
}
export async function changeOwnPassword(
  db: P2aDatabase,
  c: StudioWriteCredentials,
  operationId: string,
  currentPassword: string,
  newPassword: string,
) {
  return withPasswordCapacity(async ({ hash, verify }) => {
    requireAccountCsrf(c);
    const password = normalizePassword(newPassword),
      digest = accountSessionDigest(c.sessionToken),
      attemptId = randomUUID();
    const reservation = await accountCall<{ passwordHash: string }>(
      db,
      "account_password",
      "reserve-change",
      digest,
      { operationId, attemptId },
      true,
    );
    let current: string;
    try {
      current = normalizePassword(currentPassword);
    } catch {
      current = "invalid";
    }
    const verified = await verify(current, reservation.passwordHash);
    const passwordHash = verified ? await hash(password) : "";
    return accountCall<AccountOperationDto>(
      db,
      "account_password",
      "finish-change",
      digest,
      { operationId, attemptId, verified, passwordHash },
      true,
    );
  });
}
