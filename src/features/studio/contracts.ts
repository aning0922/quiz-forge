/** Browser-safe response DTOs. No persistence or raw cookie-token types. */
export type StudioOperatorDto = {
  id: string;
  label: string;
  role: "operator" | "read-only";
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
