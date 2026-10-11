import "server-only";
import { StudioError } from "@/lib/http-security/errors";

const authenticatedActor = Symbol("authenticated-studio-actor");

export type StudioRole = "operator" | "read-only";
export type StudioCapability =
  | "studio:read"
  | "workspace:write"
  | "draft:write"
  | "import:create"
  | "review:submit"
  | "review:return";

export type StudioActor = Readonly<{
  id: string;
  label: string;
  role: StudioRole;
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  [authenticatedActor]: true;
}>;

/** Server service only: construct after the current DB session and operator were verified. */
export function verifiedActor(
  values: Omit<StudioActor, typeof authenticatedActor>,
): StudioActor {
  return Object.freeze({ ...values, [authenticatedActor]: true as const });
}

export function requireCapability(
  actor: StudioActor,
  capability: StudioCapability,
): void {
  const known = [
    "workspace:write",
    "draft:write",
    "import:create",
    "review:submit",
    "review:return",
  ];
  if (
    actor[authenticatedActor] !== true ||
    (actor.role !== "operator" && actor.role !== "read-only") ||
    (capability !== "studio:read" &&
      (actor.role !== "operator" || !known.includes(capability)))
  ) {
    throw new StudioError("CAPABILITY_DENIED");
  }
}
