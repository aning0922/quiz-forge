import { z } from "zod";
import { displayCapabilitiesV2Schema } from "@/lib/assessment-contract/display-v2";
import {
  internalVersionSnapshotV1Schema,
  internalVersionSnapshotV2Schema,
} from "../internal-versions/identity-contracts";
import {
  consumerComponentMappingV2Schema,
  consumerProtocolsV2Schema,
} from "@/lib/consumer-contract/v2/identities";
import {
  consumerIdSchema as id,
  consumerVersionSchema as version,
  consumerSha256Schema as sha,
  consumerUuidSchema as uuid,
  consumerMomentSchema as moment,
  internalParentVersionRefSchema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerRendererIdentitySchema,
  consumerComponentMappingSchema,
  consumerMappingSha256,
  consumerProtocolsSchema,
} from "@/lib/consumer-contract/v1/identities";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import {
  internalVersionDetailSchema,
} from "../internal-versions/contracts";
import { verifyInternalVersionDetail } from "../internal-versions/integrity";

/** Only the registered consumer implementation is selectable. Engine/source facts come from the parent. */
export const createInternalPlayBindingSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.internal-play-create.v1"),
    operationKey: uuid,
    parent: internalParentVersionRefSchema,
    renderer: consumerRendererIdentitySchema,
  })
  .refine((v) => withinConsumerBytes(v, L.playRequestBytes));

/** Exact immutable asset-set rows, without filesystem paths or permission claims. */
export const internalPlayResourcesSchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-candidate-asset-set.v1"),
    productId: id,
    resources: z
      .strictObject({
        productId: id,
        resourceId: id,
        resourceVersion: version,
        blobSha256: sha,
        declarationSha256: sha,
      })
      .array()
      .min(1)
      .max(64),
  })
  .superRefine((v, ctx) => {
    if (
      v.resources.some(
        (r, i) =>
          r.productId !== v.productId ||
          (i > 0 &&
            (r.resourceId < v.resources[i - 1]!.resourceId ||
              (r.resourceId === v.resources[i - 1]!.resourceId &&
                r.resourceVersion <= v.resources[i - 1]!.resourceVersion))),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid fixed resource set." });
  });

/** Parent bytes retain the original preview identity; consumer mapping is a separate identity. */
export const internalPlaySnapshotV1Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.internal-play-snapshot.v1"),
    purpose: z.literal("internal-test"),
    publicationApproved: z.literal(false),
    parent: internalParentVersionRefSchema,
    parentSnapshot: internalVersionSnapshotV1Schema,
    renderer: consumerRendererIdentitySchema,
    mapping: consumerComponentMappingSchema,
    mappingSha256: sha,
    resources: internalPlayResourcesSchema,
    protocols: consumerProtocolsSchema,
  })
  .superRefine((v, ctx) => {
    if (
      v.parent.productId !== v.parentSnapshot.productId ||
      v.resources.productId !== v.parent.productId ||
      Object.entries(v.mapping.states).some(
        ([state, pair]) =>
          !sameConsumerFact(
            pair.source,
            v.parentSnapshot.components[state as keyof typeof v.mapping.states],
            L.playRequestBytes,
          ),
      ) ||
      !withinConsumerBytes(v, L.playSnapshotBytes)
    )
      ctx.addIssue({
        code: "custom",
        message: "Play and parent facts disagree.",
      });
  });
export const internalPlaySnapshotV2Schema = z
  .strictObject({
    ...internalPlaySnapshotV1Schema.shape,
    schemaVersion: z.literal("quizforge.internal-play-snapshot.v2"),
    parentSnapshot: internalVersionSnapshotV2Schema,
    mapping: consumerComponentMappingV2Schema,
    protocols: consumerProtocolsV2Schema,
    presentation: displayCapabilitiesV2Schema,
  })
  .superRefine((v, ctx) => {
    if (
      v.parent.productId !== v.parentSnapshot.productId ||
      v.resources.productId !== v.parent.productId ||
      Object.entries(v.mapping.states).some(
        ([state, pair]) =>
          !sameConsumerFact(
            pair.source,
            v.parentSnapshot.components[state as keyof typeof v.mapping.states],
            L.playRequestBytes,
          ),
      ) ||
      !withinConsumerBytes(v, L.playSnapshotBytes)
    )
      ctx.addIssue({
        code: "custom",
        message: "Play and parent facts disagree.",
      });
  });
export const internalPlaySnapshotSchema = z.union([
  internalPlaySnapshotV1Schema,
  internalPlaySnapshotV2Schema,
]);

export const internalPlayReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.internal-play-receipt.v1"),
    id: uuid,
    slot: z.number().int().min(1).max(L.playVersionsPerProduct),
    binding: createInternalPlayBindingSchema,
    bindingSha256: sha,
    snapshotSha256: sha,
    createdBy: uuid,
    createdAt: moment,
    purpose: z.literal("internal-test"),
    publicationApproved: z.literal(false),
  })
  .refine((v) => withinConsumerBytes(v, L.operationReceiptBytes));
export const internalPlayDetailSchema = z
  .strictObject({
    play: internalPlayReceiptSchema,
    snapshot: internalPlaySnapshotSchema,
  })
  .refine(
    (v) =>
      sameConsumerFact(
        v.play.binding.parent,
        v.snapshot.parent,
        L.playRequestBytes,
      ) &&
      sameConsumerFact(
        v.play.binding.renderer,
        v.snapshot.renderer,
        L.playRequestBytes,
      ),
  );
export const internalPlayListSchema = z
  .strictObject({
    productId: id,
    versions: internalPlayReceiptSchema.array().max(L.playVersionsPerProduct),
  })
  .refine(
    (v) =>
      withinConsumerBytes(v, L.playListResponseBytes) &&
      new Set(v.versions.map((x) => x.id)).size === v.versions.length &&
      new Set(v.versions.map((x) => x.snapshotSha256)).size ===
        v.versions.length &&
      v.versions.every(
        (x, i) =>
          x.binding.parent.productId === v.productId &&
          (i === 0 || x.slot < v.versions[i - 1]!.slot),
      ),
  );

export const internalPlayBindingText = (input: unknown) =>
  consumerCanonicalText(
    createInternalPlayBindingSchema.parse(input),
    L.playRequestBytes,
  );
export const internalPlayBindingSha256 = (input: unknown) =>
  consumerTextSha256(internalPlayBindingText(input));
export const internalPlaySnapshotText = (input: unknown) =>
  consumerCanonicalText(
    internalPlaySnapshotSchema.parse(input),
    L.playSnapshotBytes,
  );
export const internalPlaySnapshotSha256 = (input: unknown) =>
  consumerTextSha256(internalPlaySnapshotText(input));

/** Verifies supplied bytes, not registry availability, authorization, or the existence of a DB row. */
export async function verifyInternalPlayDetail(input: unknown) {
  const value = internalPlayDetailSchema.parse(input);
  const snapshot = value.snapshot;
  const [bindingHash, snapshotHash, parentHash, resourceHash, mappingHash] =
    await Promise.all([
      internalPlayBindingSha256(value.play.binding),
      internalPlaySnapshotSha256(snapshot),
      consumerTextSha256(
        consumerCanonicalText(snapshot.parentSnapshot, L.playSnapshotBytes),
      ),
      consumerTextSha256(
        consumerCanonicalText(snapshot.resources, L.playSnapshotBytes),
      ),
      consumerMappingSha256(snapshot.mapping),
    ]);
  if (
    bindingHash !== value.play.bindingSha256 ||
    snapshotHash !== value.play.snapshotSha256 ||
    parentHash !== snapshot.parent.snapshotSha256 ||
    resourceHash !== snapshot.parentSnapshot.target.assetSetSha256 ||
    mappingHash !== snapshot.mappingSha256
  )
    throw Error("INTERNAL_PLAY_CONTRACT_MISMATCH");
  return value;
}

/** The caller obtains this parent through the existing explicit, authorized product port. */
export async function verifyInternalPlayParent(
  input: unknown,
  parentInput: unknown,
) {
  const value = await verifyInternalPlayDetail(input);
  const parent = await verifyInternalVersionDetail(
    internalVersionDetailSchema.parse(parentInput),
  );
  if (
    parent.version.id !== value.snapshot.parent.versionId ||
    parent.version.snapshotSha256 !== value.snapshot.parent.snapshotSha256 ||
    !sameConsumerFact(
      parent.snapshot,
      value.snapshot.parentSnapshot,
      L.playSnapshotBytes,
    )
  )
    throw Error("INTERNAL_PLAY_PARENT_MISMATCH");
  return value;
}

export type CreateInternalPlayBinding = z.infer<
  typeof createInternalPlayBindingSchema
>;
export type InternalPlaySnapshot = z.infer<typeof internalPlaySnapshotSchema>;
export type InternalPlayReceipt = z.infer<typeof internalPlayReceiptSchema>;
export type InternalPlayDetail = z.infer<typeof internalPlayDetailSchema>;
export type InternalPlayResources = z.infer<typeof internalPlayResourcesSchema>;
