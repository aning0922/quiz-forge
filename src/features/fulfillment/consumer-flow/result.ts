import "server-only";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type { CurrentConsumerState } from "../consumer-session/repository";
import type { ConsumerExecutionSource } from "./source";
import type { fixedConsumerExecution } from "./fixed-execution";
import { matchesDisplayCapabilitiesV2 } from "@/lib/assessment-contract/display-v2";
/** One pure actual projection from the verified compiled handle and the final locked session. */
export function projectConsumerCompletion(
  fixed: ReturnType<typeof fixedConsumerExecution>,
  execution: ConsumerExecutionSource,
  state: CurrentConsumerState,
) {
  if (fixed.version === 2) {
    if (
      state.schemaVersion !== "quizforge.consumer-state.v2" ||
      state.matchingContext === null ||
      execution.play.snapshot.schemaVersion !==
        "quizforge.internal-play-snapshot.v2" ||
      execution.source.content.schemaVersion !== "quizpack-content.v3"
    )
      throw new ConsumerError("INVALID_REQUEST");
    const result = fixed.display.projectResult(fixed.prepared, {
      schemaVersion: "quiz-scoring-input.v2",
      answers: state.answers,
      matchingContext: state.matchingContext,
    });
    if (!result.ok) throw new ConsumerError("INVALID_ANSWERS");
    if (
      !matchesDisplayCapabilitiesV2(
        result.value.display,
        execution.play.snapshot.presentation,
      ) ||
      !matchesDisplayCapabilitiesV2(
        result.value.display,
        fixed.display.descriptor,
      )
    )
      throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
    return {
      version: 2 as const,
      score: result.value.score,
      display: result.value.display,
    };
  }
  if (
    state.schemaVersion !== "quizforge.consumer-state.v1" ||
    execution.play.snapshot.schemaVersion !==
      "quizforge.internal-play-snapshot.v1" ||
    execution.source.content.schemaVersion !== "quizpack-content.v2"
  )
    throw new ConsumerError("INVALID_REQUEST");
  const score = fixed.engine.score(fixed.prepared, state.answers);
  if (!score.ok) throw new ConsumerError("INVALID_ANSWERS");
  const display = fixed.display.projectResult(
    execution.source.content,
    score.value,
    execution.source.evidence.canonicalContentSha256,
  );
  if (!display.ok) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  return { version: 1 as const, score: score.value, display: display.value };
}
