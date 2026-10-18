import {
  internalReviewReceiptSchema,
  internalVersionReceiptSchema,
  internalVersionDetailSchema,
  internalReviewResolutionSchema,
  internalVersionResolutionSchema,
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  hashInternalText,
  reviewFactsText,
  internalSnapshotText,
} from "./contracts";
function requireEqual(a: string, b: string) {
  if (a !== b) throw Error("INTERNAL_VERSION_CONTRACT_MISMATCH");
}
/** Parsing alone validates shape; transports also verify the fixed digest/fingerprint relationships. */
export async function verifyInternalReviewReceipt(input: unknown) {
  const value = internalReviewReceiptSchema.parse(input);
  requireEqual(
    value.fingerprint,
    await recordBaselineFingerprint(value.binding),
  );
  requireEqual(
    value.reviewSha256,
    await hashInternalText(reviewFactsText(value.facts)),
  );
  return value;
}
export async function verifyInternalVersionReceipt(input: unknown) {
  const value = internalVersionReceiptSchema.parse(input);
  requireEqual(
    value.fingerprint,
    await sealInternalVersionFingerprint(value.binding),
  );
  return value;
}
export async function verifyInternalVersionDetail(input: unknown) {
  const value = internalVersionDetailSchema.parse(input);
  await verifyInternalVersionReceipt(value.version);
  requireEqual(
    value.version.snapshotSha256,
    await hashInternalText(internalSnapshotText(value.snapshot)),
  );
  return value;
}
export async function verifyInternalReviewResolution(input: unknown) {
  const value = internalReviewResolutionSchema.parse(input);
  requireEqual(
    value.fingerprint,
    await recordBaselineFingerprint(value.binding),
  );
  if (value.kind === "recorded")
    await verifyInternalReviewReceipt(value.review);
  if (value.kind === "not-recorded-target-used")
    await verifyInternalReviewReceipt(value.consumed);
  return value;
}
export async function verifyInternalVersionResolution(input: unknown) {
  const value = internalVersionResolutionSchema.parse(input);
  requireEqual(
    value.fingerprint,
    await sealInternalVersionFingerprint(value.binding),
  );
  if (value.kind === "sealed")
    await verifyInternalVersionReceipt(value.version);
  if (value.kind === "not-sealed-target-used")
    await verifyInternalVersionReceipt(value.consumed);
  return value;
}
