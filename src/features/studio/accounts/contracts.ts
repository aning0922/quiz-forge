import type { StudioRole } from "@/lib/auth/role-policy";

/** Browser-safe accounts API. Passwords and raw setup links are never persisted. */
export type AccountStatus = "pending" | "active" | "disabled";
export type AccountDto = {
  id: string;
  label: string;
  loginName: string | null;
  displayName: string;
  role: StudioRole;
  status: AccountStatus;
  revision: number;
  createdAt: string;
  disabledAt: string | null;
};

export type PasswordTokenPurpose =
  "setup" | "reset" | "bootstrap-admin" | "admin-recovery";

export type AccountAction =
  | "create"
  | "display-name"
  | "role"
  | "disable"
  | "restore"
  | "issue-setup"
  | "issue-reset"
  | "password-setup"
  | "password-change"
  | "logout-all"
  | "revoke-sessions"
  | "bootstrap-admin"
  | "admin-recovery";

export type AccountOperationDto = {
  operationId: string;
  action: AccountAction;
  actorId: string | null;
  targetId: string;
  status: "completed" | "rejected";
  errorCode: string | null;
  createdAt: string;
};

export type AccountOperationResultDto =
  | { status: "unknown"; operationId: string }
  | { status: "found"; operation: AccountOperationDto };

/** Secret URL: only the first confirmed issuance response may contain it. */
export type PasswordSetupLinkDto = {
  tokenId: string;
  purpose: PasswordTokenPurpose;
  url: string;
  expiresAt: string;
};

export type AccountMutationDto = {
  account: AccountDto;
  operation: AccountOperationDto;
  passwordSetup?: PasswordSetupLinkDto;
};

export type AccountListDto = {
  items: AccountDto[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type AccountAuditDto = AccountOperationDto & {
  actorDisplayName: string | null;
  targetDisplayName: string;
};

export type AccountAuditListDto = {
  items: AccountAuditDto[];
  offset: number;
  limit: number;
  hasMore: boolean;
};

export type PasswordSetupInspectionDto = {
  tokenId: string;
  purpose: PasswordTokenPurpose;
  loginName: string;
  displayName: string;
  expiresAt: string;
  passwordPolicy: { minCodePoints: 15; maxCodePoints: 256 };
};

export type CreateAccountInput = {
  operationId: string;
  loginName: string;
  displayName: string;
  role: StudioRole;
};

export type PasswordSetupInput = {
  token: string;
  operationId: string;
  password: string;
};

export type AccountChangeInput = {
  operationId: string;
  expectedRevision: number;
} & (
  | { action: "display-name"; displayName: string }
  | { action: "role"; role: StudioRole }
  | { action: "disable" | "restore" }
);
