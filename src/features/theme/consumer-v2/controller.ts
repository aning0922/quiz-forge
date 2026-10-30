import type { MatchingContextV1 } from "@/lib/assessment-contract/matching-v1";
import type {
  ConsumerV2ReaderModel,
  ConsumerV2ReaderEvent,
} from "@/lib/consumer-contract/v2/client-contract";
import {
  consumerMatchingTextV2,
  consumerMatchingSha256V2,
  type ConsumerStateV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerAnswersSchema,
  consumerProgressSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
  consumerAnswersText,
  consumerProgressText,
  type ConsumerAnswers,
  type ConsumerProgress,
} from "@/lib/consumer-contract/v1/state";
import type {
  ConsumerSessionViewV2,
  ConsumerSaveResolutionV2,
  ConsumerCompleteResolutionV2,
} from "@/features/fulfillment/consumer-flow/contracts-v2";
import type { ConsumerEntryViewV2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import type {
  PersistedReportViewV2,
  PersistedReportReceiptV2,
} from "@/features/report/persisted/view-contracts-v2";
import { ConsumerAuthorityV1 } from "../consumer-v1/authority";
import {
  readConsumerPendingV2,
  prepareConsumerPendingV2,
  markConsumerBeforeSendV2,
  removeExactConsumerPendingV2,
  type ConsumerPendingV2,
  type ConsumerPendingStorageV2,
} from "./pending";
import * as client from "./client";
import {
  ConsumerClientError,
  type ConsumerFetch,
} from "../consumer-v1/request";

export type ConsumerScreenV2 =
  "cover" | "question" | "resume" | "review" | "result" | "report" | "poster";
type Resolution = ConsumerSaveResolutionV2 | ConsumerCompleteResolutionV2;
export type ConsumerHostStateV2 = Readonly<{
  phase:
    | "loading"
    | "active"
    | "busy"
    | "pending"
    | "expired"
    | "completed"
    | "lost"
    | "unavailable";
  screen: ConsumerScreenV2;
  keyExpired: boolean;
  session?: ConsumerSessionViewV2 | undefined;
  entry?: ConsumerEntryViewV2 | undefined;
  report?: PersistedReportViewV2 | undefined;
  accepted?: ConsumerStateV2 | undefined;
  answers: ConsumerAnswers;
  matchingContext: MatchingContextV1 | null;
  progress: ConsumerProgress;
  pending?: ConsumerPendingV2 | undefined;
  resolution?: Resolution | undefined;
}>;
export type ConsumerTaskV2 = Readonly<{
  signal: AbortSignal;
  current: () => boolean;
}>;
/** The single owner of page authority, original pending and accepted server facts. No scoring. */
export class ConsumerControllerV2 {
  #value: ConsumerHostStateV2 = Object.freeze({
    phase: "loading",
    screen: "cover",
    keyExpired: false,
    answers: [],
    matchingContext: null,
    progress: { questionId: null },
  });
  #listeners = new Set<() => void>();
  #authority?: ConsumerAuthorityV1;
  #abort = new AbortController();
  #epoch = 0;
  #grantTimer?: ReturnType<typeof setTimeout>;
  #keyTimer?: ReturnType<typeof setTimeout>;
  #keyExpired = false;
  constructor(
    readonly sessionId: string,
    readonly storage: ConsumerPendingStorageV2,
    readonly fetcher?: ConsumerFetch,
  ) {}
  #reader: ConsumerV2ReaderModel = {
    phase: "loading",
    entry: null,
    state: null,
    draft: null,
    report: null,
    pendingOperation: null,
    savedAt: null,
    message: null,
  };
  getSnapshot = () => this.#reader;
  getInternalSnapshot = () => this.#value;
  onEvent = (event: ConsumerV2ReaderEvent) => {
    switch (event.type) {
      case "choose-preference":
        this.choosePreference(event.preference);
        break;
      case "choose-answer":
        this.choose(event.questionId, event.optionId);
        break;
      case "navigate":
        void this.navigate({ questionId: event.questionId }, "question");
        break;
      case "save":
        void this.navigate(this.#value.progress, "question");
        break;
      case "complete":
        void this.complete();
        break;
      case "resolve":
        void this.recover();
        break;
      case "reload":
        if (
          this.#value.resolution &&
          this.#value.resolution.kind !== "unresolved"
        )
          void this.adoptObserved();
        else void this.bootstrap();
        break;
      case "logout":
        void this.logout();
        break;
    }
  };
  choosePreference(preference: MatchingContextV1["preference"]) {
    const v = this.#value;
    if (v.phase !== "active" || !v.entry || !this.task()?.current()) return;
    this.#publish({
      matchingContext: {
        schemaVersion: "quiz-matching-context.v1",
        preference,
        policyRef: v.entry.facts.entry.matchingPolicyRef,
      },
    });
  }
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(patch: Partial<ConsumerHostStateV2>) {
    this.#value = Object.freeze({ ...this.#value, ...patch });
    const v = this.#value;
    this.#reader = Object.freeze({
      phase:
        v.phase === "active"
          ? "ready"
          : v.phase === "busy"
            ? v.pending?.operation === "complete"
              ? "completing"
              : "saving"
            : v.phase === "pending"
              ? v.resolution && v.resolution.kind !== "unresolved"
                ? "conflict"
                : "unknown"
              : v.phase === "lost" || v.phase === "expired"
                ? "denied"
                : v.phase,
      entry: v.entry?.facts.entry ?? null,
      state: v.accepted ?? null,
      draft:
        v.phase === "completed"
          ? null
          : {
              answers: v.answers,
              progress: v.progress,
              matchingContext: v.matchingContext,
            },
      report: v.report ?? null,
      pendingOperation: v.pending?.operation ?? null,
      savedAt: v.accepted?.lastSave?.savedAt ?? null,
      message:
        v.resolution?.kind === "unresolved"
          ? "原操作尚未核实；请稍后再次核实，不会重新发送。"
          : v.phase === "pending"
            ? "原操作已保留；请核实结果后再继续。"
            : v.phase === "lost" || v.phase === "expired"
              ? "当前授权已失效；已保留本页输入和原操作。"
              : null,
    });
    for (const listener of this.#listeners) listener();
  }
  #clearTimers() {
    clearTimeout(this.#grantTimer);
    clearTimeout(this.#keyTimer);
  }
  #invalidate() {
    this.#epoch++;
    this.#authority?.revoke();
    this.#abort.abort();
    this.#abort = new AbortController();
    this.#clearTimers();
  }
  dispose() {
    this.#invalidate();
    this.#listeners.clear();
  }
  revoke = () => {
    this.#invalidate();
    this.#publish({
      phase: "lost",
      session: undefined,
      entry: undefined,
      report: undefined,
      resolution: undefined,
      accepted: undefined,
    });
  };
  task(): ConsumerTaskV2 | null {
    if (!this.#authority) return null;
    const authority = this.#authority,
      ticket = authority.ticket(),
      signal = this.#abort.signal;
    if (!authority.current(ticket)) return null;
    return Object.freeze({
      signal,
      current: () => !signal.aborted && authority.current(ticket),
    });
  }
  #context(task: ConsumerTaskV2) {
    return {
      signal: task.signal,
      ...(this.fetcher ? { fetcher: this.fetcher } : {}),
      onAuthorityFailure: () => {
        if (task.current()) this.revoke();
      },
    };
  }
  #writeContext(task: ConsumerTaskV2) {
    const session = this.#value.session;
    if (!session || !task.current())
      throw new ConsumerClientError("ACCESS_DENIED");
    return { ...this.#context(task), csrf: session.grant.csrf };
  }
  #fail(task: ConsumerTaskV2) {
    if (task.current())
      this.#publish({ phase: this.#value.pending ? "pending" : "unavailable" });
  }
  async bootstrap(screen?: "report") {
    this.#invalidate();
    const epoch = this.#epoch,
      active = this.#abort,
      started = performance.now();
    const current = () => epoch === this.#epoch && !active.signal.aborted;
    this.#publish({
      phase: "loading",
      keyExpired: false,
      session: undefined,
      entry: undefined,
      report: undefined,
      accepted: undefined,
      answers: [],
      matchingContext: null,
      progress: { questionId: null },
      pending: undefined,
      resolution: undefined,
    });
    try {
      const session = await client.readConsumerSessionV2(this.sessionId, {
        signal: active.signal,
        ...(this.fetcher ? { fetcher: this.fetcher } : {}),
        onAuthorityFailure: () => {
          if (current()) this.revoke();
        },
      });
      if (!current()) return;
      if (this.#authority) this.#authority.adopt(session.grant.session);
      else this.#authority = new ConsumerAuthorityV1(session.grant.session);
      const task = this.task()!;
      const elapsed = performance.now() - started;
      const remaining = (until: string) =>
        Math.max(
          0,
          Date.parse(until) - Date.parse(session.observedAt) - elapsed,
        );
      const grantRemaining = remaining(session.grant.expiresAt),
        keyRemaining = remaining(session.keyExpiresAt);
      this.#grantTimer = setTimeout(() => {
        if (task.current()) this.revoke();
      }, grantRemaining);
      this.#keyExpired =
        session.outcome.kind === "expired" || keyRemaining === 0;
      // Grant expiry revokes the page within eight hours. Never schedule a multi-day
      // browser timeout (25/30-day Key lifetimes exceed the signed 32-bit timer range).
      if (
        session.outcome.kind !== "completed" &&
        keyRemaining > 0 &&
        keyRemaining < grantRemaining
      )
        this.#keyTimer = setTimeout(() => {
          if (!task.current()) return;
          this.#keyExpired = true;
          this.#publish({
            keyExpired: true,
            ...(this.#value.phase === "active"
              ? { phase: "expired" as const }
              : {}),
          });
        }, keyRemaining);
      this.#publish({ session, keyExpired: this.#keyExpired });
      const pending = await readConsumerPendingV2(
        this.storage,
        session.grant.session,
      );
      if (!task.current()) return;
      if (pending) this.#publish({ pending });
      if (session.outcome.kind === "completed") {
        await this.#report(session.outcome.report, task, screen ?? "result");
        if (task.current() && pending) this.#publish({ phase: "pending" });
        return;
      }
      const entry = await client.readConsumerEntryV2(
        session.grant.session,
        this.#context(task),
      );
      if (!task.current()) return;
      const state = session.outcome.state;
      this.#validateCandidate(entry, state.answers, state.progress);
      if (pending?.operation === "save")
        this.#validateCandidate(
          entry,
          pending.input.answers,
          pending.input.progress,
        );
      const candidate = pending?.operation === "save" ? pending.input : state;
      this.#publish({
        entry,
        accepted: state,
        answers: candidate.answers,
        progress: candidate.progress,
        matchingContext: candidate.matchingContext,
        phase: pending ? "pending" : this.#keyExpired ? "expired" : "active",
        screen: state.stateRevision === 0 && !pending ? "cover" : "resume",
      });
    } catch {
      if (current())
        this.#publish({
          phase: this.#value.pending ? "pending" : "unavailable",
        });
    }
  }
  #validateCandidate(
    entry: ConsumerEntryViewV2,
    answers: ConsumerAnswers,
    progress: ConsumerProgress,
  ) {
    if (
      answers.some(
        (a) =>
          !entry.facts.entry.questions.some(
            (q) =>
              q.ref.id === a.questionId &&
              q.options.some((o) => o.ref.id === a.optionId),
          ),
      ) ||
      (progress.questionId !== null &&
        !entry.facts.entry.questions.some(
          (q) => q.ref.id === progress.questionId,
        ))
    )
      throw new ConsumerClientError("UNAVAILABLE");
  }
  choose(questionId: string, optionId: string) {
    if (
      this.#value.phase !== "active" ||
      !this.task()?.current() ||
      !this.#value.entry
    )
      return;
    const answers = consumerAnswersSchema.parse([
      ...this.#value.answers.filter((a) => a.questionId !== questionId),
      { questionId, optionId },
    ]);
    this.#validateCandidate(this.#value.entry, answers, this.#value.progress);
    this.#publish({ answers });
  }
  readonlyScreen(screen: "result" | "report" | "poster") {
    if (this.#value.report && this.task()?.current()) this.#publish({ screen });
  }
  unsaved() {
    const v = this.#value;
    return (
      !v.accepted ||
      consumerAnswersText(v.answers) !==
        consumerAnswersText(v.accepted.answers) ||
      consumerProgressText(v.progress) !==
        consumerProgressText(v.accepted.progress) ||
      consumerMatchingTextV2(v.matchingContext) !==
        consumerMatchingTextV2(v.accepted.matchingContext)
    );
  }
  async navigate(
    progressInput: ConsumerProgress,
    screen: "cover" | "question" | "resume" | "review",
  ) {
    const v = this.#value,
      task = this.task();
    if (v.phase !== "active" || !v.entry || !v.accepted || !task) return;
    const progress = consumerProgressSchema.parse(progressInput);
    this.#validateCandidate(v.entry, v.answers, progress);
    if (!v.matchingContext) {
      this.#publish({ progress });
      return;
    }
    if (
      consumerAnswersText(v.answers) ===
        consumerAnswersText(v.accepted.answers) &&
      consumerProgressText(progress) ===
        consumerProgressText(v.accepted.progress) &&
      consumerMatchingTextV2(v.matchingContext) ===
        consumerMatchingTextV2(v.accepted.matchingContext)
    ) {
      this.#publish({ screen, progress });
      return;
    }
    this.#publish({ phase: "busy" });
    try {
      const [answersHash, progressHash, matchingHash] = await Promise.all([
        consumerAnswersSha256(v.answers),
        consumerProgressSha256(progress),
        consumerMatchingSha256V2(v.matchingContext),
      ]);
      if (!task.current() || this.#keyExpired) {
        if (task.current()) this.#publish({ phase: "expired" });
        return;
      }
      const pending = await prepareConsumerPendingV2(
        this.storage,
        {
          kind: "save",
          input: {
            binding: {
              schemaVersion: "quizforge.consumer-save.v2",
              session: v.accepted.session,
              expectedStateRevision: v.accepted.stateRevision,
              consumerStateAnswersSha256: answersHash,
              progressSha256: progressHash,
              matchingContextSha256: matchingHash,
            },
            answers: v.answers,
            progress,
            matchingContext: v.matchingContext,
          },
        },
        task.current,
      );
      if (!task.current()) return;
      this.#publish({ pending });
      await this.#send(pending, task, false, screen);
    } catch {
      this.#fail(task);
    }
  }
  async complete() {
    const v = this.#value,
      task = this.task();
    if (
      v.phase !== "active" ||
      !v.entry ||
      !v.accepted ||
      !v.matchingContext ||
      !task ||
      this.unsaved() ||
      v.answers.length !== v.entry.facts.entry.questions.length
    )
      return;
    this.#publish({ phase: "busy" });
    try {
      const pending = await prepareConsumerPendingV2(
        this.storage,
        {
          kind: "complete",
          binding: {
            schemaVersion: "quizforge.consumer-complete.v2",
            session: v.accepted.session,
            expectedStateRevision: v.accepted.stateRevision,
            consumerStateAnswersSha256: v.accepted.consumerStateAnswersSha256,
            progressSha256: v.accepted.progressSha256,
            matchingContextSha256: v.accepted.matchingContextSha256,
            completionKey: crypto.randomUUID(),
          },
        },
        task.current,
      );
      if (!task.current()) return;
      this.#publish({ pending });
      await this.#send(pending, task, false);
    } catch {
      this.#fail(task);
    }
  }
  /** Observe the original operation only. Recovery never sends the mutation again. */
  async recover() {
    const v = this.#value,
      task = this.task();
    if (v.phase !== "pending" || !v.pending || !task) return;
    this.#publish({ phase: "busy", resolution: undefined });
    try {
      await this.#send(v.pending, task, true, undefined, true);
    } catch {
      this.#fail(task);
    }
  }
  async #send(
    original: ConsumerPendingV2,
    task: ConsumerTaskV2,
    resolve: boolean,
    nextScreen?: ConsumerScreenV2,
    recovering = false,
  ) {
    let pending = original;
    if (!resolve) {
      pending = await markConsumerBeforeSendV2(
        this.storage,
        pending,
        task.current,
      );
      if (!task.current()) return;
      this.#publish({ pending });
      if (this.#keyExpired) {
        this.#publish({ phase: "pending" });
        return;
      }
    }
    const context = this.#writeContext(task);
    const resolution =
      pending.operation === "save"
        ? resolve
          ? await client.resolveConsumerSaveV2(pending.input.binding, context)
          : await client.saveConsumerStateV2(pending.input, context)
        : await client.completeConsumerStateV2(
            pending.binding,
            context,
            resolve,
          );
    if (!task.current()) return;
    // Never install a stale observation or merge a superseded candidate into newer server answers.
    if (
      "state" in resolution &&
      this.#value.accepted &&
      resolution.state.stateRevision < this.#value.accepted.stateRevision
    )
      throw new ConsumerClientError("UNAVAILABLE");
    this.#publish({ phase: "pending", pending, resolution });
    if (
      !recovering &&
      (resolution.kind === "applied-current" || resolution.kind === "applied")
    )
      await this.#adopt(pending, resolution, task, nextScreen);
  }
  /** Required after recovered or conflicting terminal evidence, especially superseded. */
  async adoptObserved() {
    const v = this.#value,
      task = this.task();
    if (
      v.phase !== "pending" ||
      !v.pending ||
      !v.resolution ||
      v.resolution.kind === "unresolved" ||
      !task
    )
      return;
    this.#publish({ phase: "busy" });
    try {
      await this.#adopt(v.pending, v.resolution, task);
    } catch {
      this.#fail(task);
    }
  }
  async #adopt(
    pending: ConsumerPendingV2,
    resolution: Resolution,
    task: ConsumerTaskV2,
    nextScreen?: ConsumerScreenV2,
  ) {
    if (resolution.kind === "unresolved") return;
    if ("state" in resolution && this.#value.entry)
      this.#validateCandidate(
        this.#value.entry,
        resolution.state.answers,
        resolution.state.progress,
      );
    await removeExactConsumerPendingV2(this.storage, pending, task.current);
    if (!task.current()) return;
    this.#publish({ pending: undefined, resolution: undefined });
    if ("report" in resolution) {
      await this.#report(resolution.report, task, "result");
      return;
    }
    const state = resolution.state;
    this.#publish({
      accepted: state,
      answers: state.answers,
      progress: state.progress,
      matchingContext: state.matchingContext,
      phase: this.#keyExpired ? "expired" : "active",
      screen: nextScreen ?? "resume",
    });
  }
  async #report(
    receipt: PersistedReportReceiptV2,
    task: ConsumerTaskV2,
    screen: "result" | "report",
  ) {
    const report = await client.readConsumerReportV2(
      receipt.binding.session,
      receipt,
      this.#context(task),
    );
    if (task.current())
      this.#publish({
        report,
        entry: undefined,
        accepted: undefined,
        answers: [],
        matchingContext: null,
        progress: { questionId: null },
        phase: "completed",
        screen,
      });
  }
  async logout() {
    const task = this.task();
    if (!task) return;
    const context = this.#writeContext(task);
    // Invalidate every view/media/export before awaiting the logout response. Pending is retained.
    this.revoke();
    const request = new AbortController();
    try {
      await client.logoutConsumerV2(this.sessionId, {
        csrf: context.csrf,
        ...(this.fetcher ? { fetcher: this.fetcher } : {}),
        signal: request.signal,
      });
    } catch {
      /* The view remains revoked. A response never revives the old grant. */
    }
  }
}
