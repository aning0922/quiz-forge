import {
  CONSUMER_COMPONENT_MAPPING_V2,
  CONSUMER_RENDERER_V2,
} from "./component-map";
import {
  consumerComponentMappingV2Schema,
  consumerMappingSha256V2,
} from "@/lib/consumer-contract/v2/identities";
import { persistedReportDisplaySha256V2 } from "@/features/report/persisted/view-contracts-v2";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import { projectContentEntryV3 } from "@/features/theme/preview/v3-projection";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import {
  consumerStateV2Schema,
  consumerMatchingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";

/** Verified-shape synthetic responses; no DB, real grant or compiled runtime availability. */
export async function consumerSessionFixtureV2() {
  const r = await persistedReportFixtureV2(),
    session = r.snapshot.binding.session;
  // Synthetic exact renderer facts for the adapter probe, not catalog admission.
  r.view.renderer = { ...r.view.renderer, ...CONSUMER_RENDERER_V2 };
  r.view.mapping = consumerComponentMappingV2Schema.parse(
    CONSUMER_COMPONENT_MAPPING_V2,
  );
  r.view.mappingSha256 = await consumerMappingSha256V2(r.view.mapping);
  r.receipt.displaySha256 = await persistedReportDisplaySha256V2(r.view);
  const initial = consumerStateV2Schema.parse({
    schemaVersion: "quizforge.consumer-state.v2",
    session,
    createdAt: testMoment,
    stateRevision: 0,
    answers: [],
    progress: { questionId: null },
    lastSave: null,
    matchingContext: null,
    consumerStateAnswersSha256: await consumerAnswersSha256([]),
    progressSha256: await consumerProgressSha256({ questionId: null }),
    matchingContextSha256: await consumerMatchingSha256V2(null),
  });
  const projected = projectContentEntryV3(
    r.content,
    r.snapshot.score.canonicalContentSha256,
  );
  if (!projected.ok) throw Error("SYNTHETIC_ENTRY_FAILED");
  const facts = {
    schemaVersion: "quizforge.consumer-entry.v2",
    session,
    parent: r.view.parent,
    renderer: r.view.renderer,
    font: r.view.font,
    mapping: r.view.mapping,
    mappingSha256: r.view.mappingSha256,
    entry: projected.value,
  };
  const entry = { facts, factsSha256: await consumerEntryFactsSha256V2(facts) };
  const view = {
    schemaVersion: "quizforge.consumer-session-view.v2",
    grant: {
      grantId: testUuid(90),
      session,
      issuedAt: testMoment,
      expiresAt: "2026-10-18T08:00:00.000Z",
      csrf: "A".repeat(43),
    },
    observedAt: testMoment,
    keyExpiresAt: "2026-10-19T00:00:00.000Z",
    outcome: { kind: "editable", state: initial },
  };
  return {
    session,
    initial,
    entry,
    view,
    report: { receipt: r.receipt, view: r.view },
    completedView: {
      ...view,
      outcome: { kind: "completed", report: r.receipt },
    },
  };
}
