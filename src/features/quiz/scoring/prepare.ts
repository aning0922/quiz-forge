import {
  SCORING_API_LIMITS,
  SCORING_HASH_DOMAINS,
  scoringDefinitionSchema,
  scoringIdentitySchema,
  type ScoringDefinitionV1,
  type ScoringIdentity,
  type ScoringIssue,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import type { AssessmentReference as Ref } from "@/lib/assessment-contract/primitives";
import type { PreparedScoringDefinition } from "./contracts";
import {
  digest,
  failure,
  freeze,
  Issues,
  output,
  shapeFailure,
  snapshot,
} from "./boundary";

export type Compiled = Readonly<{
  definition: ScoringDefinitionV1;
  identity: ScoringIdentity;
  options: ReadonlyMap<
    string,
    Readonly<{ questionIndex: number; values: readonly number[] }>
  >;
  minima: readonly number[];
  maxima: readonly number[];
}>;
const prepared = new WeakMap<object, Compiled>();
export function compiled(
  handle: PreparedScoringDefinition,
): Compiled | undefined {
  return handle !== null &&
    (typeof handle === "object" || typeof handle === "function")
    ? prepared.get(handle)
    : undefined;
}
export const sameRef = (a: Ref, b: Ref) =>
  a.id === b.id && a.productId === b.productId && a.version === b.version;

export function prepareScoringDefinition(
  input: unknown,
): ScoringResult<PreparedScoringDefinition> {
  const copied = snapshot(
    input,
    SCORING_API_LIMITS.definitionBytes,
    "INVALID_DEFINITION",
  );
  if (!copied.ok) return copied;
  const value = copied.value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.schemaVersion === "string" &&
      record.schemaVersion !== "quiz-scoring-definition.v1"
    )
      return failure("UNSUPPORTED_LOGIC_SCHEMA", ["schemaVersion"]);
    const engine = record.engine;
    if (
      engine !== null &&
      typeof engine === "object" &&
      !Array.isArray(engine)
    ) {
      const e = engine as Record<string, unknown>;
      if (
        (typeof e.id === "string" &&
          !["dimensions", "archetype"].includes(e.id)) ||
        (typeof e.version === "string" && e.version !== "1.0.0")
      )
        return failure("UNSUPPORTED_ENGINE", ["engine"]);
    }
  }
  const parsed = scoringDefinitionSchema.safeParse(value);
  if (!parsed.success) return shapeFailure(parsed.error, "INVALID_DEFINITION");
  const d = parsed.data,
    issues = new Issues();
  function owned(ref: Ref, path: ScoringIssue["path"]) {
    if (ref.productId !== d.productId || ref.version !== d.contentVersion)
      issues.add("REFERENCE_MISMATCH", path);
  }
  function index(refs: readonly Ref[], path: ScoringIssue["path"]) {
    const map = new Map<string, Ref>();
    refs.forEach((ref, i) => {
      owned(ref, [...path, i]);
      if (map.has(ref.id)) issues.add("INVALID_DEFINITION", [...path, i, "id"]);
      map.set(ref.id, ref);
    });
    return map;
  }
  const dimensions = index(d.dimensions, ["dimensions"]);
  index(
    d.questions.map((q) => q.ref),
    ["questions"],
  );
  const results = index(d.results, ["results"]);
  function complete(
    refs: readonly Ref[],
    expected: ReadonlyMap<string, Ref>,
    path: ScoringIssue["path"],
  ) {
    const seen = new Set<string>();
    refs.forEach((ref, i) => {
      const target = expected.get(ref.id);
      if (!target || !sameRef(ref, target))
        issues.add("REFERENCE_MISMATCH", [...path, i]);
      if (seen.has(ref.id)) issues.add("INVALID_DEFINITION", [...path, i]);
      seen.add(ref.id);
    });
    if (
      seen.size !== expected.size ||
      [...expected.keys()].some((id) => !seen.has(id))
    )
      issues.add("REFERENCE_MISMATCH", path);
  }
  const optionIds = new Set<string>();
  d.questions.forEach((q, qi) => {
    q.options.forEach((o, oi) => {
      owned(o.ref, ["questions", qi, "options", oi, "ref"]);
      if (optionIds.has(o.ref.id))
        issues.add("INVALID_DEFINITION", [
          "questions",
          qi,
          "options",
          oi,
          "ref",
          "id",
        ]);
      optionIds.add(o.ref.id);
      complete(
        o.contributions.map((c) => c.dimensionRef),
        dimensions,
        ["questions", qi, "options", oi, "contributions"],
      );
    });
  });
  const rules = d.rules;
  if (d.engine.id !== rules.kind)
    issues.add("INVALID_DEFINITION", ["rules", "kind"]);
  complete(
    rules.normalization.bounds.map((b) => b.dimensionRef),
    dimensions,
    ["rules", "normalization", "bounds"],
  );
  complete(rules.resultOrder, results, ["rules", "resultOrder"]);
  complete(
    rules.profiles.map((p) => p.resultRef),
    results,
    ["rules", "profiles"],
  );
  rules.profiles.forEach((p, pi) => {
    if ("targets" in p)
      complete(
        p.targets.map((v) => v.dimensionRef),
        dimensions,
        ["rules", "profiles", pi, "targets"],
      );
    else {
      complete(
        p.ranges.map((v) => v.dimensionRef),
        dimensions,
        ["rules", "profiles", pi, "ranges"],
      );
      p.ranges.forEach((range, ri) => {
        if (range.min > range.max)
          issues.add("INVALID_DEFINITION", [
            "rules",
            "profiles",
            pi,
            "ranges",
            ri,
          ]);
      });
    }
  });
  if (issues.items.length) return issues.result();
  const options = new Map<
    string,
    { questionIndex: number; values: readonly number[] }
  >();
  const minima = d.dimensions.map(() => 0),
    maxima = [...minima];
  d.questions.forEach((q, qi) => {
    const vectors = q.options.map((o) =>
      d.dimensions.map(
        (dim) =>
          o.contributions.find((c) => c.dimensionRef.id === dim.id)!.value,
      ),
    );
    vectors.forEach((values, oi) =>
      options.set(q.options[oi]!.ref.id, freeze({ questionIndex: qi, values })),
    );
    d.dimensions.forEach((_dim, di) => {
      minima[di]! += Math.min(...vectors.map((v) => v[di]!));
      maxima[di]! += Math.max(...vectors.map((v) => v[di]!));
    });
  });
  d.dimensions.forEach((dim, di) => {
    const b = rules.normalization.bounds.find(
      (b) => b.dimensionRef.id === dim.id,
    )!;
    if (b.min !== minima[di] || b.max !== maxima[di] || b.min >= b.max)
      issues.add("INVALID_NORMALIZATION_BOUNDS", [
        "rules",
        "normalization",
        "bounds",
        rules.normalization.bounds.indexOf(b),
      ]);
  });
  if (issues.items.length) return issues.result();
  const normalized = freeze({
    ...d,
    results: rules.resultOrder.map((ref) => results.get(ref.id)!),
    questions: d.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => ({
        ...o,
        contributions: d.dimensions.map((dim) =>
          o.contributions.find((c) => c.dimensionRef.id === dim.id)!,
        ),
      })),
    })),
    rules: {
      ...rules,
      normalization: {
        ...rules.normalization,
        bounds: d.dimensions.map((dim) =>
          rules.normalization.bounds.find((b) => b.dimensionRef.id === dim.id)!,
        ),
      },
      profiles: rules.resultOrder.map((ref) => {
        const p = rules.profiles.find((p) => p.resultRef.id === ref.id)!;
        return "targets" in p
          ? {
              ...p,
              targets: d.dimensions.map((dim) =>
                p.targets.find((v) => v.dimensionRef.id === dim.id)!,
              ),
            }
          : {
              ...p,
              ranges: d.dimensions.map((dim) =>
                p.ranges.find((v) => v.dimensionRef.id === dim.id)!,
              ),
            };
      }),
    },
  }) as ScoringDefinitionV1;
  const identity = freeze({
    productId: d.productId,
    contentVersion: d.contentVersion,
    engine: d.engine,
    logicHash: digest(normalized, SCORING_HASH_DOMAINS.logic),
  });
  const handle = Object.freeze({}) as PreparedScoringDefinition;
  prepared.set(handle, {
    definition: normalized,
    identity,
    options,
    minima: Object.freeze(minima),
    maxima: Object.freeze(maxima),
  });
  return Object.freeze({ ok: true, value: handle });
}
export function readScoringIdentity(
  handle: PreparedScoringDefinition,
): ScoringResult<ScoringIdentity> {
  const c = compiled(handle);
  return c
    ? output(scoringIdentitySchema, c.identity, SCORING_API_LIMITS.scoreBytes)
    : failure("INVALID_PREPARED_DEFINITION");
}
