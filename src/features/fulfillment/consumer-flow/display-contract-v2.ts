import { z } from "zod";
import { displayEntryBodyV2Schema } from "@/lib/assessment-contract/display-v2";
import {
  consumerSessionRefSchema,
  internalParentVersionRefSchema,
  consumerIdSchema,
  consumerSha256Schema,
} from "@/lib/consumer-contract/v1/primitives";
import { consumerRendererIdentitySchema } from "@/lib/consumer-contract/v1/identities";
import {
  consumerFontIdentityV2Schema,
  consumerComponentMappingV2Schema,
  consumerMappingSha256V2,
} from "@/lib/consumer-contract/v2/identities";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

/** A selected, neutral projection. Never embed parentSnapshot, weights or candidate reports here. */
export const consumerEntryFactsV2Schema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-entry.v2"),
    session: consumerSessionRefSchema,
    parent: internalParentVersionRefSchema,
    renderer: consumerRendererIdentitySchema,
    font: consumerFontIdentityV2Schema,
    mapping: consumerComponentMappingV2Schema,
    mappingSha256: consumerSha256Schema,
    entry: displayEntryBodyV2Schema,
  })
  .refine(
    (v) =>
      v.session.productId === v.parent.productId &&
      v.entry.product.productId === v.session.productId &&
      new Set(v.entry.questions.map((q) => q.ref.id)).size ===
        v.entry.questions.length &&
      v.entry.questions.every(
        (q) =>
          consumerIdSchema.safeParse(q.ref.id).success &&
          q.options.every((o) => consumerIdSchema.safeParse(o.ref.id).success),
      ) &&
      withinConsumerBytes(v, L.entryResponseBytes),
  );
export const consumerEntryViewV2Schema = z
  .strictObject({
    facts: consumerEntryFactsV2Schema,
    factsSha256: consumerSha256Schema,
  })
  .refine((v) => withinConsumerBytes(v, L.entryResponseBytes));
export const consumerEntryFactsTextV2 = (input: unknown) =>
  consumerCanonicalText(
    consumerEntryFactsV2Schema.parse(input),
    L.entryResponseBytes,
  );
export const consumerEntryFactsSha256V2 = (input: unknown) =>
  consumerTextSha256(consumerEntryFactsTextV2(input));
export async function verifyConsumerEntryViewV2(
  input: unknown,
  expectedSession: unknown,
) {
  const v = consumerEntryViewV2Schema.parse(input);
  if (
    !sameConsumerFact(
      v.facts.session,
      consumerSessionRefSchema.parse(expectedSession),
      L.operationRequestBytes,
    ) ||
    (await consumerEntryFactsSha256V2(v.facts)) !== v.factsSha256 ||
    (await consumerMappingSha256V2(v.facts.mapping)) !== v.facts.mappingSha256
  )
    throw Error("CONSUMER_ENTRY_MISMATCH");
  return v;
}
export type ConsumerEntryViewV2 = z.infer<typeof consumerEntryViewV2Schema>;
