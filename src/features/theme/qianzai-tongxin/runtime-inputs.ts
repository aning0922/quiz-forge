import { z } from "zod";
import inputs from "./runtime-inputs.json";
import { displayAssetV2Schema } from "@/lib/assessment-contract/display-v2";
import { rendererImplementationDescriptorSchema } from "@/features/product/internal-versions/implementation-schema";

const slot = z.union([
  z.enum(["cover", "preferenceScene", "reportPaper", "reportBorder", "seal"]),
  z.templateLiteral([
    "acts.",
    z.union([z.literal(0), z.literal(1), z.literal(2)]),
    ".",
    z.enum(["background", "questionPaper", "optionIdle", "optionSelected"]),
  ]),
  z.templateLiteral([
    "character.",
    z.enum(["reveal", "nameArt", "report", "poster"]),
  ]),
  z.enum([
    "character.revealComposite.before",
    "character.revealComposite.full",
  ]),
]);
const binding = z.strictObject({
  asset: displayAssetV2Schema.omit({ alt: true }),
  slot,
  layer: z.enum([
    "clean",
    "prototype-scene-base",
    "prototype-option-skin",
    "role-composite",
  ]),
});
export const qianzaiRuntimeInputsSchema = z.strictObject({
  schemaVersion: z.literal("qianzai-runtime-inputs.v1"),
  font: rendererImplementationDescriptorSchema.shape.font.nullable(),
  resources: z.array(binding).max(64),
});
/** Fixed expected facts are selectors, not proof that native admission/approval occurred.
 * Alt text is taken unchanged from the verified view; no wildcard product or inferred role. */
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const QIANZAI_RUNTIME_INPUTS = freeze(
  qianzaiRuntimeInputsSchema.parse(inputs),
);
