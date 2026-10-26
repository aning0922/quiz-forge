import "server-only";
import { StudioError } from "@/lib/http-security/errors";
import {
  roleHasCapability,
  type StudioCapability,
  type StudioRole,
} from "./role-policy";

export type { StudioCapability, StudioRole } from "./role-policy";

const authenticatedActor = Symbol("authenticated-studio-actor");

export type StudioActor = Readonly<{
  id: string;
  label: string;
  role: StudioRole;
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  loginName?: string | null;
  displayName?: string;
  accountRevision?: number;
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
  if (
    actor[authenticatedActor] !== true ||
    !roleHasCapability(actor.role, capability)
  ) {
    throw new StudioError("CAPABILITY_DENIED");
  }
}
