import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import review from "../../../src/features/quiz/scoring/fixtures/historical-review.json";
import {
  authoringReviewSchema,
  scoringSourceBindingSchema,
} from "../../../src/lib/assessment-contract/authoring-review-v1";
import {
  scoringIdentitySchema,
  scoreSnapshotSchema,
  witnessEvidenceSchema,
  coverageEvidenceSchema,
} from "../../../src/lib/assessment-contract/scoring-api-v1";
import {
  prepareScoringDefinition,
  readScoringIdentity,
  scoreCompleteAnswers,
  verifyDeclaredWitnesses,
  analyzeDimensionsCoverage,
} from "../../../src/features/quiz/scoring/index";
import {
  coverageStress,
  largeDenominatorDefinition,
} from "../../../src/features/quiz/scoring/fixtures/stress";
const good = <T>(
  r: { ok: true; value: T } | { ok: false; issues: unknown },
): T => {
  if (!r.ok) throw new Error("CAPTURE_FAILED");
  return r.value;
};
const implementationCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const checked = authoringReviewSchema.parse(review);
const prepared = good(prepareScoringDefinition(checked.definition));
const artifact = z
  .strictObject({
    schemaVersion: z.literal("quiz-authoring-execution.v1"),
    status: z.literal("authored-pending"),
    implementationCommit: z.string().regex(/^[a-f0-9]{40}$/),
    sourceBinding: scoringSourceBindingSchema,
    identity: scoringIdentitySchema,
    witnessEvidence: witnessEvidenceSchema,
    scores: z.array(scoreSnapshotSchema).length(4),
  })
  .parse({
    schemaVersion: "quiz-authoring-execution.v1",
    status: "authored-pending",
    implementationCommit,
    sourceBinding: {
      kind: "authoring-review",
      source: checked.source,
      transcriptionSha256: checked.transcriptionSha256,
    },
    identity: good(readScoringIdentity(prepared)),
    witnessEvidence: good(verifyDeclaredWitnesses(prepared, checked.witnesses)),
    scores: checked.witnesses.entries.map((e) =>
      good(scoreCompleteAnswers(prepared, e.answers)),
    ),
  });
const encoded = JSON.stringify(artifact, null, 2) + "\n";
if (Buffer.byteLength(encoded) > 2097152)
  throw new Error("CAPTURE_OUTPUT_LIMIT");
await writeFile("docs/qa/p3a-scoring/historical-execution.json", encoded);
const measurements = [];
for (const kind of ["frontier", "transitions", "comparisons"] as const) {
  global.gc?.();
  const def = coverageStress(kind);
  const prepared = good(prepareScoringDefinition(def));
  global.gc?.();
  const before = process.memoryUsage();
  const start = performance.now();
  const report = coverageEvidenceSchema.parse(
    good(analyzeDimensionsCoverage(prepared)),
  );
  const elapsedMs = performance.now() - start;
  const after = process.memoryUsage();
  measurements.push({
    model: kind,
    elapsedMs,
    heapUsedBefore: before.heapUsed,
    heapUsedAfter: after.heapUsed,
    rssBefore: before.rss,
    rssAfter: after.rss,
    processMaxRssKiB: process.resourceUsage().maxRSS,
    report,
  });
}
global.gc?.();
const d = largeDenominatorDefinition();
const h = good(prepareScoringDefinition(d));
const start = performance.now();
const score = good(
  scoreCompleteAnswers(
    h,
    d.questions.map((q, i) => ({
      questionId: q.ref.id,
      optionId: q.options[i % 3 === 0 ? 1 : 0]!.ref.id,
    })),
  ),
);
const large = {
  elapsedMs: performance.now() - start,
  definitionWireBytes: Buffer.byteLength(JSON.stringify(d)),
  scoreWireBytes: Buffer.byteLength(JSON.stringify(score)),
  distanceDigitLengths:
    score.decision.kind === "archetype"
      ? score.decision.distances.map((v) => ({
          numerator: v.value.numerator.length,
          denominator: v.value.denominator.length,
        }))
      : [],
};
await writeFile(
  "docs/qa/p3a-scoring/bounded-workload-measurements.json",
  JSON.stringify(
    {
      schemaVersion: "quiz-scoring-measurements.v1",
      implementationCommit,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      method:
        "single local run; explicit GC before runs; elapsed and heap/RSS observations, process maxRSS is a cumulative high-water observation; no OS isolation claim",
      measurements,
      largeDenominator: large,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    implementationCommit,
    logicHash: artifact.identity.logicHash,
    witnessesHash: artifact.witnessEvidence.witnessesHash,
    transcriptionSha256: checked.transcriptionSha256,
    fullEvidenceWireBytes: Buffer.byteLength(encoded),
    measurements: measurements.map((m) => ({
      model: m.model,
      elapsedMs: m.elapsedMs,
      status: m.report.status,
      stats: m.report.stats,
    })),
    large,
  }),
);
