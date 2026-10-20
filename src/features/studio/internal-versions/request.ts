import {
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
  recordBaselineFingerprintText,
  sealInternalVersionFingerprintText,
  type RecordBaselineBinding,
  type SealInternalVersionBinding,
} from "@/features/product/internal-versions/contracts";
export type InternalOperation = "review" | "seal";
export type InternalBindings = {
  review: RecordBaselineBinding;
  seal: SealInternalVersionBinding;
};
export type InternalRequest =
  | { operation: "review"; tuple: RecordBaselineBinding }
  | { operation: "seal"; tuple: SealInternalVersionBinding };
export function freezeInternalValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeInternalValue(child);
    Object.freeze(value);
  }
  return value;
}
export function freezeInternalBinding<O extends InternalOperation>(
  operation: O,
  value: unknown,
): InternalBindings[O] {
  const parsed =
    operation === "review"
      ? recordBaselineBindingSchema.parse(value)
      : sealInternalVersionBindingSchema.parse(value);
  return freezeInternalValue(parsed) as InternalBindings[O];
}
export function sameInternalBinding<O extends InternalOperation>(
  operation: O,
  a: InternalBindings[O],
  b: InternalBindings[O],
) {
  return operation === "review"
    ? recordBaselineFingerprintText(a) === recordBaselineFingerprintText(b)
    : sealInternalVersionFingerprintText(a) ===
        sealInternalVersionFingerprintText(b);
}
export function freezeInternalRequest(input: InternalRequest): InternalRequest {
  if (input.operation !== "review" && input.operation !== "seal")
    throw Error("INTERNAL_OPERATION_MISMATCH");
  return Object.freeze({
    operation: input.operation,
    tuple: freezeInternalBinding(input.operation, input.tuple),
  }) as InternalRequest;
}
