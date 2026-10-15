import {
  SCORING_API_LIMITS,
  SCORING_HASH_DOMAINS,
  WITNESS_POLICY,
  WITNESS_POLICY_HASH,
  witnessInputSchema,
  witnessEvidenceSchema,
  type WitnessInputV1,
  type WitnessEvidenceV1,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import type { PreparedScoringDefinition } from "./contracts";
import { compiled, sameRef } from "./prepare";
import { digest, failure, output, shapeFailure, snapshot } from "./boundary";
import { normalizeAnswers, scoreCompleteAnswers } from "./score";

export function verifyDeclaredWitnesses(
  handle: PreparedScoringDefinition,
  input: unknown,
): ScoringResult<WitnessEvidenceV1> {
  const c = compiled(handle);
  if (!c) return failure("INVALID_PREPARED_DEFINITION");
  const copied = snapshot(
    input,
    SCORING_API_LIMITS.witnessesBytes,
    "INVALID_WITNESS_SET",
  );
  if (!copied.ok) return copied;
  const parsed = witnessInputSchema.safeParse(copied.value);
  if (!parsed.success) return shapeFailure(parsed.error, "INVALID_WITNESS_SET");
  const seen = new Set<string>();
  for (const [i, entry] of parsed.data.entries.entries()) {
    const ref = c.definition.results.find(
      (r) => r.id === entry.expectedResultRef.id,
    );
    if (!ref || !sameRef(ref, entry.expectedResultRef) || seen.has(ref.id))
      return failure("INVALID_WITNESS_SET", [
        "entries",
        i,
        "expectedResultRef",
      ]);
    seen.add(ref.id);
  }
  if (seen.size !== c.definition.results.length)
    return failure("INVALID_WITNESS_SET", ["entries"]);
  const canonicalEntries: WitnessInputV1["entries"][number][] = [];
  const entries: WitnessEvidenceV1["entries"][number][] = [];
  let invalidAnswers = false;
  for (const expectedResultRef of c.definition.rules.resultOrder) {
    const entry = parsed.data.entries.find(
      (e) => e.expectedResultRef.id === expectedResultRef.id,
    )!;
    const normalized = normalizeAnswers(c, entry.answers);
    if (!normalized.ok) {
      if (!normalized.issues.every((i) => i.code === "INVALID_ANSWERS"))
        return normalized;
      invalidAnswers = true;
      entries.push({
        status: "invalid",
        expectedResultRef,
        issues: normalized.issues as Extract<
          WitnessEvidenceV1["entries"][number],
          { status: "invalid" }
        >["issues"],
        issuesTruncated: normalized.issuesTruncated,
      });
      continue;
    }
    canonicalEntries.push({ expectedResultRef, answers: normalized.value });
    const scored = scoreCompleteAnswers(handle, normalized.value);
    if (!scored.ok) {
      if (!scored.issues.every((i) => i.code === "NO_PROFILE_MATCH"))
        return scored;
      entries.push({
        status: "invalid",
        expectedResultRef,
        issues: [{ code: "NO_PROFILE_MATCH", path: [] }],
        issuesTruncated: false,
      });
      continue;
    }
    const selection = {
      expectedResultRef,
      selectedResultRef: scored.value.decision.selectedResultRef,
      answersHash: scored.value.answersHash,
      dimensions: scored.value.dimensions,
    };
    entries.push(
      sameRef(expectedResultRef, selection.selectedResultRef)
        ? { status: "passed", ...selection }
        : { status: "mismatch", ...selection, code: "WITNESS_RESULT_MISMATCH" },
    );
  }
  return output(
    witnessEvidenceSchema,
    {
      schemaVersion: "quiz-witness-evidence.v1",
      logicHash: c.identity.logicHash,
      inputSha256: digest(copied.value),
      witnessesHash: invalidAnswers
        ? null
        : digest(
            {
              schemaVersion: "quiz-witness-input.v1",
              entries: canonicalEntries,
            },
            SCORING_HASH_DOMAINS.witnesses,
          ),
      policyId: WITNESS_POLICY.id,
      policyHash: WITNESS_POLICY_HASH,
      status: entries.every((e) => e.status === "passed") ? "passed" : "failed",
      entries,
    },
    SCORING_API_LIMITS.evidenceBytes,
  );
}
