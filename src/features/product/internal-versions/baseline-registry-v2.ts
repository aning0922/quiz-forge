import privateLocal from "./baselines/qztx-private-local-20261030.json";
import privateRebuild from "./baselines/qztx-private-rebuild-20261031.json";
import "server-only";
import { createHash } from "node:crypto";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  baselineIdentitySchema,
  type BaselineIdentity,
} from "./identity-contracts";
import { baselineDescriptorV2Schema } from "./baseline-schema-v2";
import {
  findBaselineDescriptor,
  matchRegisteredBaseline,
  type ExactBaselineSource,
} from "./baseline-registry";
import synthetic from "./baselines/synthetic-d2-structured-v1.json";
import qianzaiSynthetic from "./baselines/synthetic-d3-qianzai-v1.json";
import qianzaiSyntheticImages from "./baselines/synthetic-d3-images-qianzai-v1.json";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const BASELINES_V2 = freeze(
  [
    synthetic,
    qianzaiSynthetic,
    qianzaiSyntheticImages,
    privateLocal,
    privateRebuild,
  ].map((input) => {
    const descriptor = baselineDescriptorV2Schema.parse(input);
    return {
      identity: baselineIdentitySchema.parse({
        kind: "baseline",
        id: descriptor.id,
        version: descriptor.version,
        entrySha256: createHash("sha256")
          .update(
            canonicalOrdinaryJson(descriptor, {
              maxBytes: 65_536,
              maxDepth: 32,
            }),
          )
          .digest("hex"),
      }),
      descriptor,
    };
  }),
);
const key = (v: BaselineIdentity) =>
  JSON.stringify([v.kind, v.id, v.version, v.entrySha256]);
/** Exact catalog union; no request, database row or environment registers new entries. */
export function findCurrentBaselineDescriptor(input: unknown) {
  const parsed = baselineIdentitySchema.safeParse(input);
  if (!parsed.success) return null;
  const current = BASELINES_V2.find(
    (entry) => key(entry.identity) === key(parsed.data),
  );
  return current ?? findBaselineDescriptor(parsed.data);
}
export function matchCurrentRegisteredBaseline(
  source: ExactBaselineSource,
  purpose: "test" | "ci" | "demo",
) {
  const matches = BASELINES_V2.filter(
    ({ descriptor: d }) =>
      d.allowedInstancePurposes.includes(purpose) &&
      d.productId === source.productId &&
      d.canonicalContentSha256 === source.canonicalContentSha256 &&
      d.assetSetSha256 === source.assetSetSha256 &&
      d.canonicalManifestSha256 === source.canonicalManifestSha256,
  );
  const historical = matchRegisteredBaseline(source, purpose);
  if (matches.length + (historical ? 1 : 0) > 1)
    throw Error("AMBIGUOUS_BASELINE_REGISTRATION");
  return matches[0] ?? historical;
}
