import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
} from "@/lib/assessment-contract/primitives";
import { failure, parseBounded } from "@/features/quiz/scoring/v2/boundary";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
import { validateCoreV3 } from "./v3-references";
import type { ContentCoreV3 } from "./v3";

const effect = z.union([-2, -1, 1, 2].map((n) => z.literal(n)));
const questionsSchema = z.object({
  assumed_scoring: z.object({
    axes: z.array(z.string()).length(5),
    core_weight: z.literal(1),
    cross_axis_weight: z.literal(0.5),
    rounding: z.literal("ties-to-even (the V0.3 demonstration baseline)"),
    formula: z.literal(
      "score_d = round_even(50 + 25 * SUM(w_q,d * effect_q,d) / SUM(w_q,d))",
    ),
  }),
  questions: z
    .array(
      z.strictObject({
        id: z.string().regex(/^Q(?:0[1-9]|[1-9][0-9]|100)$/),
        act: z.number().int().min(1).max(3),
        dimensions: z.array(z.string()).min(1).max(2),
        prompt: z.string(),
        options: z
          .array(
            z.strictObject({
              key: z.enum(["A", "B", "C", "D"]),
              text: z.string(),
              effects: z.record(z.string(), effect),
            }),
          )
          .length(4),
      }),
    )
    .length(24),
});
const personasSchema = z.object({
  model: z.object({
    dimensions: z.array(z.string()).length(5),
    raw_distance: z.literal("D=mean_d |user_score_d-role_anchor_d|"),
    ranking: z.literal("ascending D; exact tie = stable role id"),
    near_tie_threshold_raw_distance: z.literal(4),
    gender_filter: z.literal("candidate pool only, no score changes"),
  }),
  characters: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/),
        name: z.string(),
        sex: z.enum(["male", "female"]),
        kind: z.enum(["documented_historical", "legendary_literary"]),
        vector: z.array(z.number().int().min(0).max(100)).length(5),
      }),
    )
    .length(5),
});
const familiesSchema = z.object({
  family_mapping: z.record(z.string(), z.record(z.string(), z.string())),
});
const rawInputSchema = z.strictObject({
  questionsJson: z.string().max(2 * 1024 * 1024),
  personasJson: z.string().max(2 * 1024 * 1024),
  familiesJson: z.string().max(2 * 1024 * 1024),
  productId: assessmentIdSchema,
  version: assessmentVersionSchema,
  title: z.string().min(1).max(4000),
});
/** A finite import profile, not an executor for the scripts bundled with research. */
export function convertEditorialV05(input: unknown): V2Result<ContentCoreV3> {
  const envelope = parseBounded(rawInputSchema, input, "SOURCE_MISMATCH");
  if (!envelope.ok) return envelope;
  const raw = envelope.value;
  let qj: unknown, pj: unknown, fj: unknown;
  try {
    qj = JSON.parse(raw.questionsJson);
    pj = JSON.parse(raw.personasJson);
    fj = JSON.parse(raw.familiesJson);
  } catch {
    return failure("SOURCE_MISMATCH");
  }
  const questions = parseBounded(questionsSchema, qj, "SOURCE_MISMATCH");
  const personas = parseBounded(personasSchema, pj, "SOURCE_MISMATCH");
  const families = parseBounded(familiesSchema, fj, "SOURCE_MISMATCH");
  if (!questions.ok) return questions;
  if (!personas.ok) return personas;
  if (!families.ok) return families;
  const axes = questions.value.assumed_scoring.axes;
  if (
    new Set(axes).size !== axes.length ||
    axes.some((a, i) => a !== personas.value.model.dimensions[i])
  )
    return failure("SOURCE_MISMATCH");
  const ref = (id: string) => ({
    id,
    productId: raw.productId,
    version: raw.version,
  });
  const dimRefs = axes.map((_, i) => ref(`axis-${i + 1}`));
  const qs = questions.value.questions;
  const characters = personas.value.characters;
  const resultIds = characters.map((c) => c.id.replaceAll("_", "-"));
  if (
    new Set(resultIds).size !== characters.length ||
    characters.some((c) => !/^[a-z][a-z0-9_]{0,79}$/.test(c.id)) ||
    new Set(qs.map((q) => q.id)).size !== qs.length ||
    qs.some(
      (q, i) =>
        q.id !== `Q${String(i + 1).padStart(2, "0")}` ||
        q.act !== Math.floor(i / 8) + 1 ||
        q.dimensions.length !== (i < 20 ? 1 : 2) ||
        new Set(q.dimensions).size !== q.dimensions.length ||
        q.dimensions.some((a) => !axes.includes(a)) ||
        new Set(q.options.map((o) => o.key)).size !== 4 ||
        q.options.some(
          (o) =>
            Object.keys(o.effects).length !== q.dimensions.length ||
            q.dimensions.some((a) => o.effects[a] === undefined),
        ),
    )
  )
    return failure("SOURCE_MISMATCH");
  const scoringQuestions = qs.map((q) => ({
    ref: ref(q.id.toLowerCase()),
    options: q.options.map((o) => ({
      ref: ref(`${q.id.toLowerCase()}-${o.key.toLowerCase()}`),
      contributions: dimRefs.map((dimensionRef, i) => ({
        dimensionRef,
        value: (o.effects[axes[i]!] ?? 0) * (q.dimensions.length === 1 ? 2 : 1),
      })),
    })),
  }));
  const entries: ContentCoreV3["evidenceFamilies"]["entries"] = [];
  for (const q of qs) {
    const mapping = families.value.family_mapping[q.id];
    if (!mapping || Object.keys(mapping).length !== q.dimensions.length)
      return failure("SOURCE_MISMATCH");
    for (const axis of q.dimensions) {
      const family = mapping[axis];
      if (!family) return failure("SOURCE_MISMATCH");
      entries.push({
        questionRef: ref(q.id.toLowerCase()),
        dimensionRef: dimRefs[axes.indexOf(axis)]!,
        family,
        core: q.dimensions.length === 1,
      });
    }
  }
  if (Object.keys(families.value.family_mapping).length !== qs.length)
    return failure("SOURCE_MISMATCH");
  const provenance = (["questions", "personas", "families"] as const).map(
    (kind) => ({
      kind,
      sha256: createHash("sha256")
        .update(raw[`${kind}Json`], "utf8")
        .digest("hex"),
    }),
  );
  return validateCoreV3({
    schemaVersion: "quizpack-core.v3",
    title: raw.title,
    scoringDefinition: {
      schemaVersion: "quiz-scoring-definition.v2",
      productId: raw.productId,
      contentVersion: raw.version,
      engine: { id: "archetype-l1", version: "1.0.0" },
      dimensions: dimRefs.map((r, di) => ({
        ref: r,
        min: scoringQuestions.reduce(
          (n, q) =>
            n + Math.min(...q.options.map((o) => o.contributions[di]!.value)),
          0,
        ),
        max: scoringQuestions.reduce(
          (n, q) =>
            n + Math.max(...q.options.map((o) => o.contributions[di]!.value)),
          0,
        ),
      })),
      questions: scoringQuestions,
      profiles: characters.map((c, i) => ({
        resultRef: ref(resultIds[i]!),
        stableRankKey: c.id,
        sex: c.sex,
        kind:
          c.kind === "documented_historical"
            ? "documented-historical"
            : "literary-legendary",
        targets: dimRefs.map((dimensionRef, di) => ({
          dimensionRef,
          value: c.vector[di],
        })),
      })),
      matchingPolicy: {
        ref: ref("target-pool"),
        allowedKinds: ["documented-historical", "literary-legendary"],
      },
      rules: {
        normalization: "linear-to-0-100",
        rounding: "ties-to-even-integer",
        distance: "mean-l1",
        tieBreak: "stable-rank-key-ascii",
        nearTieMeanGap: 4,
        index: "clamp-round-even-100-minus-1.5-distance",
      },
    },
    dimensions: dimRefs.map((r, i) => ({ ref: r, label: axes[i] })),
    questions: qs.map((q) => ({
      ref: ref(q.id.toLowerCase()),
      prompt: q.prompt,
      act: q.act,
      options: q.options.map((o) => ({
        ref: ref(`${q.id.toLowerCase()}-${o.key.toLowerCase()}`),
        label: o.text,
      })),
    })),
    results: characters.map((c, i) => ({
      ref: ref(resultIds[i]!),
      label: c.name,
    })),
    evidenceFamilies: { version: raw.version, entries },
    provenance,
  });
}
