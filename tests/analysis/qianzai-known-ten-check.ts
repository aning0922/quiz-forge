/** Bounded integration check. Reuses prior deterministic synthetic inputs and
 * witnesses; no new profile-directed search, DB, model call or source admission. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { canonicalP1Json } from "../../src/features/quizpack/v1/canonical";
import { scoringDefinitionV2Schema } from "../../src/lib/assessment-contract/scoring-v2";
import {
  prepareScoringV2,
  scoreCompleteAnswersV2,
} from "../../src/features/quiz/scoring/v2";
import { qianzaiKnownScoringDefinition } from "../../src/features/report/qianzai-tongxin/known-ten-scoring";
import { QIANZAI_KNOWN_TEN_ROLES } from "../../src/features/report/qianzai-tongxin/known-ten-catalog";
import registration from "../../src/features/quizpack/content/private-test-registration-final-e2e.json";
const [sourceFile, priorFile, out] = process.argv.slice(2);
assert(
  [sourceFile, priorFile, out].every((p) => p && path.isAbsolute(p)),
  "three absolute paths required",
);
const source = JSON.parse(await readFile(sourceFile!, "utf8")),
  prior = JSON.parse(await readFile(priorFile!, "utf8"));
const hash = (x: unknown) =>
  createHash("sha256").update(canonicalP1Json(x)).digest("hex");
assert.equal(hash(source), registration.canonicalContentSha256);
assert.equal(prior.sourceHash, registration.canonicalContentSha256);
const original = scoringDefinitionV2Schema.parse(source.core.scoringDefinition),
  definition = qianzaiKnownScoringDefinition(original);
assert.deepEqual(definition.questions, original.questions);
assert.deepEqual(definition.dimensions, original.dimensions);
assert.deepEqual(definition.matchingPolicy, original.matchingPolicy);
assert.equal(original.questions.length, 24);
assert.equal(definition.profiles.length, QIANZAI_KNOWN_TEN_ROLES.length);
type Answers = { questionId: string; optionId: string }[];
const inputs = new Map<string, { answers: Answers; origin: string }>();
const add = (answers: Answers, origin: string) => {
  const k = canonicalP1Json(answers);
  if (!inputs.has(k)) inputs.set(k, { answers, origin });
};
const indices = (a: number[], origin: string) =>
  add(
    original.questions.map((q, i) => ({
      questionId: q.ref.id,
      optionId: q.options[a[i]!]!.ref.id,
    })),
    origin,
  );
let seed = 0x51465a10;
const random = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
};
for (let i = 0; i < 4096; i++)
  indices(
    original.questions.map((q) => (random() >>> 10) % q.options.length),
    "prior-seeded-uniform-options",
  );
for (let i = 0; i < 243; i++) {
  let v = i;
  const directions = original.dimensions.map(() => {
    const n = (v % 3) - 1;
    v = Math.floor(v / 3);
    return n;
  });
  indices(
    original.questions.map((q) => {
      const values = q.options.map((o) =>
        o.contributions.reduce((n, c, j) => n + c.value * directions[j]!, 0),
      );
      return values.indexOf(Math.max(...values));
    }),
    "prior-fixed-axis-directions",
  );
}
for (const r of prior.records)
  for (const pref of r.preferences)
    for (const w of Object.values(pref.witnesses) as { answers: Answers }[])
      add(w.answers, "prior-recorded-witness");
for (const w of source.bindings.witnesses.entries)
  add(w.answers, "existing-authored-witness");
const prepared = prepareScoringV2(definition);
assert(prepared.ok);
const records = [];
let dimensionDigest: string | undefined;
for (const preference of ["male", "female", "any"] as const) {
  const wins: Record<string, number> = {},
    witnesses: Record<string, unknown> = {},
    pairs: Record<string, number> = {};
  let near = 0,
    ties = 0;
  const dimensions = createHash("sha256");
  for (const input of inputs.values()) {
    const result = scoreCompleteAnswersV2(prepared.value, {
      schemaVersion: "quiz-scoring-input.v2",
      answers: input.answers,
      matchingContext: {
        schemaVersion: "quiz-matching-context.v1",
        policyRef: definition.matchingPolicy.ref,
        preference,
      },
    });
    assert(result.ok);
    const score = result.value,
      decision = score.decision,
      id = decision.selectedResultRef.id;
    assert(
      QIANZAI_KNOWN_TEN_ROLES.some(
        (r) => r.id === id && (preference === "any" || r.sex === preference),
      ),
    );
    dimensions.update(canonicalP1Json(score.dimensions));
    wins[id] = (wins[id] ?? 0) + 1;
    if (decision.status === "near-tie") near++;
    if (decision.gapTotal === 0) ties++;
    const pair = id + " > " + (decision.runnerUpResultRef?.id ?? "none");
    pairs[pair] = (pairs[pair] ?? 0) + 1;
    witnesses[id] ??= {
      origin: input.origin,
      answers: input.answers,
      inputHash: score.inputHash,
      status: decision.status,
      gapTotal: decision.gapTotal,
      dimensionScores: score.dimensions.map((d) => d.score),
    };
  }
  const digest = dimensions.digest("hex");
  if (dimensionDigest) assert.equal(digest, dimensionDigest);
  else dimensionDigest = digest;
  const eligible = QIANZAI_KNOWN_TEN_ROLES.filter(
    (r) => preference === "any" || r.sex === preference,
  ).map((r) => r.id);
  records.push({
    preference,
    eligible,
    wins,
    notObserved: eligible.filter((id) => !wins[id]),
    nearTieCount: near,
    exactTieCount: ties,
    topRunnerPairs: Object.entries(pairs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
    witnesses,
    dimensionDigest: digest,
  });
}
const profileDistances = definition.profiles
  .flatMap((a, i) =>
    definition.profiles
      .slice(i + 1)
      .filter((b) => a.sex === b.sex)
      .map((b) => ({
        a: a.resultRef.id,
        b: b.resultRef.id,
        l1: a.targets.reduce(
          (sum, t, j) => sum + Math.abs(t.value - b.targets[j]!.value),
          0,
        ),
      })),
  )
  .sort((a, b) => a.l1 - b.l1);
const receipt = {
  scope:
    "bounded fixed synthetic set; real scoring engine; not exhaustive or production acceptance",
  sourceSha256: hash(source),
  catalogueSha256: hash(QIANZAI_KNOWN_TEN_ROLES),
  definitionSha256: hash(definition),
  inputSetSha256: (() => {
    const digest = createHash("sha256");
    for (const input of inputs.values())
      digest.update(canonicalP1Json(input.answers) + "\n");
    return digest.digest("hex");
  })(),
  inputSetDigestFormat: "ordered canonical answer arrays followed by LF",
  sampleCount: inputs.size,
  questionsAndPolicyUnchanged: true,
  allPreferencesHaveIdenticalDimensions: true,
  newSearch: false,
  profileDistances,
  records,
};
await writeFile(out!, JSON.stringify(receipt, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify(
    {
      sampleCount: inputs.size,
      catalogueSha256: receipt.catalogueSha256,
      records: records.map((r) => ({
        preference: r.preference,
        wins: r.wins,
        notObserved: r.notObserved,
        nearTieCount: r.nearTieCount,
        exactTieCount: r.exactTieCount,
        topRunnerPairs: r.topRunnerPairs,
      })),
      profileDistances: profileDistances.slice(0, 5),
    },
    null,
    2,
  ),
);
