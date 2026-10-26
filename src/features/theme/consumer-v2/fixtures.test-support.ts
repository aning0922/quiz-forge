import { syntheticContentV3 } from "@/features/quizpack/content/v3-fixtures.test-support";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import { syntheticInputV2 } from "@/features/quiz/scoring/v2/fixtures.test-support";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import { consumerStateV2Schema } from "@/lib/consumer-contract/v2/state";
import { persistedReportViewV2Schema } from "@/features/report/persisted/view-contracts-v2";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import {
  CONSUMER_COMPONENT_MAPPING_V2,
  CONSUMER_RENDERER_V2,
} from "./component-map";

/** Pure synthetic props. Hash/receipt placeholders are not persistence or verification evidence. */
export function structuredReaderFixtureV2() {
  const content = syntheticContentV3(),
    prepared = prepareContentV3(content);
  if (!prepared.ok) throw Error("SYNTHETIC_PREPARATION_FAILED");
  const result = projectPreparedResultV3(
    prepared.value,
    syntheticInputV2(3, [2, 2, 2], "female"),
  );
  if (!result.ok) throw Error("SYNTHETIC_PROJECTION_FAILED");
  const projected = projectContentEntryV3(
    content,
    result.value.score.canonicalContentSha256,
  );
  if (!projected.ok) throw Error("SYNTHETIC_ENTRY_FAILED");
  const entry = structuredClone(projected.value);
  entry.product.title = "合成测试 · 24题结构";
  entry.questions = Array.from({ length: 24 }, (_, i) => ({
    ...structuredClone(entry.questions[0]!),
    ref: { ...entry.questions[0]!.ref, id: `q-${i}` },
    prompt: `合成情境 ${i + 1}：这段文字用于结构阅读，不是作者正式题目。`,
    act: Math.floor(i / 8) + 1,
    options: entry.questions[0]!.options.map((o, n) => ({
      ref: { ...o.ref, id: `q-${i}-o-${n}` },
      label: `合成选项 ${n + 1}：保留本轮输入。`,
    })),
  }));
  const sha = "a".repeat(64),
    moment = "2026-10-27T00:00:00.000Z";
  const uuid = (i: number) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const session = {
    productId: "synthetic-v2",
    keyId: uuid(1),
    sessionId: uuid(2),
    playVersionId: uuid(3),
    playSnapshotSha256: sha,
  };
  const state = consumerStateV2Schema.parse({
    schemaVersion: "quizforge.consumer-state.v2",
    session,
    createdAt: moment,
    stateRevision: 0,
    answers: [],
    progress: { questionId: null },
    lastSave: null,
    matchingContext: null,
    consumerStateAnswersSha256: sha,
    progressSha256: sha,
    matchingContextSha256: sha,
  });
  const model: ConsumerV2ReaderModel = {
    phase: "ready",
    entry,
    state,
    draft: {
      answers: [],
      progress: { questionId: null },
      matchingContext: null,
    },
    report: null,
    pendingOperation: null,
    savedAt: null,
    message: null,
  };
  const binding = {
    schemaVersion: "quizforge.consumer-complete.v2",
    session,
    expectedStateRevision: 1,
    consumerStateAnswersSha256: sha,
    progressSha256: sha,
    matchingContextSha256: sha,
    completionKey: uuid(4),
  };
  const report = persistedReportViewV2Schema.parse({
    receipt: {
      schemaVersion: "quizforge.consumer-report-receipt.v2",
      reportId: uuid(5),
      binding,
      bindingSha256: sha,
      completedAt: moment,
      reportSnapshotSha256: sha,
      displaySha256: sha,
    },
    view: {
      schemaVersion: "quizforge.consumer-report-display.v2",
      reportId: uuid(5),
      session,
      completedAt: moment,
      completionBindingSha256: sha,
      parent: {
        productId: "synthetic-v2",
        versionId: uuid(6),
        snapshotSha256: sha,
      },
      renderer: {
        kind: "consumer-renderer",
        ...CONSUMER_RENDERER_V2,
        entrySha256: sha,
      },
      font: { kind: "system-structured", pngAvailable: false },
      mapping: CONSUMER_COMPONENT_MAPPING_V2,
      mappingSha256: sha,
      display: result.value.display,
    },
  });
  const completed: ConsumerV2ReaderModel = {
    ...model,
    entry: null,
    state: null,
    draft: null,
    phase: "completed",
    report,
  };
  return { model, completed };
}
