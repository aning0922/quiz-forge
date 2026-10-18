import { expect, it, vi } from "vitest";
import { ConsumerControllerV1 } from "./controller";
import { readConsumerPendingV1, type ConsumerPendingStorage } from "./pending";
import {
  consumerAnswersSha256,
  consumerSaveBindingSha256,
  type ConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import {
  consumerHostFixtureV1 as fixture,
  consumerAppliedFixtureV1 as applied,
} from "./host.test-support";

function storage(): ConsumerPendingStorage {
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
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
it("failed local pending write/readback permits zero POST", async () => {
  const f = await fixture(),
    s = storage();
  s.setItem = () => {};
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(String(url).endsWith("session") ? f.view : f.entry),
  );
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    c.choose(f.q.id, f.q.options[0]!.id);
    await c.navigate({ questionId: f.q.id }, "question");
    expect(
      fetcher.mock.calls.filter(([, o]) => o?.method === "POST"),
    ).toHaveLength(0);
    expect(c.getSnapshot().phase).toBe("unavailable");
  } finally {
    c.dispose();
  }
});
it("UNKNOWN freezes editing; unresolved/replay retain the exact original binding", async () => {
  const f = await fixture(),
    s = storage(),
    posts: unknown[] = [];
  let mode = "unknown";
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    const body = JSON.parse(String(options.body));
    posts.push(body);
    if (mode === "unknown") throw Error("synthetic lost response");
    if (String(url).endsWith("resolve"))
      return json({
        schemaVersion: "quizforge.consumer-save-resolution.v1",
        kind: "unresolved",
        binding: body,
        bindingSha256: await consumerSaveBindingSha256(body),
        state: f.initial,
      });
    return json(await applied(body));
  };
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    c.choose(f.q.id, f.q.options[0]!.id);
    await c.navigate({ questionId: f.q.id }, "question");
    const pending = await readConsumerPendingV1(s, f.session);
    expect(pending?.mayHaveBeenSent).toBe(true);
    c.choose(f.q.id, f.q.options[1]!.id);
    await c.complete();
    expect(c.getSnapshot().answers[0]?.optionId).toBe(f.q.options[0]!.id);
    expect(posts).toHaveLength(1);
    mode = "resolve";
    await c.recover();
    await c.adoptObserved();
    expect(await readConsumerPendingV1(s, f.session)).toEqual(pending);
    await c.recover(true);
    expect(posts[2]).toEqual(posts[0]);
    expect(c.getSnapshot().phase).toBe("pending");
    await c.adoptObserved();
    expect(await readConsumerPendingV1(s, f.session)).toBeNull();
    expect(c.getSnapshot().accepted?.stateRevision).toBe(1);
  } finally {
    c.dispose();
  }
});
it("superseded requires explicit adoption and never merges the old candidate", async () => {
  const f = await fixture(),
    s = storage();
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    const input = JSON.parse(String(options.body)) as ConsumerSaveInput;
    const other = structuredClone(input);
    other.answers[0]!.optionId = f.q.options[1]!.id;
    other.binding.consumerStateAnswersSha256 = await consumerAnswersSha256(
      other.answers,
    );
    const newer = await applied(other);
    return json({
      ...newer,
      kind: "superseded",
      binding: input.binding,
      bindingSha256: await consumerSaveBindingSha256(input.binding),
    });
  };
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    c.choose(f.q.id, f.q.options[0]!.id);
    await c.navigate({ questionId: f.q.id }, "question");
    expect(c.getSnapshot().phase).toBe("pending");
    expect(c.getSnapshot().answers[0]?.optionId).toBe(f.q.options[0]!.id);
    expect(await readConsumerPendingV1(s, f.session)).not.toBeNull();
    await c.adoptObserved();
    expect(c.getSnapshot().answers[0]?.optionId).toBe(f.q.options[1]!.id);
    expect(c.getSnapshot().accepted?.stateRevision).toBe(1);
    expect(c.getSnapshot().phase).toBe("active");
  } finally {
    c.dispose();
  }
});
it("synchronous revocation blocks late save success, pending deletion and media tickets", async () => {
  const f = await fixture(),
    s = storage();
  let release!: (response: Response) => void, input!: ConsumerSaveInput;
  let notify!: () => void;
  const reached = new Promise<void>((r) => {
    notify = r;
  });
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    input = JSON.parse(String(options.body));
    notify();
    return new Promise<Response>((r) => {
      release = r;
    });
  };
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    const task = c.task()!;
    c.choose(f.q.id, f.q.options[0]!.id);
    const save = c.navigate({ questionId: f.q.id }, "question");
    await reached;
    c.revoke();
    expect(task.current()).toBe(false);
    release(json(await applied(input)));
    await save;
    expect(c.getSnapshot().phase).toBe("lost");
    expect(c.getSnapshot().accepted).toBeUndefined();
    expect(await readConsumerPendingV1(s, f.session)).not.toBeNull();
  } finally {
    c.dispose();
  }
});
it("a restored tab remains frozen before any new save or completion", async () => {
  const f = await fixture(),
    s = storage();
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (options?.method === "POST") throw Error("synthetic lost response");
    return json(String(url).endsWith("session") ? f.view : f.entry);
  });
  const first = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  await first.bootstrap();
  first.choose(f.q.id, f.q.options[0]!.id);
  await first.navigate({ questionId: f.q.id }, "question");
  first.dispose();
  const restored = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await restored.bootstrap();
    expect(restored.getSnapshot().phase).toBe("pending");
    expect(restored.getSnapshot().answers[0]?.optionId).toBe(
      f.q.options[0]!.id,
    );
    const before = fetcher.mock.calls.length;
    await restored.navigate({ questionId: null }, "review");
    await restored.complete();
    expect(fetcher.mock.calls.length).toBe(before);
  } finally {
    restored.dispose();
  }
});
it("completed bootstrap reads the stored report even when the Key expired; no entry or scoring", async () => {
  const f = await fixture(),
    report = await persistedReportFixture();
  const view = {
    ...f.view,
    keyExpiresAt: "2026-10-17T00:00:00.000Z",
    outcome: { kind: "completed", report: report.receipt },
  };
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(
      String(url).endsWith("session")
        ? view
        : { receipt: report.receipt, view: report.view },
    ),
  );
  const c = new ConsumerControllerV1(f.session.sessionId, storage(), fetcher);
  try {
    await c.bootstrap("report");
    expect(c.getSnapshot().phase).toBe("completed");
    expect(c.getSnapshot().screen).toBe("report");
    expect(c.getSnapshot().report?.receipt).toEqual(report.receipt);
    expect(
      fetcher.mock.calls.map(([url]) => String(url).split("/").at(-1)),
    ).toEqual(["session", "report"]);
    await c.complete();
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    c.dispose();
  }
});
it("completion UNKNOWN retains one original key and cannot silently start another completion", async () => {
  const f = await fixture(),
    s = storage(),
    completeBodies: unknown[] = [];
  let accepted = f.initial;
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method !== "POST")
      return json(String(url).endsWith("session") ? f.view : f.entry);
    const body = JSON.parse(String(options.body));
    if (String(url).endsWith("/save")) {
      const result = await applied(body);
      accepted = result.state;
      return json(result);
    }
    completeBodies.push(body);
    if (String(url).endsWith("/resolve"))
      return json({
        schemaVersion: "quizforge.consumer-complete-resolution.v1",
        kind: "unresolved",
        binding: body,
        bindingSha256: await (
          await import("@/features/report/persisted/view-contracts")
        ).consumerCompleteBindingSha256(body),
        state: accepted,
      });
    throw Error("synthetic lost completion response");
  };
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    for (const q of f.entry.facts.entry.questions)
      c.choose(q.id, q.options[0]!.id);
    await c.navigate({ questionId: null }, "review");
    expect(c.getSnapshot().screen).toBe("review");
    await c.complete();
    const original = await readConsumerPendingV1(s, f.session);
    expect(original?.operation).toBe("complete");
    await c.complete();
    expect(completeBodies).toHaveLength(1);
    await c.recover();
    await c.adoptObserved();
    expect(await readConsumerPendingV1(s, f.session)).toEqual(original);
    await c.recover(true);
    expect(completeBodies).toHaveLength(3);
    expect(completeBodies[2]).toEqual(completeBodies[0]);
  } finally {
    c.dispose();
  }
});
it("25/30-day Key validity never creates a timer longer than the current eight-hour grant", async () => {
  const f = await fixture();
  for (const days of [25, 30]) {
    const view = structuredClone(f.view);
    view.keyExpiresAt = new Date(
      Date.parse(view.observedAt) + days * 86400000,
    ).toISOString();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const c = new ConsumerControllerV1(
      f.session.sessionId,
      storage(),
      async (url) => json(String(url).endsWith("session") ? view : f.entry),
    );
    try {
      await c.bootstrap();
      expect(c.getSnapshot().phase).toBe("active");
      expect(
        timers.mock.calls.every(
          ([, delay]) => typeof delay === "number" && delay <= 8 * 3600000,
        ),
      ).toBe(true);
    } finally {
      c.dispose();
      timers.mockRestore();
    }
  }
});
it("a real Key expiry before grant expiry stops editing while the grant remains valid", async () => {
  const f = await fixture(),
    view = structuredClone(f.view);
  view.keyExpiresAt = new Date(Date.parse(view.observedAt) + 500).toISOString();
  const c = new ConsumerControllerV1(
    f.session.sessionId,
    storage(),
    async (url) => json(String(url).endsWith("session") ? view : f.entry),
  );
  try {
    await c.bootstrap();
    expect(c.getSnapshot().phase).toBe("active");
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    expect(c.getSnapshot().phase).toBe("expired");
    expect(c.task()?.current()).toBe(true);
    c.choose(f.q.id, f.q.options[0]!.id);
    expect(c.getSnapshot().answers).toEqual([]);
  } finally {
    c.dispose();
  }
});
it("expired original completion pending exposes expiry and allows only resolve, never replay or removal", async () => {
  const f = await fixture(),
    s = storage();
  const answers = f.entry.facts.entry.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[0]!.id,
    })),
    progress = { questionId: null };
  const accepted = await applied({
    binding: {
      schemaVersion: "quizforge.consumer-save.v1",
      session: f.session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: await consumerAnswersSha256(answers),
      progressSha256: f.initial.progressSha256,
    },
    answers,
    progress,
  });
  const binding = {
    schemaVersion: "quizforge.consumer-complete.v1" as const,
    session: f.session,
    expectedStateRevision: 1,
    consumerStateAnswersSha256: accepted.state.consumerStateAnswersSha256,
    progressSha256: accepted.state.progressSha256,
    completionKey: crypto.randomUUID(),
  };
  const { prepareConsumerPendingV1 } = await import("./pending");
  const original = await prepareConsumerPendingV1(
    s,
    { kind: "complete", binding },
    () => true,
  );
  let posts = 0;
  const fetcher: typeof fetch = async (url, options) => {
    if (options?.method === "POST") {
      posts++;
      return json({
        schemaVersion: "quizforge.consumer-complete-resolution.v1",
        kind: "unresolved",
        binding,
        bindingSha256: await (
          await import("@/features/report/persisted/view-contracts")
        ).consumerCompleteBindingSha256(binding),
        state: accepted.state,
      });
    }
    return json(
      String(url).endsWith("session")
        ? {
            ...f.view,
            keyExpiresAt: "2026-10-17T00:00:00.000Z",
            outcome: { kind: "expired", state: accepted.state },
          }
        : f.entry,
    );
  };
  const c = new ConsumerControllerV1(f.session.sessionId, s, fetcher);
  try {
    await c.bootstrap();
    expect(c.getSnapshot()).toMatchObject({
      phase: "pending",
      keyExpired: true,
    });
    await c.recover(true);
    expect(posts).toBe(0);
    await c.recover();
    expect(posts).toBe(1);
    expect(c.getSnapshot().resolution?.kind).toBe("unresolved");
    await c.adoptObserved();
    expect(await readConsumerPendingV1(s, f.session)).toEqual(original);
  } finally {
    c.dispose();
  }
});
