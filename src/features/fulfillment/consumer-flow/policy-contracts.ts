import { z } from "zod";
import {
  consumerSessionRefSchema,
  consumerSha256Schema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerSaveBindingSchema,
  consumerSaveBindingSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerSaveBindingV2Schema,
  consumerSaveBindingSha256V2,
  consumerCompleteBindingV2Schema,
  consumerCompleteBindingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerCompleteBindingSchema,
  consumerCompleteBindingSha256,
} from "@/features/report/persisted/view-contracts";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";

const generation = z.number().int().min(0).max(2147483647);
export const consumerPolicyOutcomeSchemas = [
  z
    .strictObject({
      kind: z.literal("version-superseded"),
      session: consumerSessionRefSchema,
      attemptGeneration: generation,
      currentGeneration: generation.min(1),
      requiresReexchange: z.literal(true),
    })
    .refine((v) => v.currentGeneration > v.attemptGeneration),
  z.strictObject({
    kind: z.literal("entitlement-completed"),
    session: consumerSessionRefSchema,
    requiresReexchange: z.literal(true),
  }),
] as const;
export const consumerPolicyOutcomeSchema = z.union(
  consumerPolicyOutcomeSchemas,
);
const bindingSchema = z.union([
  consumerSaveBindingSchema,
  consumerSaveBindingV2Schema,
  consumerCompleteBindingSchema,
  consumerCompleteBindingV2Schema,
]);
export const consumerPolicyResolutionSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.consumer-policy-resolution.v1"),
    binding: bindingSchema,
    bindingSha256: consumerSha256Schema,
    outcome: consumerPolicyOutcomeSchema,
    kind: z.enum(["version-superseded", "entitlement-completed"]),
  })
  .refine(
    (v) =>
      v.kind === v.outcome.kind &&
      sameConsumerFact(v.binding.session, v.outcome.session, 4096),
  );
export type ConsumerPolicyResolution = z.infer<
  typeof consumerPolicyResolutionSchema
>;
export async function consumerPolicyBindingSha256(
  binding: z.infer<typeof bindingSchema>,
) {
  switch (binding.schemaVersion) {
    case "quizforge.consumer-save.v1":
      return consumerSaveBindingSha256(binding);
    case "quizforge.consumer-save.v2":
      return consumerSaveBindingSha256V2(binding);
    case "quizforge.consumer-complete.v1":
      return consumerCompleteBindingSha256(binding);
    case "quizforge.consumer-complete.v2":
      return consumerCompleteBindingSha256V2(binding);
  }
}
export async function verifyConsumerPolicyResolution(
  input: unknown,
  expected: unknown,
) {
  const v = consumerPolicyResolutionSchema.parse(input),
    binding = bindingSchema.parse(expected);
  if (
    !sameConsumerFact(v.binding, binding, 16384) ||
    v.bindingSha256 !== (await consumerPolicyBindingSha256(binding))
  )
    throw Error("CONSUMER_RESOLUTION_MISMATCH");
  return v;
}
