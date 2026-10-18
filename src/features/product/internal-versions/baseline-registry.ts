import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  assessmentReferenceSchema,
  engineDeclarationSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  baselineIdentitySchema,
  baselineApprovalSchema,
  fixedDisplayComponentsSchema,
  type BaselineIdentity,
} from "./identity-contracts";
import historical from "./baselines/historical-cabinet-2026-10-18.json";
import synthetic from "./baselines/synthetic-internal-version-v1.json";
const id = assessmentIdSchema.refine((v) => !/[\r\n]/.test(v)),
  version = assessmentVersionSchema.refine((v) => !/[\r\n]/.test(v)),
  sha = sha256Schema.length(64);
const ref = assessmentReferenceSchema.extend({ id, version, productId: id });
const sourceEvidenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("author-mapping"),
    reviewedDeliveryCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .length(40),
    contentSourceCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .length(40),
    contentSourceSha256: sha,
    reviewJsonSha256: sha,
    reviewHtmlSha256: sha,
    provenanceDocumentSha256: sha,
    fieldMappingSha256: sha,
  }),
  z.strictObject({
    kind: z.literal("synthetic-definition"),
    definitionSha256: sha,
    qualification: z.literal(
      "synthetic-content-private-pixels-no-author-approval",
    ),
  }),
]);
const edgeSchema = z.strictObject({
  resourceId: id,
  version,
  purpose: z.enum(["cover", "decoration", "portrait"]),
  sha256: sha,
  bytes: z.number().int().min(1).max(8388608),
  mediaType: z.enum(["image/png", "image/webp", "image/jpeg"]),
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  reviewFile: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+\.(?:png|webp|jpg)(?![\s\S])/),
});
export const baselineDescriptorSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.baseline-registry-entry.v1"),
    kind: z.literal("baseline"),
    id,
    version,
    productId: id,
    purpose: z.literal("internal-test"),
    allowedInstancePurposes: z
      .enum(["test", "ci", "demo"])
      .array()
      .min(1)
      .max(3),
    canonicalContentSha256: sha,
    assetSetSha256: sha,
    canonicalManifestSha256: sha,
    logicHash: sha,
    approval: baselineApprovalSchema,
    sourceEvidence: sourceEvidenceSchema,
    engine: engineDeclarationSchema,
    components: fixedDisplayComponentsSchema,
    resourceEdges: edgeSchema.array().min(1).max(64),
    presentationEdges: z.strictObject({
      cover: ref,
      sections: z
        .strictObject({ sectionId: id, resourceRef: ref })
        .array()
        .min(1)
        .max(8),
      results: z
        .strictObject({
          resultRef: ref,
          reportTemplateRef: ref,
          portraitRef: ref,
        })
        .array()
        .min(1)
        .max(32),
    }),
  })
  .superRefine((v, ctx) => {
    const reject = () =>
      ctx.addIssue({
        code: "custom",
        message: "Invalid trusted baseline descriptor.",
      });
    if (
      new Set(v.allowedInstancePurposes).size !==
      v.allowedInstancePurposes.length
    )
      reject();
    if (
      v.approval.kind === "synthetic-test" &&
      (v.sourceEvidence.kind !== "synthetic-definition" ||
        v.allowedInstancePurposes.includes("demo"))
    )
      reject();
    if (
      v.approval.kind === "author-baseline" &&
      v.sourceEvidence.kind !== "author-mapping"
    )
      reject();
    const key = (r: { id: string; version: string }) =>
      JSON.stringify([r.id, r.version]);
    const resources = new Map(
      v.resourceEdges.map((r) => [
        key({ id: r.resourceId, version: r.version }),
        r,
      ]),
    );
    if (resources.size !== v.resourceEdges.length) reject();
    const check = (r: z.infer<typeof ref>, purpose: string) => {
      const e = resources.get(key(r));
      if (r.productId !== v.productId || e?.purpose !== purpose) reject();
    };
    check(v.presentationEdges.cover, "cover");
    for (const s of v.presentationEdges.sections)
      check(s.resourceRef, "decoration");
    for (const r of v.presentationEdges.results) {
      check(r.portraitRef, "portrait");
      if (
        r.resultRef.productId !== v.productId ||
        r.reportTemplateRef.productId !== v.productId
      )
        reject();
    }
    if (
      new Set(v.presentationEdges.sections.map((x) => x.sectionId)).size !==
        v.presentationEdges.sections.length ||
      new Set(v.presentationEdges.results.map((x) => key(x.resultRef))).size !==
        v.presentationEdges.results.length
    )
      reject();
    const unique = new Map<string, z.infer<typeof edgeSchema>>();
    for (const edge of v.resourceEdges) {
      const old = unique.get(edge.sha256);
      if (
        old &&
        (old.bytes !== edge.bytes ||
          old.mediaType !== edge.mediaType ||
          old.width !== edge.width ||
          old.height !== edge.height)
      )
        reject();
      unique.set(edge.sha256, edge);
    }
    if ([...unique.values()].reduce((sum, e) => sum + e.bytes, 0) > 33554432)
      reject();
  });
export type BaselineDescriptor = z.infer<typeof baselineDescriptorSchema>;
export type TrustedBaseline = Readonly<{
  identity: BaselineIdentity;
  descriptor: BaselineDescriptor;
}>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function register(value: unknown): TrustedBaseline {
  const descriptor = baselineDescriptorSchema.parse(value);
  const entrySha256 = createHash("sha256")
    .update(
      canonicalOrdinaryJson(descriptor, { maxBytes: 65536, maxDepth: 32 }),
    )
    .digest("hex");
  return freeze({
    identity: baselineIdentitySchema.parse({
      kind: "baseline",
      id: descriptor.id,
      version: descriptor.version,
      entrySha256,
    }),
    descriptor,
  });
}
/** Compiled registrations only. No request, fixture file, DB row or environment variable can add entries. */
const entries: readonly TrustedBaseline[] = Object.freeze([
  register(historical),
  register(synthetic),
]);
const same = (a: BaselineIdentity, b: BaselineIdentity) =>
  a.kind === b.kind &&
  a.id === b.id &&
  a.version === b.version &&
  a.entrySha256 === b.entrySha256;
/** Historical metadata remains available even when a future execution module is unavailable. */
export function findBaselineDescriptor(input: unknown): TrustedBaseline | null {
  const identity = baselineIdentitySchema.safeParse(input);
  if (!identity.success) return null;
  return entries.find((e) => same(e.identity, identity.data)) ?? null;
}
export type ExactBaselineSource = Readonly<{
  productId: string;
  canonicalContentSha256: string;
  assetSetSha256: string;
  canonicalManifestSha256: string;
}>;
/** The application passes hashes recomputed by the validated revision-source port, never client claims. */
export function matchRegisteredBaseline(
  source: ExactBaselineSource,
  instancePurpose: "test" | "ci" | "demo",
): TrustedBaseline | null {
  const matches = entries.filter(
    ({ descriptor: d }) =>
      d.allowedInstancePurposes.includes(instancePurpose) &&
      d.productId === source.productId &&
      d.canonicalContentSha256 === source.canonicalContentSha256 &&
      d.assetSetSha256 === source.assetSetSha256 &&
      d.canonicalManifestSha256 === source.canonicalManifestSha256,
  );
  if (matches.length > 1) throw Error("AMBIGUOUS_BASELINE_REGISTRATION");
  return matches[0] ?? null;
}
