import "server-only";
import { createHash } from "node:crypto";
import { canonicalP1Json } from "../v1/canonical";
import * as limits from "./limits";
import { SUPPORTED_COMPATIBILITY_POLICY } from "../package/compatibility";
import { supportedValidationIdentitySchema } from "../server/validation/contracts";
const { ARCHIVE_POLICY_VERSION } = limits;
/** Fixed trusted B policy. A's independent policy remains bound by identitySha256. */
export const archivePolicyDescriptor = Object.freeze({
  schemaVersion: ARCHIVE_POLICY_VERSION,
  accepted: Object.freeze({
    containerSchema: "quizpack.v1",
    contentSchema: "quizpack-content.v1",
    contentKind: "synthetic",
  }),
  commitProtocol: "claim-evidence-complete.v1",
  stateProtocol: "validation-assets.v1",
  evidenceProjection: "sealed-report-text-metadata-controls.v1",
  storageProtocol: "serial-exclusive-no-clobber-verified-blobs.v1",
  receiptProof: "candidate-receipt-db-ack.v1",
  finalizationProtocol: "confirmed-ack-before-exclusive-finalization-once.v1",
  immutableProtocol: "product-pack-canonical-alias-and-resource-declaration.v1",
  recoveryProtocol: "explicit-settled-proof-fence-no-attempt.v1",
  retryProtocol: "released-clean-current-identity-explicit.v1",
  namespaces: Object.freeze(["imports", "validation", "blobs"]),
  limits: Object.freeze({
    archiveBytes: limits.MAX_ARCHIVE_BYTES,
    identityBytes: limits.MAX_IDENTITY_BYTES,
    canonicalManifestBytes: 524288,
    canonicalContentBytes: 2097152,
    resourceDeclarationBytes: limits.MAX_DECLARATION_BYTES,
    assetSetBytes: limits.MAX_DECLARATION_BYTES,
    resources: limits.MAX_RESOURCES,
    blobBytes: 8388608,
    imageDimension: 8192,
    imagePixels: 16000000,
    imageFrames: 1,
    attempts: limits.MAX_ATTEMPTS,
    pendingPerProduct: limits.MAX_PENDING_VALIDATIONS,
    attemptReservationBytes: limits.VALIDATION_RESERVATION_BYTES,
    attemptControlsBytes: limits.MAX_ATTEMPT_CONTROL_BYTES,
    reportBytes: limits.MAX_REPORT_BYTES,
    reportPayloadBytes: limits.MAX_REPORT_PAYLOAD_BYTES,
    metadataWithControlsBytes: limits.MAX_METADATA_CONTROL_BYTES,
    metadataBytes: limits.MAX_METADATA_BYTES,
    fileStopProofBytes: limits.MAX_FILE_STOP_PROOF_BYTES,
    envelopeBytes: limits.MAX_EVIDENCE_BYTES,
    uploadQuotaBytes: 536870912,
    importDirectories: 1024,
    validationDirectories: limits.MAX_VALIDATIONS,
    blobNames: limits.MAX_BLOBS,
    filesPerOperationDirectory: 16,
    scanEntries: 8192,
    scanMs: 5000,
    businessMs: limits.VALIDATION_TIMEOUT_MS,
    cleanupMs: 5000,
    leaseMs: limits.LEASE_MS,
  }),
});
export const archivePolicyText = canonicalP1Json(archivePolicyDescriptor);
export const archivePolicySha256 = createHash("sha256")
  .update(archivePolicyText, "utf8")
  .digest("hex");
export { ARCHIVE_POLICY_VERSION };

/** Not selected by current writes until the matching migration/bridge activation. */
export const supportedArchivePolicyDescriptor = Object.freeze({
  ...archivePolicyDescriptor,
  schemaVersion: limits.SUPPORTED_ARCHIVE_POLICY_VERSION,
  accepted: Object.freeze({
    containerSchema: "quizpack.v1" as const,
    profiles: SUPPORTED_COMPATIBILITY_POLICY.profiles,
  }),
  pendingScope: "current-archive-policy-version-and-sha256.v1" as const,
});
export const supportedArchivePolicyText = canonicalP1Json(
  supportedArchivePolicyDescriptor,
);
export const supportedArchivePolicySha256 = createHash("sha256")
  .update(supportedArchivePolicyText, "utf8")
  .digest("hex");
export { SUPPORTED_ARCHIVE_POLICY_VERSION } from "./limits";

/** Current admission requires the complete policy tuple, not a version string alone. */
export function matchesSupportedArchiveIdentity(
  version: string,
  sha256: string,
  identity: unknown,
): boolean {
  return (
    version === limits.SUPPORTED_ARCHIVE_POLICY_VERSION &&
    sha256 === supportedArchivePolicySha256 &&
    supportedValidationIdentitySchema.safeParse(identity).success
  );
}
