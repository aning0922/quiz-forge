import { z } from "zod";
import registration from "./private-test-registration.json";
import rebuildRegistration from "./private-test-registration-rebuild.json";

/** Compiled finite registrations, never selected by a request or an environment switch. */
export const PRIVATE_TEST_REGISTRATION = registration;
export const PRIVATE_TEST_REGISTRATIONS = [
  registration,
  rebuildRegistration,
] as const;
export type PrivateTestRegistration =
  (typeof PRIVATE_TEST_REGISTRATIONS)[number];
export const privateTestUseSchema = z.union([
  z.strictObject({
    schemaVersion: z.literal("quizforge.private-test-use.v1"),
    instanceId: z.literal("953991305a7e8c49bb773d95cd120378"),
    authorizationId: z.literal("qztx-full-flow-20261030"),
    contentStatus: z.literal("candidate"),
    resourceStatus: z.literal("reference-or-candidate"),
  }),
  z.strictObject({
    schemaVersion: z.literal("quizforge.private-test-use.v1"),
    instanceId: z.literal("bea112ce460725bd10fc41226e45df48"),
    authorizationId: z.literal("qztx-prototype-rebuild-20261031"),
    contentStatus: z.literal("candidate"),
    resourceStatus: z.literal("reference-or-candidate"),
  }),
]);
export function privateTestMarkerMatches(
  input: unknown,
  registered: PrivateTestRegistration,
): boolean {
  const parsed = privateTestUseSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.instanceId === registered.instanceId &&
    parsed.data.authorizationId === registered.authorizationId
  );
}
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
type SourceFacts = {
  productId: string;
  canonicalContentSha256: string;
  assetSetSha256: string;
  canonicalManifestSha256: string;
};
export function registeredPrivateTestSource(facts: SourceFacts) {
  return (
    PRIVATE_TEST_REGISTRATIONS.find(
      (r) =>
        facts.productId === r.productId &&
        /^[a-f0-9]{64}$/.test(r.canonicalContentSha256) &&
        facts.canonicalContentSha256 === r.canonicalContentSha256 &&
        facts.assetSetSha256 === r.assetSetSha256 &&
        facts.canonicalManifestSha256 === r.canonicalManifestSha256,
    ) ?? null
  );
}
export function privateTestSourceMatches(facts: SourceFacts) {
  return registeredPrivateTestSource(facts) !== null;
}
/** Exact compiled resource facts remain necessary in addition to the server-authorized view. */
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
    PRIVATE_TEST_REGISTRATIONS.some((r) =>
      r.resources.some(
        (e: Record<string, unknown>) =>
          e.productId === asset.resourceRef.productId &&
          e.id === asset.resourceRef.id &&
          e.version === asset.resourceRef.version &&
          e.sha256 === asset.sha256 &&
          e.bytes === asset.bytes &&
          e.width === asset.width &&
          e.height === asset.height &&
          e.mediaType === asset.mediaType &&
          e.purpose === asset.purpose,
      ),
    )
  );
}
