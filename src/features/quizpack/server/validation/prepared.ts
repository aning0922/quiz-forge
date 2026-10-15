import "server-only";
import { z } from "zod";
import { LAUNCH_FAILURE_CODES, type MediaOperationContext } from "../media";
import { canonicalP1Json } from "../../v1/canonical";
import { validationIdentitySchema, type ValidationIdentity } from "./contracts";
import {
  PREPARE_INTERRUPTION_CODES,
  type PreparedIdentityResult,
} from "./adapter-types";
import {
  createValidationOperationScope,
  ValidationInterrupted,
  type ValidationOperationScope,
} from "./operation-scope";
import { supportedRuntimeIdentity, readTrustedBinding } from "./identity";
import { EvidenceError } from "./unicode";
import { freezeJson } from "./report";
export const validationCompletionSchema = z
  .strictObject({
    mediaStopped: z.enum(["not-started", "confirmed", "unknown"]),
    relatedIo: z.enum(["settled", "unconfirmed"]),
    maintenanceRequired: z.boolean(),
  })
  .superRefine((v, c) => {
    if (
      v.maintenanceRequired !==
        (v.mediaStopped === "unknown" || v.relatedIo === "unconfirmed") ||
      (v.mediaStopped === "unknown" && v.relatedIo !== "unconfirmed")
    )
      c.addIssue({ code: "custom", message: "Invalid completion." });
  });
export const preparedIdentityEvidenceSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("prepared"),
      identity: validationIdentitySchema,
      completion: z.strictObject({
        mediaStopped: z.literal("not-started"),
        relatedIo: z.literal("settled"),
        maintenanceRequired: z.literal(false),
      }),
      runtimeFailure: z.null(),
    }),
    z.strictObject({
      outcome: z.literal("interrupted"),
      code: z.enum(PREPARE_INTERRUPTION_CODES),
      completion: validationCompletionSchema,
      runtimeFailure: z.enum(LAUNCH_FAILURE_CODES).nullable(),
    }),
  ])
  .superRefine((v, c) => {
    if (
      v.outcome === "interrupted" &&
      (v.completion.mediaStopped === "confirmed" ||
        (v.runtimeFailure === "STOP_UNCONFIRMED") !==
          (v.completion.mediaStopped === "unknown") ||
        (v.code === "MEDIA_STOP_UNCONFIRMED" &&
          v.completion.mediaStopped !== "unknown") ||
        (v.code === "RELATED_IO_UNCONFIRMED" &&
          v.completion.relatedIo !== "unconfirmed"))
    )
      c.addIssue({ code: "custom", message: "Invalid identity completion." });
  });
const issuance = Object.freeze({});
type State = {
  context: MediaOperationContext;
  identity: ValidationIdentity;
  consumed: boolean;
};
const states = new WeakMap<PreparedValidationIdentity, State>();
/** JSON parsing/structural schemas cannot create this same-context single-use authority. */
export class PreparedValidationIdentity {
  constructor(token: object) {
    if (token !== issuance) throw new EvidenceError("INVALID_CANDIDATE");
    Object.freeze(this);
  }
  toJSON(): never {
    throw new EvidenceError("INVALID_CANDIDATE");
  }
}
export function consumePreparedIdentity(
  handle: PreparedValidationIdentity,
  scope: ValidationOperationScope,
): ValidationIdentity {
  const state = states.get(handle);
  if (!state || state.context !== scope.context || state.consumed)
    throw new ValidationInterrupted("INVALID_CONTEXT");
  scope.checkpoint();
  state.consumed = true;
  return state.identity;
}
export async function prepareValidationIdentity(
  context: MediaOperationContext,
): Promise<PreparedIdentityResult> {
  const scope = createValidationOperationScope(context);
  try {
    scope.checkpoint();
    const identity = freezeJson(
      supportedRuntimeIdentity(await readTrustedBinding(scope)),
    );
    if (Buffer.byteLength(canonicalP1Json(identity), "utf8") > 16384)
      throw new ValidationInterrupted("BRIDGE_INTERNAL_FAILED");
    await scope.settleIo();
    scope.checkpoint();
    if (scope.completion().relatedIo !== "settled")
      throw new ValidationInterrupted("RELATED_IO_UNCONFIRMED");
    const sealed = preparedIdentityEvidenceSchema.parse({
      outcome: "prepared",
      identity,
      completion: scope.completion(),
      runtimeFailure: scope.runtimeFailure,
    });
    if (sealed.outcome !== "prepared")
      throw new ValidationInterrupted("BRIDGE_INTERNAL_FAILED");
    const handle = new PreparedValidationIdentity(issuance);
    scope.checkpoint();
    states.set(handle, {
      context,
      identity: freezeJson(sealed.identity),
      consumed: false,
    });
    return Object.freeze({ ...freezeJson(sealed), prepared: handle });
  } catch (error) {
    scope.requestStop(scope.runtimeFailure === "STOP_UNCONFIRMED");
    await scope.settleIo();
    const completion = scope.completion();
    const code =
      scope.runtimeFailure === "STOP_UNCONFIRMED"
        ? "MEDIA_STOP_UNCONFIRMED"
        : completion.relatedIo === "unconfirmed"
          ? "RELATED_IO_UNCONFIRMED"
          : error instanceof ValidationInterrupted &&
              PREPARE_INTERRUPTION_CODES.includes(
                error.code as (typeof PREPARE_INTERRUPTION_CODES)[number],
              )
            ? error.code
            : "BRIDGE_INTERNAL_FAILED";
    const sealed = preparedIdentityEvidenceSchema.parse({
      outcome: "interrupted",
      code,
      completion,
      runtimeFailure: scope.runtimeFailure,
    });
    if (sealed.outcome !== "interrupted")
      throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
    return freezeJson(sealed);
  }
}
