/** Browser-safe response DTOs. No persistence or raw cookie-token types. */
import type { StudioRole } from "@/lib/auth/role-policy";

export type StudioOperatorDto = {
  id: string;
  label: string;
  role: StudioRole;
  loginName?: string | null;
  displayName?: string;
  accountRevision?: number;
};

export type StudioSessionDto = {
  operator: StudioOperatorDto;
  csrfToken: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export type StudioPreauthDto = {
  csrfToken: string;
  expiresAt: string;
};
