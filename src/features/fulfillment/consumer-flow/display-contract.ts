import { z } from "zod";
import { displayEntryBodyV1Schema } from "@/lib/assessment-contract/display-v1";
import {
  consumerSessionRefSchema,
  internalParentVersionRefSchema,
  consumerIdSchema,
  consumerVersionSchema,
  consumerSha256Schema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerRendererIdentitySchema,
  consumerFontIdentitySchema,
  consumerComponentMappingSchema,
  consumerMappingSha256,
} from "@/lib/consumer-contract/v1/identities";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

/** A selected, neutral projection. Never embed parentSnapshot, weights or candidate reports here. */
export const consumerEntryFactsSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-entry.v1"),
    session: consumerSessionRefSchema,
    parent: internalParentVersionRefSchema,
    renderer: consumerRendererIdentitySchema,
    font: consumerFontIdentitySchema,
    mapping: consumerComponentMappingSchema,
    mappingSha256: consumerSha256Schema,
    entry: displayEntryBodyV1Schema,
  })
  .refine(
    (v) =>
      v.session.productId === v.parent.productId &&
      v.entry.product.productId === v.session.productId &&
      new Set(v.entry.questions.map((q) => q.id)).size ===
        v.entry.questions.length &&
      v.entry.questions.every(
        (q) =>
          consumerIdSchema.safeParse(q.id).success &&
          q.options.every((o) => consumerIdSchema.safeParse(o.id).success),
      ) &&
      (["cover", "question", "resume"] as const).every((state) =>
        sameConsumerFact(
          v.mapping.states[state].source,
          v.entry.layouts[state].component,
          L.operationRequestBytes,
        ),
      ) &&
      withinConsumerBytes(v, L.entryResponseBytes),
  );
export const consumerEntryViewSchema = z
  .strictObject({
    facts: consumerEntryFactsSchema,
    factsSha256: consumerSha256Schema,
  })
  .refine((v) => withinConsumerBytes(v, L.entryResponseBytes));
export const consumerEntryFactsText = (input: unknown) =>
  consumerCanonicalText(
    consumerEntryFactsSchema.parse(input),
    L.entryResponseBytes,
  );
export const consumerEntryFactsSha256 = (input: unknown) =>
  consumerTextSha256(consumerEntryFactsText(input));
export async function verifyConsumerEntryView(
  input: unknown,
  expectedSession: unknown,
) {
  const v = consumerEntryViewSchema.parse(input);
  if (
    !sameConsumerFact(
      v.facts.session,
      consumerSessionRefSchema.parse(expectedSession),
      L.operationRequestBytes,
    ) ||
    (await consumerEntryFactsSha256(v.facts)) !== v.factsSha256 ||
    (await consumerMappingSha256(v.facts.mapping)) !== v.facts.mappingSha256
  )
    throw Error("CONSUMER_ENTRY_MISMATCH");
  return v;
}
/** Selector only. The service authorizes against the session's neutral or final selected allowlist. */
export const consumerResourceSelectorSchema = z.strictObject({
  resourceId: consumerIdSchema,
  resourceVersion: consumerVersionSchema,
  sha256: consumerSha256Schema,
});
export type ConsumerEntryView = z.infer<typeof consumerEntryViewSchema>;
export type ConsumerResourceSelector = z.infer<
  typeof consumerResourceSelectorSchema
>;
