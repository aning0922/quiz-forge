import {
  scoringDefinitionV2Schema,
  type ScoringDefinitionV2,
} from "@/lib/assessment-contract/scoring-v2";
import type { V2Result } from "@/lib/assessment-contract/scoring-api-v2";
import { digestV2, failure, freeze, parseBounded, refKey } from "./boundary";

declare const preparedIdentity: unique symbol;
export type PreparedScoringV2 = Readonly<{ [preparedIdentity]: true }>;
type Fixed = { definition: ScoringDefinitionV2; logicHash: string };
const issued = new WeakMap<object, Fixed>();
export function readFixedV2(handle: PreparedScoringV2) {
  return handle !== null && typeof handle === "object"
    ? issued.get(handle)
    : undefined;
}
export function prepareScoringV2(input: unknown): V2Result<PreparedScoringV2> {
  const parsed = parseBounded(
    scoringDefinitionV2Schema,
    input,
    "INVALID_DEFINITION",
  );
  if (!parsed.ok) return parsed;
  const d = parsed.value;
  const own = (r: { productId: string }) => r.productId === d.productId;
  const dimensions = new Set(d.dimensions.map((v) => refKey(v.ref)));
  const exactDimensions = (
    values: {
      dimensionRef: ScoringDefinitionV2["dimensions"][number]["ref"];
    }[],
  ) =>
    values.length === dimensions.size &&
    new Set(values.map((v) => refKey(v.dimensionRef))).size ===
      dimensions.size &&
    values.every((v) => dimensions.has(refKey(v.dimensionRef)));
  const uniqueIds = (refs: { id: string }[]) =>
    new Set(refs.map((r) => r.id)).size === refs.length;
  if (
    dimensions.size !== d.dimensions.length ||
    !uniqueIds(d.dimensions.map((v) => v.ref)) ||
    !uniqueIds(d.questions.map((v) => v.ref)) ||
    !uniqueIds(d.questions.flatMap((q) => q.options.map((o) => o.ref))) ||
    !uniqueIds(d.profiles.map((v) => v.resultRef)) ||
    new Set(d.profiles.map((p) => p.stableRankKey)).size !==
      d.profiles.length ||
    new Set(d.matchingPolicy.allowedKinds).size !==
      d.matchingPolicy.allowedKinds.length ||
    !own(d.matchingPolicy.ref) ||
    d.dimensions.some((v) => !own(v.ref)) ||
    d.questions.some(
      (q) =>
        !own(q.ref) ||
        q.options.some((o) => !own(o.ref) || !exactDimensions(o.contributions)),
    ) ||
    d.profiles.some((p) => !own(p.resultRef) || !exactDimensions(p.targets))
  )
    return failure("REFERENCE_MISMATCH");
  for (const dimension of d.dimensions) {
    const values = d.questions.map((q) =>
      q.options.map(
        (o) =>
          o.contributions.find(
            (c) => refKey(c.dimensionRef) === refKey(dimension.ref),
          )!.value,
      ),
    );
    const min = values.reduce((sum, v) => sum + Math.min(...v), 0);
    const max = values.reduce((sum, v) => sum + Math.max(...v), 0);
    if (dimension.min !== min || dimension.max !== max || min >= max)
      return failure("INVALID_NORMALIZATION_BOUNDS");
  }
  const handle = Object.freeze({}) as PreparedScoringV2;
  issued.set(handle, {
    definition: d,
    logicHash: digestV2("quiz-logic.v2", d),
  });
  return freeze({ ok: true, value: handle });
}
export function readScoringIdentityV2(handle: PreparedScoringV2) {
  const fixed = readFixedV2(handle);
  return fixed
    ? freeze({
        ok: true as const,
        value: { logicHash: fixed.logicHash, engine: fixed.definition.engine },
      })
    : failure("INVALID_PREPARED_DEFINITION");
}
