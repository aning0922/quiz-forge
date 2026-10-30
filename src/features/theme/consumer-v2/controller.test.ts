import { beforeAll, expect, it, vi } from "vitest";
import { ConsumerControllerV2 } from "./controller";
import {
  readConsumerPendingV2,
  type ConsumerPendingStorageV2,
} from "./pending";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import { projectContentEntryV3 } from "@/features/theme/preview/v3-projection";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import {
  consumerStateV2Schema,
  consumerMatchingSha256V2,
  consumerSaveBindingSha256V2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
} from "@/lib/consumer-contract/v1/state";
import {
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
function storage(): ConsumerPendingStorageV2 {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
}
const json = (v: unknown) =>
  new Response(JSON.stringify(v), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
let f: Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const r = await persistedReportFixtureV2(),
    session = r.snapshot.binding.session;
  const initial = consumerStateV2Schema.parse({
    schemaVersion: "quizforge.consumer-state.v2",
    session,
    createdAt: testMoment,
    stateRevision: 0,
    answers: [],
    progress: { questionId: null },
    consumerStateAnswersSha256: await consumerAnswersSha256([]),
    progressSha256: await consumerProgressSha256({ questionId: null }),
    matchingContext: null,
    matchingContextSha256: await consumerMatchingSha256V2(null),
    lastSave: null,
  });
  const projected = projectContentEntryV3(
    r.content,
    r.snapshot.score.canonicalContentSha256,
  );
  if (!projected.ok) throw Error("ENTRY_FAILED");
  const facts = {
    schemaVersion: "quizforge.consumer-entry.v2",
    session,
    parent: r.snapshot.view.parent,
    renderer: r.snapshot.view.renderer,
    font: r.snapshot.view.font,
    mapping: r.snapshot.view.mapping,
    mappingSha256: r.snapshot.view.mappingSha256,
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
  return { initial, entry, view, session, q: r.content.core.questions[0]! };
}
beforeAll(async () => {
  f = await fixture();
});
async function applied(input: ConsumerSaveInputV2) {
  const bindingSha256 = await consumerSaveBindingSha256V2(input.binding),
    state = consumerStateV2Schema.parse({
      ...f.initial,
      stateRevision: input.binding.expectedStateRevision + 1,
      answers: input.answers,
      progress: input.progress,
      matchingContext: input.matchingContext,
      consumerStateAnswersSha256: input.binding.consumerStateAnswersSha256,
      progressSha256: input.binding.progressSha256,
      matchingContextSha256: input.binding.matchingContextSha256,
      lastSave: {
        schemaVersion: "quizforge.consumer-save-receipt.v2",
        binding: input.binding,
        bindingSha256,
        appliedStateRevision: input.binding.expectedStateRevision + 1,
        savedAt: testMoment,
      },
    });
  return {
    schemaVersion: "quizforge.consumer-save-resolution.v2",
    kind: "applied-current",
    binding: input.binding,
    bindingSha256,
    state,
  };
}
it("requires explicit preference and permits zero POST if pending persistence fails", async () => {
  const s = storage();
  s.setItem = () => {};
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(String(url).endsWith("session") ? f.view : f.entry),
  );
  const c = new ConsumerControllerV2(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    c.choose(f.q.ref.id, f.q.options[0]!.ref.id);
    await c.navigate({ questionId: f.q.ref.id }, "question");
    expect(
      fetcher.mock.calls.filter(([, o]) => o?.method === "POST"),
    ).toHaveLength(0);
    c.choosePreference("any");
    await c.navigate({ questionId: f.q.ref.id }, "question");
    expect(
      fetcher.mock.calls.filter(([, o]) => o?.method === "POST"),
    ).toHaveLength(0);
    expect(c.getSnapshot().draft?.answers).toHaveLength(1);
  } finally {
    c.dispose();
  }
});
it("saves a changed preference in the same CAS while retaining every answer", async () => {
  const posts: ConsumerSaveInputV2[] = [];
  const fetcher: typeof fetch = async (url, o) => {
    if (o?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    const input = JSON.parse(String(o.body));
    posts.push(input);
    return json(await applied(input));
  };
  const c = new ConsumerControllerV2(f.session.sessionId, storage(), fetcher);
  try {
    await c.bootstrap();
    c.choosePreference("any");
    c.choose(f.q.ref.id, f.q.options[0]!.ref.id);
    await c.navigate({ questionId: f.q.ref.id }, "question");
    c.choosePreference("female");
    await c.navigate({ questionId: f.q.ref.id }, "question");
    expect(posts).toHaveLength(2);
    expect(posts[1]!.answers).toEqual(posts[0]!.answers);
    expect(posts[1]!.binding.expectedStateRevision).toBe(1);
    expect(posts[1]!.binding.matchingContextSha256).not.toBe(
      posts[0]!.binding.matchingContextSha256,
    );
    expect(c.getSnapshot().phase).toBe("ready");
    expect(c.getSnapshot().state?.matchingContext?.preference).toBe("female");
  } finally {
    c.dispose();
  }
});
it("restores the original UNKNOWN preference and resolves without another save or rotated operation", async () => {
  const s = storage(),
    posts: { url: string; body: unknown }[] = [];
  let resolving = false;
  const fetcher: typeof fetch = async (url, o) => {
    if (o?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    const body = JSON.parse(String(o.body));
    posts.push({ url: String(url), body });
    if (!resolving) throw Error("synthetic lost response");
    return json({
      schemaVersion: "quizforge.consumer-save-resolution.v2",
      kind: "unresolved",
      binding: body,
      bindingSha256: await consumerSaveBindingSha256V2(body),
      state: f.initial,
    });
  };
  let c = new ConsumerControllerV2(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    c.choosePreference("female");
    c.choose(f.q.ref.id, f.q.options[0]!.ref.id);
    await c.navigate({ questionId: f.q.ref.id }, "question");
    const pending = await readConsumerPendingV2(s, f.session);
    expect(pending?.mayHaveBeenSent).toBe(true);
    c.choosePreference("male");
    expect(c.getSnapshot().draft?.matchingContext?.preference).toBe("female");
    c.dispose();
    c = new ConsumerControllerV2(f.session.sessionId, s, fetcher);
    await c.bootstrap();
    expect(c.getSnapshot().phase).toBe("unknown");
    expect(c.getSnapshot().draft?.matchingContext?.preference).toBe("female");
    resolving = true;
    await c.recover();
    await c.adoptObserved();
    expect(posts).toHaveLength(2);
    expect(posts[1]!.url).toMatch(/save\/resolve$/);
    expect(posts[1]!.body).toEqual(
      pending?.operation === "save" ? pending.input.binding : null,
    );
    expect(await readConsumerPendingV2(s, f.session)).toEqual(pending);
    expect(c.getSnapshot().phase).toBe("unknown");
  } finally {
    c.dispose();
  }
});
it("revokes view authority synchronously while retaining entered answers and preference", async () => {
  const c = new ConsumerControllerV2(
    f.session.sessionId,
    storage(),
    async (url) => json(String(url).endsWith("session") ? f.view : f.entry),
  );
  try {
    await c.bootstrap();
    c.choosePreference("male");
    c.choose(f.q.ref.id, f.q.options[0]!.ref.id);
    c.revoke();
    expect(c.getSnapshot().phase).toBe("denied");
    expect(c.getSnapshot().entry).toBeNull();
    expect(c.getSnapshot().draft?.matchingContext?.preference).toBe("male");
    expect(c.getSnapshot().draft?.answers).toHaveLength(1);
    expect(c.task()).toBeNull();
  } finally {
    c.dispose();
  }
});
