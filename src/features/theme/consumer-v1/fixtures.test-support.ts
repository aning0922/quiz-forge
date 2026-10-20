import { createHash } from "node:crypto";
import {
  previewFixture,
  answers,
} from "@/features/theme/preview/fixtures.test-support";
import {
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { projectConsumerEntryV1, projectConsumerResultV1 } from "./projection";
import type { DisplayPosterExportBodyV1 } from "@/lib/assessment-contract/display-v1";

/** Synthetic display data only, not a persisted session/report or an approval record. */
export async function consumerDisplayFixture(
  engine: "archetype" | "dimensions" = "archetype",
) {
  const content = await previewFixture(engine);
  const sha = createHash("sha256")
    .update(canonicalP1Json(content))
    .digest("hex");
  const prepared = prepareContentForScoring(content);
  if (!prepared.ok) throw Error("SYNTHETIC_PREPARATION_FAILED");
  const scored = scorePreparedContent(prepared.value, answers(content));
  if (!scored.ok) throw Error("SYNTHETIC_SCORING_FAILED");
  const entry = projectConsumerEntryV1(content, sha),
    display = projectConsumerResultV1(content, scored.value, sha);
  if (!entry.ok || !display.ok || display.value.poster.kind !== "ready")
    throw Error("SYNTHETIC_DISPLAY_FAILED");
  const value = display.value;
  const poster: DisplayPosterExportBodyV1 = {
    answersHash: value.answersHash,
    logicHash: value.logicHash,
    selectedResultRef: value.selectedResultRef,
    reportTemplateRef: value.reportTemplateRef,
    poster: value.poster as DisplayPosterExportBodyV1["poster"],
  };
  return {
    content,
    sha,
    scored: scored.value,
    entry: entry.value,
    display: value,
    poster,
  };
}
