import "server-only";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type { ConsumerState } from "@/lib/consumer-contract/v1/state";
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
import {
  consumerEntryFactsSchema,
  consumerEntryFactsSha256,
  verifyConsumerEntryView,
} from "./display-contract";

export async function readConsumerPlaySource(
  tx: ConsumerTx,
  state: ConsumerState,
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
  state: ConsumerState,
) {
  const { play, source } = await readConsumerPlaySource(tx, state),
    fixed = fixedConsumerExecution(
      play.snapshot.parentSnapshot,
      play.snapshot.renderer,
      source,
    );
  return { play, source, fixed };
}
export type ConsumerExecutionSource = Awaited<
  ReturnType<typeof readConsumerExecutionSource>
>;
export function validateConsumerMembers(
  source: ConsumerFixedSource,
  input: Pick<ConsumerState, "answers" | "progress">,
  complete = false,
) {
  const questions = source.content.questions;
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
}
export async function projectConsumerEntry(
  state: ConsumerState,
  execution: ConsumerExecutionSource,
) {
  const { play, source, fixed } = execution,
    projected = fixed.display.projectEntry(
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
