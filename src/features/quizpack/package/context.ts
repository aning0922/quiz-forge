import { types } from "node:util";
import type { SupportedValidationContext } from "./api";
import { packIdSchema } from "../v1/manifest";
import { resolvePackLimits } from "../v1/limits";
import { PackToolError } from "../v1/zip";
/** No compatibility policy or accessor is accepted or forwarded to execution hooks. */
export function snapshotSupportedContext(context: SupportedValidationContext) {
  if (
    !context ||
    typeof context !== "object" ||
    types.isProxy(context) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(context))
  )
    throw new PackToolError("INVALID_COMPATIBILITY_POLICY");
  const fields = Object.getOwnPropertyDescriptors(context);
  if (
    Reflect.ownKeys(context).some(
      (key) =>
        typeof key !== "string" ||
        !["targetProductId", "limits", "signal"].includes(key) ||
        !("value" in fields[key]!) ||
        !fields[key]!.enumerable,
    )
  )
    throw new PackToolError("INVALID_COMPATIBILITY_POLICY");
  if (!packIdSchema.safeParse(context.targetProductId).success)
    throw new PackToolError("INVALID_TARGET_PRODUCT");
  const limits = resolvePackLimits(context.limits);
  if (!limits.ok) throw new PackToolError("INVALID_LIMITS");
  return {
    targetProductId: context.targetProductId,
    limits: limits.value,
    ...(context.signal ? { signal: context.signal } : {}),
  };
}
/** Read only an ordinary data property while constructing a bounded failure report. */
export function contextTarget(context: SupportedValidationContext): string {
  if (!context || typeof context !== "object" || types.isProxy(context))
    return "";
  const field = Object.getOwnPropertyDescriptor(context, "targetProductId");
  return field && "value" in field && typeof field.value === "string"
    ? field.value
    : "";
}
