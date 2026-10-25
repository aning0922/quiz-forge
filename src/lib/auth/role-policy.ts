/** Browser-safe role policy. Server writes still require a verified StudioActor. */
export const studioRoles = ["admin", "operator", "read-only"] as const;
export type StudioRole = (typeof studioRoles)[number];

export const studioCapabilities = [
  "studio:read",
  "workspace:write",
  "workspace:archive",
  "taxonomy:manage",
  "draft:write",
  "import:create",
  "review:submit",
  "review:return",
  "review:record-baseline",
  "version:seal-internal",
  "access-key:issue",
  "access-key:void",
  "account:self",
  "account:manage",
  "account:audit",
] as const;
export type StudioCapability = (typeof studioCapabilities)[number];

const operatorCapabilities: ReadonlySet<StudioCapability> = new Set([
  "studio:read",
  "workspace:write",
  "draft:write",
  "import:create",
  "access-key:issue",
  "access-key:void",
  "account:self",
]);
const readOnlyCapabilities: ReadonlySet<StudioCapability> = new Set([
  "studio:read",
  "account:self",
]);

export function isStudioRole(value: unknown): value is StudioRole {
  return value === "admin" || value === "operator" || value === "read-only";
}

/** Unknown roles and capabilities are denied, including values from untrusted DTOs. */
export function roleHasCapability(
  role: unknown,
  capability: StudioCapability,
): boolean {
  if (!(studioCapabilities as readonly string[]).includes(capability))
    return false;
  if (role === "admin") return true;
  if (role === "operator") return operatorCapabilities.has(capability);
  if (role === "read-only") return readOnlyCapabilities.has(capability);
  return false;
}
