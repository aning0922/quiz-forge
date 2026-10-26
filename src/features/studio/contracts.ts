/** Browser-safe response DTOs. No persistence or raw cookie-token types. */
import type { StudioOperatorIdentity } from "@/lib/auth/identity";

export type StudioOperatorDto = StudioOperatorIdentity;

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
