import { matchingContextV1Schema } from "@/lib/assessment-contract/matching-v1";
import "server-only";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type { CurrentConsumerState } from "../consumer-session/repository";
import { readContentMetadata } from "@/features/quizpack/content/current";
import {
  readFixedInternalPlay,
  readConsumerParent,
  assertConsumerParentSource,
} from "@/features/product/internal-play/repository";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  readConsumerFixedSource,
  type ConsumerFixedSource,
} from "@/features/quizpack/consumer-fixed-source";
import { fixedConsumerExecution } from "./fixed-execution";
import { matchesDisplayCapabilitiesV2 } from "@/lib/assessment-contract/display-v2";
import {
  consumerEntryFactsV2Schema,
  consumerEntryFactsSha256V2,
  verifyConsumerEntryViewV2,
} from "./display-contract-v2";
import {
  consumerEntryFactsSchema,
  consumerEntryFactsSha256,
  verifyConsumerEntryView,
} from "./display-contract";

export async function readConsumerPlaySource(
  tx: ConsumerTx,
  state: CurrentConsumerState,
) {
  const s = state.session,
    play = await readFixedInternalPlay(tx, {
      productId: s.productId,
      playVersionId: s.playVersionId,
      playSnapshotSha256: s.playSnapshotSha256,
    });
  const parent = await readConsumerParent(tx, play.snapshot.parent);
  if (
    !sameConsumerFact(
      parent.snapshot,
      play.snapshot.parentSnapshot,
      L.playSnapshotBytes,
    )
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  await assertConsumerParentSource(tx, parent, false);
  const source = await readConsumerFixedSource(
    tx,
    play.snapshot.parentSnapshot,
  );
  return { play, source };
}
export async function readConsumerExecutionSource(
  tx: ConsumerTx,
  state: CurrentConsumerState,
) {
  const { play, source } = await readConsumerPlaySource(tx, state),
    fixed = fixedConsumerExecution(
      play.snapshot.parentSnapshot,
      play.snapshot.renderer,
      source,
      play.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2"
        ? play.snapshot.presentation
        : undefined,
    );
  return { play, source, fixed };
}
export type ConsumerExecutionSource = Awaited<
  ReturnType<typeof readConsumerExecutionSource>
>;
export function validateConsumerMembers(
  source: ConsumerFixedSource,
  input: Pick<CurrentConsumerState, "answers" | "progress"> & {
    matchingContext?: unknown;
  },
  complete = false,
) {
  const questions = readContentMetadata(source.content).questions;
  if (
    input.answers.some(
      (a) =>
        !questions.some(
          (q) =>
            q.id === a.questionId && q.options.some((o) => o.id === a.optionId),
        ),
    ) ||
    (input.progress.questionId !== null &&
      !questions.some((q) => q.id === input.progress.questionId)) ||
    (complete && input.answers.length !== questions.length)
  )
    throw new ConsumerError("INVALID_ANSWERS");
  if (source.content.schemaVersion === "quizpack-content.v3") {
    if (
      !("matchingContext" in input) ||
      (complete && input.matchingContext === null)
    )
      throw new ConsumerError("INVALID_REQUEST");
    if (input.matchingContext !== null) {
      const context = matchingContextV1Schema.safeParse(input.matchingContext);
      if (
        !context.success ||
        !sameConsumerFact(
          context.data.policyRef,
          source.content.core.scoringDefinition.matchingPolicy.ref,
          L.operationRequestBytes,
        )
      )
        throw new ConsumerError("INVALID_REQUEST");
    }
  }
}
export async function projectConsumerEntry(
  state: CurrentConsumerState,
  execution: ConsumerExecutionSource,
) {
  const { play, source, fixed } = execution;
  if (fixed.version === 2) {
    if (
      play.snapshot.schemaVersion !== "quizforge.internal-play-snapshot.v2" ||
      state.schemaVersion !== "quizforge.consumer-state.v2"
    )
      throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
    const projected = fixed.display.projectEntry(
      source.content,
      source.evidence.canonicalContentSha256,
    );
    if (
      !projected.ok ||
      !matchesDisplayCapabilitiesV2(projected.value, play.snapshot.presentation)
    )
      throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
    const facts = consumerEntryFactsV2Schema.parse({
      schemaVersion: "quizforge.consumer-entry.v2",
      session: state.session,
      parent: play.snapshot.parent,
      renderer: play.snapshot.renderer,
      font: play.snapshot.parentSnapshot.font,
      mapping: play.snapshot.mapping,
      mappingSha256: play.snapshot.mappingSha256,
      entry: projected.value,
    });
    return verifyConsumerEntryViewV2(
      { facts, factsSha256: await consumerEntryFactsSha256V2(facts) },
      state.session,
    );
  }
  if (
    state.schemaVersion !== "quizforge.consumer-state.v1" ||
    play.snapshot.schemaVersion !== "quizforge.internal-play-snapshot.v1"
  )
    throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
  const projected = fixed.display.projectEntry(
    source.content,
    source.evidence.canonicalContentSha256,
  );
  if (!projected.ok) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  const facts = consumerEntryFactsSchema.parse({
    schemaVersion: "quizforge.consumer-entry.v1",
    session: state.session,
    parent: play.snapshot.parent,
    renderer: play.snapshot.renderer,
    font: play.snapshot.parentSnapshot.font,
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    entry: projected.value,
  });
  return verifyConsumerEntryView(
    { facts, factsSha256: await consumerEntryFactsSha256(facts) },
    state.session,
  );
}
