import { z } from "zod";
import type { StudioSessionDto } from "../contracts";
import type { InternalVersionList } from "@/features/product/internal-versions/contracts";
import { readInternalVersions } from "../internal-versions/client";
import { StudioClientError } from "../client";
import {
  consumerMomentSchema,
  consumerUuidSchema,
} from "@/lib/consumer-contract/v1/primitives";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import {
  internalPlayBindingSha256,
  type InternalPlayReceipt,
} from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSha256,
  type AccessKeyDetail,
  type AccessKeyCursor,
} from "@/features/fulfillment/access/contracts";
import {
  verifyInternalPlayResolution,
  verifyIssueAccessKeyResolution,
  type InternalPlayResolution,
  type IssueAccessKeyResolution,
  type VoidUnusedAccessKeyResolution,
} from "@/features/fulfillment/consumer-flow/operator-resolutions";
import {
  ConsumerClientError,
  requestConsumerJson,
  type ConsumerFetch,
} from "@/features/theme/consumer-v1/request";
import type { ConsumerPendingStorage } from "@/features/theme/consumer-v1/pending";
import * as api from "./client";
import {
  newStudioIssueV1,
  studioConsumerScopeSchemaV1,
  readStudioConsumerPendingV1,
  prepareStudioConsumerPendingV1,
  markStudioConsumerBeforeSendV1,
  removeExactStudioConsumerPendingV1,
  type StudioConsumerPendingV1,
  type StudioConsumerOperationV1,
  type StudioConsumerScopeV1,
} from "./pending";

const sessionSchema = z.strictObject({
  operator: z.strictObject({
    id: consumerUuidSchema,
    label: z.string().min(1).max(160),
    role: z.enum(["operator", "read-only"]),
  }),
  csrfToken: z
    .string()
    .length(43)
    .regex(/^[A-Za-z0-9_-]{43}$/),
  idleExpiresAt: consumerMomentSchema,
  absoluteExpiresAt: consumerMomentSchema,
});
type Evidence =
  | { kind: "play"; value: InternalPlayResolution }
  | { kind: "issue"; value: IssueAccessKeyResolution }
  | { kind: "void"; value: VoidUnusedAccessKeyResolution };
type PublicPending = Readonly<{
  kind: StudioConsumerOperationV1["kind"];
  mayHaveBeenSent: boolean;
  hasRaw: boolean;
}>;
export type StudioConsumerStateV1 = Readonly<{
  phase: "loading" | "ready" | "working" | "pending" | "lost" | "unavailable";
  session: StudioSessionDto | null;
  versions: Readonly<InternalVersionList["versions"]>;
  plays: readonly InternalPlayReceipt[];
  keys: readonly AccessKeyDetail[];
  nextCursor: AccessKeyCursor | null;
  pending: PublicPending | null;
  evidence: Evidence | null;
  notice: "none" | "unavailable" | "copied" | "exported";
}>;
type Task = Readonly<{ signal: AbortSignal; current: () => boolean }>;
/** Raw escrow never enters the public snapshot, React props, metadata lists or ordinary DOM. */
export class StudioConsumerControllerV1 {
  readonly scope: StudioConsumerScopeV1;
  #state: StudioConsumerStateV1 = Object.freeze({
    phase: "loading",
    session: null,
    versions: [],
    plays: [],
    keys: [],
    nextCursor: null,
    pending: null,
    evidence: null,
    notice: "none",
  });
  #listeners = new Set<() => void>();
  #epoch = 0;
  #abort = new AbortController();
  #pending: StudioConsumerPendingV1 | null = null;
  constructor(
    scope: StudioConsumerScopeV1,
    readonly renderer: ConsumerRendererIdentity,
    readonly storage: ConsumerPendingStorage,
    readonly fetcher?: ConsumerFetch,
    readonly readVersions = readInternalVersions,
  ) {
    this.scope = Object.freeze(studioConsumerScopeSchemaV1.parse(scope));
  }
  getSnapshot = () => this.#state;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  #publish(patch: Partial<StudioConsumerStateV1>) {
    this.#state = Object.freeze({ ...this.#state, ...patch });
    for (const listener of this.#listeners) listener();
  }
  #invalidate() {
    this.#epoch++;
    this.#abort.abort();
    this.#abort = new AbortController();
  }
  dispose() {
    this.#invalidate();
    this.#pending = null;
    this.#listeners.clear();
  }
  revoke = () => {
    this.#invalidate();
    this.#pending = null;
    this.#publish({
      phase: "lost",
      session: null,
      versions: [],
      plays: [],
      keys: [],
      nextCursor: null,
      pending: null,
      evidence: null,
      notice: "none",
    });
  };
  #task(): Task {
    const epoch = this.#epoch,
      signal = this.#abort.signal;
    return { signal, current: () => epoch === this.#epoch && !signal.aborted };
  }
  #context(task: Task, session: StudioSessionDto): api.StudioConsumerContextV1 {
    return {
      signal: task.signal,
      csrf: session.csrfToken,
      ...(this.fetcher ? { fetcher: this.fetcher } : {}),
      onAuthorityFailure: () => {
        if (task.current()) this.revoke();
      },
    };
  }
  #publicPending(value: StudioConsumerPendingV1 | null): PublicPending | null {
    return value
      ? Object.freeze({
          kind: value.operation.kind,
          mayHaveBeenSent: value.mayHaveBeenSent,
          hasRaw:
            value.operation.kind === "issue" && value.operation.raw !== null,
        })
      : null;
  }
  async #fresh(task: Task, write: boolean) {
    try {
      const session = await requestConsumerJson(
        "/api/studio/auth/session",
        {
          method: "GET",
          maximum: 8192,
          statuses: [200],
          signal: task.signal,
          ...(this.fetcher ? { fetcher: this.fetcher } : {}),
        },
        (v) => sessionSchema.parse(v),
      );
      if (!task.current()) throw new ConsumerClientError("ACCESS_DENIED");
      if (
        session.operator.id !== this.scope.issuerId ||
        (write && session.operator.role !== "operator")
      )
        throw new ConsumerClientError("OPERATOR_REQUIRED");
      this.#publish({ session });
      return session;
    } catch {
      if (task.current()) this.revoke();
      throw new ConsumerClientError("ACCESS_DENIED");
    }
  }
  #failure(task: Task, error: unknown) {
    if (!task.current()) return;
    if (
      error instanceof StudioClientError &&
      [
        "UNAUTHENTICATED",
        "CAPABILITY_DENIED",
        "CSRF_REJECTED",
        "ORIGIN_REJECTED",
      ].includes(error.code)
    ) {
      this.revoke();
      return;
    }
    this.#publish({
      phase: this.#pending ? "pending" : "unavailable",
      notice: "unavailable",
    });
  }
  async refresh() {
    this.#invalidate();
    const task = this.#task();
    this.#publish({ phase: "loading", evidence: null, notice: "none" });
    try {
      const session = await this.#fresh(task, false);
      const pending = await readStudioConsumerPendingV1(
        this.storage,
        this.scope,
      );
      if (!task.current()) return;
      this.#pending = pending;
      this.#publish({ pending: this.#publicPending(pending) });
      const context = this.#context(task, session);
      const [versions, plays, keys] = await Promise.all([
        this.readVersions(this.scope.productId, task.signal),
        api.readStudioPlaysV1(this.scope.productId, context),
        api.readStudioKeysV1(this.scope.productId, context),
      ]);
      if (task.current())
        this.#publish({
          versions: versions.versions,
          plays: plays.versions,
          keys: keys.keys,
          nextCursor: keys.nextCursor,
          phase: pending ? "pending" : "ready",
        });
    } catch (error) {
      this.#failure(task, error);
    }
  }
  async nextKeys() {
    const cursor = this.#state.nextCursor;
    if (!cursor || !["ready", "pending"].includes(this.#state.phase)) return;
    const task = this.#task();
    this.#publish({ phase: "working" });
    try {
      const session = await this.#fresh(task, false),
        value = await api.readStudioKeysV1(
          this.scope.productId,
          this.#context(task, session),
          cursor,
        );
      if (task.current())
        this.#publish({
          keys: value.keys,
          nextCursor: value.nextCursor,
          phase: this.#pending ? "pending" : "ready",
        });
    } catch (error) {
      this.#failure(task, error);
    }
  }
  async createPlay(versionId: string) {
    const version = this.#state.versions.find((v) => v.id === versionId);
    if (!version) return;
    await this.#prepare({
      kind: "play",
      binding: {
        schemaVersion: "quizforge.internal-play-create.v1",
        operationKey: crypto.randomUUID(),
        parent: {
          productId: this.scope.productId,
          versionId: version.id,
          snapshotSha256: version.snapshotSha256,
        },
        renderer: this.renderer,
      },
    });
  }
  async issueKey(playId: string, seconds: number) {
    if (this.#state.phase !== "ready") return;
    const play = this.#state.plays.find((p) => p.id === playId);
    if (!play) return;
    const task = this.#task();
    this.#publish({ phase: "working", notice: "none" });
    try {
      await this.#fresh(task, true);
      const operation = await newStudioIssueV1(
        {
          productId: this.scope.productId,
          playVersionId: play.id,
          playSnapshotSha256: play.snapshotSha256,
        },
        seconds,
      );
      if (task.current()) await this.#prepareAndSend(operation, task);
    } catch (error) {
      this.#failure(task, error);
    }
  }
  async voidKey(keyId: string) {
    const key = this.#state.keys.find((k) => k.issue.binding.keyId === keyId);
    if (!key || key.current.claim || key.current.voidReceipt) return;
    await this.#prepare({
      kind: "void",
      binding: {
        schemaVersion: "quizforge.access-key-void-unused.v1",
        productId: this.scope.productId,
        operationKey: crypto.randomUUID(),
        keyId,
        issueBindingSha256: key.issue.bindingSha256,
      },
    });
  }
  async #prepare(operation: StudioConsumerOperationV1) {
    if (this.#state.phase !== "ready") return;
    const task = this.#task();
    this.#publish({ phase: "working", notice: "none" });
    try {
      await this.#fresh(task, true);
      if (task.current()) await this.#prepareAndSend(operation, task);
    } catch (error) {
      this.#failure(task, error);
    }
  }
  async #prepareAndSend(operation: StudioConsumerOperationV1, task: Task) {
    const pending = await prepareStudioConsumerPendingV1(
      this.storage,
      this.scope,
      operation,
      task.current,
    );
    if (!task.current()) return;
    this.#pending = pending;
    this.#publish({ pending: this.#publicPending(pending) });
    await this.#send(task, false);
  }
  async recover(replay = false) {
    if (this.#state.phase !== "pending" || !this.#pending) return;
    const task = this.#task();
    this.#publish({ phase: "working", evidence: null, notice: "none" });
    try {
      await this.#fresh(task, replay);
      if (task.current()) await this.#send(task, !replay);
    } catch (error) {
      this.#failure(task, error);
    }
  }
  async #send(task: Task, resolve: boolean) {
    let pending = this.#pending;
    if (!pending || !task.current() || !this.#state.session) return;
    if (!resolve) {
      pending = await markStudioConsumerBeforeSendV1(
        this.storage,
        pending,
        task.current,
      );
      if (!task.current()) return;
      this.#pending = pending;
      this.#publish({ pending: this.#publicPending(pending) });
    } else {
      const back = await readStudioConsumerPendingV1(this.storage, this.scope);
      if (
        !task.current() ||
        !back ||
        JSON.stringify(back) !== JSON.stringify(pending)
      )
        throw new ConsumerClientError("UNAVAILABLE");
    }
    const operation = pending.operation,
      context = this.#context(task, this.#state.session);
    let evidence: Evidence;
    if (operation.kind === "play") {
      if (resolve)
        evidence = {
          kind: "play",
          value: await api.resolveStudioPlayV1(operation.binding, context),
        };
      else {
        const result = await api.createStudioPlayV1(operation.binding, context);
        evidence = {
          kind: "play",
          value: await verifyInternalPlayResolution(
            {
              schemaVersion: "quizforge.internal-play-resolution.v1",
              kind: "applied",
              binding: operation.binding,
              bindingSha256: await internalPlayBindingSha256(operation.binding),
              play: result.play,
            },
            operation.binding,
          ),
        };
      }
    } else if (operation.kind === "issue") {
      if (resolve)
        evidence = {
          kind: "issue",
          value: await api.resolveStudioIssueV1(operation.binding, context),
        };
      else {
        const result = await api.issueStudioKeyV1(operation.binding, context);
        evidence = {
          kind: "issue",
          value: await verifyIssueAccessKeyResolution(
            {
              schemaVersion: "quizforge.access-key-issue-resolution.v1",
              kind: "applied",
              binding: operation.binding,
              bindingSha256: await issueAccessKeyBindingSha256(
                operation.binding,
              ),
              key: result.key,
            },
            operation.binding,
          ),
        };
      }
    } else
      evidence = {
        kind: "void",
        value: await api.voidStudioKeyV1(operation.binding, context, resolve),
      };
    if (task.current()) this.#publish({ phase: "pending", evidence });
  }
  async finish() {
    if (
      this.#state.phase !== "pending" ||
      !this.#pending ||
      !this.#state.evidence ||
      this.#state.evidence.value.kind === "unresolved"
    )
      return;
    const task = this.#task(),
      pending = this.#pending;
    this.#publish({ phase: "working" });
    try {
      await this.#fresh(task, false);
      await removeExactStudioConsumerPendingV1(
        this.storage,
        pending,
        task.current,
      );
      if (task.current()) {
        this.#pending = null;
        await this.refresh();
      }
    } catch (error) {
      this.#failure(task, error);
    }
  }
  /** Explicit user copy/download only; fresh identity and current Key facts precede any raw exposure. */
  async exposeSecret(
    expose: (link: string, current: () => boolean) => Promise<void>,
    kind: "copied" | "exported",
  ) {
    const pending = this.#pending,
      evidence = this.#state.evidence;
    if (
      this.#state.phase !== "pending" ||
      pending?.operation.kind !== "issue" ||
      !pending.operation.raw ||
      evidence?.kind !== "issue" ||
      evidence.value.kind !== "applied"
    )
      return;
    const task = this.#task();
    this.#publish({ phase: "working", notice: "none" });
    try {
      const session = await this.#fresh(task, true),
        key = await api.readStudioKeyV1(
          this.scope.productId,
          pending.operation.binding.keyId,
          this.#context(task, session),
        );
      const back = await readStudioConsumerPendingV1(this.storage, this.scope);
      if (
        !task.current() ||
        !back ||
        back.operation.kind !== "issue" ||
        back.operation.raw !== pending.operation.raw ||
        JSON.stringify(back) !== JSON.stringify(pending) ||
        key.issue.issuedBy !== this.scope.issuerId ||
        key.issue.bindingSha256 !== evidence.value.key.issue.bindingSha256 ||
        key.current.voidReceipt ||
        (!key.current.completion &&
          Date.parse(key.issue.expiresAt) <= Date.parse(key.current.observedAt))
      )
        throw new ConsumerClientError("UNAVAILABLE");
      await this.#fresh(task, true);
      if (!task.current()) return;
      const link = new URL("/access", this.scope.origin);
      link.hash = new URLSearchParams({ key: back.operation.raw! }).toString();
      await expose(link.toString(), task.current);
      if (task.current()) this.#publish({ phase: "pending", notice: kind });
    } catch (error) {
      this.#failure(task, error);
    }
  }
}
