import { StudioClientError, studioFetch } from "../client";
import { passwordSetupCsrf } from "./password-token";
import type {
  AccountOperationDto,
  AccountOperationResultDto,
  PasswordSetupInspectionDto,
  PasswordSetupInput,
} from "./contracts";
async function setupPost<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  write = false,
) {
  const csrf = await passwordSetupCsrf(token);
  if (!csrf) throw new StudioClientError("PASSWORD_TOKEN_INVALID");
  return studioFetch<T>(
    `/api/studio/auth/password-setup${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ token, ...body }),
    },
    write,
  );
}
export const setupAdapter = {
  inspect: (token: string) =>
    setupPost<PasswordSetupInspectionDto>("/inspect", token, {}),
  submit: (token: string, operationId: string, newPassword: string) =>
    setupPost<AccountOperationDto>(
      "",
      token,
      { operationId, password: newPassword } satisfies Omit<
        PasswordSetupInput,
        "token"
      >,
      true,
    ),
  result: (token: string, operationId: string) =>
    setupPost<AccountOperationResultDto>("/result", token, { operationId }),
};
