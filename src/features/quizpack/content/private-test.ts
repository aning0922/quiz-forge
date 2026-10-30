import { z } from "zod";
import registration from "./private-test-registration.json";

/** A compiled local test scope is not selected by a request, pack or environment switch. */
export const PRIVATE_TEST_REGISTRATION = registration;
export const privateTestUseSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.private-test-use.v1"),
  instanceId: z.literal("953991305a7e8c49bb773d95cd120378"),
  authorizationId: z.literal("qztx-full-flow-20261030"),
  contentStatus: z.literal("candidate"),
  resourceStatus: z.literal("reference-or-candidate"),
});
export function hasPrivateTestUse(input: unknown): boolean {
  return (
    !!input &&
    typeof input === "object" &&
    "bindings" in input &&
    !!input.bindings &&
    typeof input.bindings === "object" &&
    "privateTestUse" in input.bindings
  );
}
export function privateTestSourceMatches(facts: {
  productId: string;
  canonicalContentSha256: string;
  assetSetSha256: string;
  canonicalManifestSha256: string;
}) {
  return (
    facts.productId === registration.productId &&
    /^[a-f0-9]{64}$/.test(registration.canonicalContentSha256) &&
    facts.canonicalContentSha256 === registration.canonicalContentSha256 &&
    facts.assetSetSha256 === registration.assetSetSha256 &&
    facts.canonicalManifestSha256 === registration.canonicalManifestSha256
  );
}
/** Browser eligibility still requires the exact compiled resource facts and the server-authorized view. */
export function privateTestAssetMatches(asset: {
  approval: string;
  resourceRef: { productId: string; id: string; version: string };
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  mediaType: string;
  purpose: string;
}) {
  return (
    asset.approval === "private-test-only" &&
    registration.resources.some(
      (entry: Record<string, unknown>) =>
        entry.productId === asset.resourceRef.productId &&
        entry.id === asset.resourceRef.id &&
        entry.version === asset.resourceRef.version &&
        entry.sha256 === asset.sha256 &&
        entry.bytes === asset.bytes &&
        entry.width === asset.width &&
        entry.height === asset.height &&
        entry.mediaType === asset.mediaType &&
        entry.purpose === asset.purpose,
    )
  );
}
