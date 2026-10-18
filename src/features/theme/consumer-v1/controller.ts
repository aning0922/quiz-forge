import {
  consumerAnswersSchema,
  consumerProgressSchema,
  consumerAnswersSha256,
  consumerProgressSha256,
  consumerAnswersText,
  consumerProgressText,
  type ConsumerAnswers,
  type ConsumerProgress,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import type {
  ConsumerSessionView,
  ConsumerSaveResolution,
  ConsumerCompleteResolution,
} from "@/features/fulfillment/consumer-flow/contracts";
import type { ConsumerEntryView } from "@/features/fulfillment/consumer-flow/display-contract";
import type {
  PersistedReportView,
  PersistedReportReceipt,
} from "@/features/report/persisted/view-contracts";
import { ConsumerAuthorityV1 } from "./authority";
import {
  readConsumerPendingV1,
  prepareConsumerPendingV1,
  markConsumerBeforeSendV1,
  removeExactConsumerPendingV1,
  type ConsumerPendingV1,
  type ConsumerPendingStorage,
} from "./pending";
import * as client from "./client";
import { ConsumerClientError, type ConsumerFetch } from "./request";

export type ConsumerScreenV1 =
  "cover" | "question" | "resume" | "review" | "result" | "report" | "poster";
type Resolution = ConsumerSaveResolution | ConsumerCompleteResolution;
export type ConsumerHostStateV1 = Readonly<{
  phase:
    | "loading"
    | "active"
    | "busy"
    | "pending"
    | "expired"
    | "completed"
    | "lost"
    | "unavailable";
  screen: ConsumerScreenV1;
  keyExpired: boolean;
  session?: ConsumerSessionView | undefined;
  entry?: ConsumerEntryView | undefined;
  report?: PersistedReportView | undefined;
  accepted?: ConsumerState | undefined;
  answers: ConsumerAnswers;
  progress: ConsumerProgress;
  pending?: ConsumerPendingV1 | undefined;
  resolution?: Resolution | undefined;
}>;
export type ConsumerTaskV1 = Readonly<{
  signal: AbortSignal;
  current: () => boolean;
}>;
/** The single owner of page authority, original pending and accepted server facts. No scoring. */
export class ConsumerControllerV1 {
  #value: ConsumerHostStateV1 = Object.freeze({
    phase: "loading",
    screen: "cover",
    keyExpired: false,
    answers: [],
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
    readonly storage: ConsumerPendingStorage,
    readonly fetcher?: ConsumerFetch,
  ) {}
  getSnapshot = () => this.#value;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(patch: Partial<ConsumerHostStateV1>) {
    this.#value = Object.freeze({ ...this.#value, ...patch });
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
      answers: [],
      progress: { questionId: null },
    });
  };
  task(): ConsumerTaskV1 | null {
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
  #context(task: ConsumerTaskV1) {
    return {
      signal: task.signal,
      ...(this.fetcher ? { fetcher: this.fetcher } : {}),
      onAuthorityFailure: () => {
        if (task.current()) this.revoke();
      },
    };
  }
  #writeContext(task: ConsumerTaskV1) {
    const session = this.#value.session;
    if (!session || !task.current())
      throw new ConsumerClientError("ACCESS_DENIED");
    return { ...this.#context(task), csrf: session.grant.csrf };
  }
  #fail(task: ConsumerTaskV1) {
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
      progress: { questionId: null },
      pending: undefined,
      resolution: undefined,
    });
    try {
      const session = await client.readConsumerSessionV1(this.sessionId, {
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
          if (this.#value.phase === "active")
            this.#publish({ phase: "expired" });
        }, keyRemaining);
      this.#publish({ session, keyExpired: this.#keyExpired });
      const pending = await readConsumerPendingV1(
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
      const entry = await client.readConsumerEntryV1(
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
    entry: ConsumerEntryView,
    answers: ConsumerAnswers,
    progress: ConsumerProgress,
  ) {
    if (
      answers.some(
        (a) =>
          !entry.facts.entry.questions.some(
            (q) =>
              q.id === a.questionId &&
              q.options.some((o) => o.id === a.optionId),
          ),
      ) ||
      (progress.questionId !== null &&
        !entry.facts.entry.questions.some((q) => q.id === progress.questionId))
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
        consumerProgressText(v.accepted.progress)
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
    if (
      consumerAnswersText(v.answers) ===
        consumerAnswersText(v.accepted.answers) &&
      consumerProgressText(progress) ===
        consumerProgressText(v.accepted.progress)
    ) {
      this.#publish({ screen, progress });
      return;
    }
    this.#publish({ phase: "busy" });
    try {
      const [answersHash, progressHash] = await Promise.all([
        consumerAnswersSha256(v.answers),
        consumerProgressSha256(progress),
      ]);
      if (!task.current() || this.#keyExpired) {
        if (task.current()) this.#publish({ phase: "expired" });
        return;
      }
      const pending = await prepareConsumerPendingV1(
        this.storage,
        {
          kind: "save",
          input: {
            binding: {
              schemaVersion: "quizforge.consumer-save.v1",
              session: v.accepted.session,
              expectedStateRevision: v.accepted.stateRevision,
              consumerStateAnswersSha256: answersHash,
              progressSha256: progressHash,
            },
            answers: v.answers,
            progress,
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
      v.screen !== "review" ||
      !v.entry ||
      !v.accepted ||
      !task ||
      this.unsaved() ||
      v.answers.length !== v.entry.facts.entry.questions.length
    )
      return;
    this.#publish({ phase: "busy" });
    try {
      const pending = await prepareConsumerPendingV1(
        this.storage,
        {
          kind: "complete",
          binding: {
            schemaVersion: "quizforge.consumer-complete.v1",
            session: v.accepted.session,
            expectedStateRevision: v.accepted.stateRevision,
            consumerStateAnswersSha256: v.accepted.consumerStateAnswersSha256,
            progressSha256: v.accepted.progressSha256,
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
  /** Explicit original replay only. Neither retry nor resolve creates a new binding. */
  async recover(replay = false) {
    const v = this.#value,
      task = this.task();
    if (
      v.phase !== "pending" ||
      !v.pending ||
      !task ||
      (replay && this.#keyExpired)
    )
      return;
    this.#publish({ phase: "busy", resolution: undefined });
    try {
      await this.#send(v.pending, task, !replay, undefined, true);
    } catch {
      this.#fail(task);
    }
  }
  async #send(
    original: ConsumerPendingV1,
    task: ConsumerTaskV1,
    resolve: boolean,
    nextScreen?: ConsumerScreenV1,
    recovering = false,
  ) {
    let pending = original;
    if (!resolve) {
      pending = await markConsumerBeforeSendV1(
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
          ? await client.resolveConsumerSaveV1(pending.input.binding, context)
          : await client.saveConsumerStateV1(pending.input, context)
        : await client.completeConsumerStateV1(
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
    pending: ConsumerPendingV1,
    resolution: Resolution,
    task: ConsumerTaskV1,
    nextScreen?: ConsumerScreenV1,
  ) {
    if (resolution.kind === "unresolved") return;
    if ("state" in resolution && this.#value.entry)
      this.#validateCandidate(
        this.#value.entry,
        resolution.state.answers,
        resolution.state.progress,
      );
    await removeExactConsumerPendingV1(this.storage, pending, task.current);
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
      phase: this.#keyExpired ? "expired" : "active",
      screen: nextScreen ?? "resume",
    });
  }
  async #report(
    receipt: PersistedReportReceipt,
    task: ConsumerTaskV1,
    screen: "result" | "report",
  ) {
    const report = await client.readConsumerReportV1(
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
      await client.logoutConsumerV1(this.sessionId, {
        csrf: context.csrf,
        ...(this.fetcher ? { fetcher: this.fetcher } : {}),
        signal: request.signal,
      });
    } catch {
      /* The view remains revoked. A response never revives the old grant. */
    }
  }
}
