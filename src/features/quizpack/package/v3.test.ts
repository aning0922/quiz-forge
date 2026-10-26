import { expect, it } from "vitest";
import { synthetic24ContentV3 } from "../content/v3-synthetic.test-support";
import { buildSupportedQuizPack } from "./build";
import { validateSupportedQuizPack } from "./validate";
import { prepareContentV3 } from "../content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../content/v3-witnesses";
import { CURRENT_COMPATIBILITY_HASH } from "./current-compatibility";
it("uses the existing ZIP and media admission pipeline for v3 and executes all five fixed witnesses", async () => {
  const fixture = await synthetic24ContentV3(),
    context = {
      targetProductId: fixture.content.core.scoringDefinition.productId,
    };
  const built = await buildSupportedQuizPack(
    {
      packId: "synthetic-d2",
      packVersion: "1.0.0",
      content: fixture.content,
      assets: fixture.assets,
    },
    context,
    "quizpack-content.v3",
  );
  expect(built.ok).toBe(true);
  if (!built.ok) throw Error(JSON.stringify(built.issues));
  expect(built.value.report).toMatchObject({
    schemaVersion: "quizpack-validation.v3",
    candidateValid: true,
    importable: false,
    compatibilityPolicyHash: CURRENT_COMPATIBILITY_HASH,
  });
  const report = await validateSupportedQuizPack(
    (async function* () {
      yield built.value.archive;
    })(),
    context,
    "quizpack-content.v3",
  );
  expect(report.candidateValid).toBe(true);
  expect(Object.values(report.checks)).toEqual(Array(6).fill("passed"));
  const prepared = prepareContentV3(fixture.content);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw Error("EXPECTED_PREPARED");
  expect(verifyPreparedContentWitnessesV3(prepared.value)).toMatchObject({
    ok: true,
    value: {
      evidence: {
        status: "passed",
        entries: Array.from({ length: 5 }, () => ({})),
      },
    },
  });
  const mismatched = await validateSupportedQuizPack(
    (async function* () {
      yield built.value.archive;
    })(),
    context,
    "quizpack-content.v2",
  );
  expect(mismatched.candidateValid).toBe(false);
});
