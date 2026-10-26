import "server-only";
import { z } from "zod";
import { StudioError } from "@/lib/http-security/errors";
import {
  studioOperatorIdentitySchema,
  type StudioOperatorIdentity,
} from "./identity";
import { roleHasCapability, type StudioCapability } from "./role-policy";

export type { StudioCapability, StudioRole } from "./role-policy";

const authenticatedActor = Symbol("authenticated-studio-actor");

export type StudioActor = Readonly<
  StudioOperatorIdentity & {
    sessionId: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    [authenticatedActor]: true;
  }
>;

/** Server service only: construct after the current DB session and operator were verified. */
export function verifiedActor(
  values: Omit<StudioActor, typeof authenticatedActor>,
): StudioActor {
  const identity = studioOperatorIdentitySchema.safeParse({
    id: values.id,
    loginName: values.loginName,
    displayName: values.displayName,
    role: values.role,
    accountRevision: values.accountRevision,
  });
  if (
    !identity.success ||
    !z.uuid().safeParse(values.sessionId).success ||
    ![values.idleExpiresAt, values.absoluteExpiresAt].every(
      (value) => value instanceof Date && Number.isFinite(value.getTime()),
    )
  )
    throw new StudioError("STUDIO_UNAVAILABLE");
  return Object.freeze({
    ...identity.data,
    sessionId: values.sessionId,
    idleExpiresAt: values.idleExpiresAt,
    absoluteExpiresAt: values.absoluteExpiresAt,
    [authenticatedActor]: true as const,
  });
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
