import { z } from "zod";
import { baselineDescriptorSchema } from "./baseline-registry";
import { fixedDisplayComponentsV3Schema } from "./identity-contracts";
import { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import {
  presentationSlotsV3Schema,
  neutralSlotRefsV3,
  characterSlotRefsV3,
} from "@/lib/assessment-contract/presentation-v3";

const { presentationEdges: omitted, ...common } =
  baselineDescriptorSchema.shape;
void omitted;
export const baselineDescriptorV2Schema = z
  .strictObject({
    ...common,
    schemaVersion: z.literal("quizforge.baseline-registry-entry.v2"),
    contentSchemaVersion: z.literal("quizpack-content.v3"),
    engine: engineDeclarationV2Schema,
    components: fixedDisplayComponentsV3Schema,
    slots: presentationSlotsV3Schema,
  })
  .superRefine((value, ctx) => {
    const reject = () =>
      ctx.addIssue({ code: "custom", message: "Invalid trusted v3 baseline." });
    if (
      new Set(value.allowedInstancePurposes).size !==
      value.allowedInstancePurposes.length
    )
      reject();
    if (
      value.approval.kind === "synthetic-test" &&
      (value.sourceEvidence.kind !== "synthetic-definition" ||
        value.allowedInstancePurposes.includes("demo"))
    )
      reject();
    if (
      value.approval.kind === "author-baseline" &&
      value.sourceEvidence.kind !== "author-mapping"
    )
      reject();
    if (
      value.approval.kind === "private-test-only" &&
      (value.allowedInstancePurposes.length !== 1 ||
        value.allowedInstancePurposes[0] !== "test" ||
        value.sourceEvidence.kind !== "private-test-definition")
    )
      reject();
    const key = (r: { id: string; version: string }) =>
      JSON.stringify([r.id, r.version]);
    const resources = new Map(
      value.resourceEdges.map((r) => [
        key({ id: r.resourceId, version: r.version }),
        r,
      ]),
    );
    if (resources.size !== value.resourceEdges.length) reject();
    const check = (
      r: { productId: string; id: string; version: string },
      purpose: string,
    ) => {
      if (
        r.productId !== value.productId ||
        resources.get(key(r))?.purpose !== purpose
      )
        reject();
    };
    for (const ref of neutralSlotRefsV3(value.slots))
      check(
        ref,
        key(ref) === key(value.slots.neutral.cover) ? "cover" : "decoration",
      );
    for (const c of value.slots.characters) {
      if (c.resultRef.productId !== value.productId) reject();
      for (const ref of characterSlotRefsV3(c))
        check(
          ref,
          [
            c.nameArt,
            ...(c.revealComposite
              ? [c.revealComposite.before, c.revealComposite.full]
              : []),
          ].some((decoration) => key(ref) === key(decoration))
            ? "decoration"
            : "portrait",
        );
    }
    const pixels = new Map<string, (typeof value.resourceEdges)[number]>();
    for (const edge of value.resourceEdges) {
      const old = pixels.get(edge.sha256);
      if (
        old &&
        (old.bytes !== edge.bytes ||
          old.mediaType !== edge.mediaType ||
          old.width !== edge.width ||
          old.height !== edge.height)
      )
        reject();
      pixels.set(edge.sha256, edge);
    }
    if ([...pixels.values()].reduce((n, r) => n + r.bytes, 0) > 33_554_432)
      reject();
  });
export type BaselineDescriptorV2 = z.infer<typeof baselineDescriptorV2Schema>;
