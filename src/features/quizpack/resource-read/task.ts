import "server-only";
import { StudioError } from "@/lib/http-security/errors";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";

const active = new Set<ResourceReadTask>();
/** A slot represents live IO AND retained verified bytes, not merely a handler promise. */
export class ResourceReadTask {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  readonly deadlineMonotonicMs: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private settled = false;
  private bodyEnded = true;
  private released = false;
  private reason: StudioError | undefined;
  private readonly unconfirmed: unknown[] = [];
  get hasUnconfirmedIo(): boolean {
    return this.unconfirmed.length > 0;
  }
  quarantine(resource: unknown): void {
    this.unconfirmed.push(resource);
    this.stop(new StudioError("PREVIEW_RESOURCE_UNAVAILABLE"));
  }
  private readonly abortRequest: () => void;
  private constructor(
    private readonly requestSignal: AbortSignal,
    startedAt: number,
  ) {
    this.deadlineMonotonicMs = startedAt + PREVIEW_LIMITS.deadlineMs;
    this.abortRequest = () => this.stop(new StudioError("PREVIEW_CANCELLED"));
    requestSignal.addEventListener("abort", this.abortRequest, { once: true });
    this.timer = setTimeout(
      () => this.stop(new StudioError("PREVIEW_TIMEOUT")),
      Math.max(0, this.deadlineMonotonicMs - performance.now()),
    );
    this.timer.unref?.();
    if (requestSignal.aborted) this.abortRequest();
  }
  static acquire(
    signal: AbortSignal,
    startedAt = performance.now(),
  ): ResourceReadTask {
    const now = performance.now();
    if (!Number.isFinite(startedAt) || startedAt < 0 || startedAt > now)
      throw new StudioError("INVALID_REQUEST");
    if (active.size >= PREVIEW_LIMITS.imageReadSlots)
      throw new StudioError("PREVIEW_BUSY");
    const task = new ResourceReadTask(signal, startedAt);
    active.add(task);
    return task;
  }
  stop(reason: StudioError): void {
    if (!this.reason) this.reason = reason;
    this.controller.abort();
  }
  checkpoint(): void {
    if (performance.now() >= this.deadlineMonotonicMs)
      this.stop(new StudioError("PREVIEW_TIMEOUT"));
    if (this.reason) throw this.reason;
  }
  private maybeRelease(): void {
    if (
      this.released ||
      !this.settled ||
      !this.bodyEnded ||
      this.hasUnconfirmedIo
    )
      return;
    this.released = true;
    clearTimeout(this.timer);
    this.requestSignal.removeEventListener("abort", this.abortRequest);
    active.delete(this);
  }
  /** Track the entire real operation. A deadline race does not settle or free it. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(this.reason ?? new StudioError("PREVIEW_CANCELLED"));
      this.signal.addEventListener("abort", onAbort, { once: true });
      if (this.signal.aborted) onAbort();
    });
    const actual = Promise.resolve().then(() => {
      this.checkpoint();
      return work();
    });
    void actual.then(
      () => {
        this.settled = true;
        this.maybeRelease();
      },
      () => {
        this.settled = true;
        this.maybeRelease();
      },
    );
    try {
      return await Promise.race([actual, cancelled]);
    } catch (error) {
      // Observe real cleanup for at most 5s. Pending work still owns its slot forever until actual settlement.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        actual.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, PREVIEW_LIMITS.closeObservationMs);
          timer.unref?.();
        }),
      ]);
      clearTimeout(timer);
      throw error;
    } finally {
      if (onAbort) this.signal.removeEventListener("abort", onAbort);
    }
  }
  /** Only already verified memory enters here; FS is closed before creating the body. */
  body(bytes: Buffer, onBodySettled?: () => void): ReadableStream<Uint8Array> {
    this.checkpoint();
    this.bodyEnded = false;
    let retained: Buffer | undefined = bytes,
      offset = 0,
      ended = false;
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      if (ended) return;
      ended = true;
      retained = undefined;
      this.signal.removeEventListener("abort", abort);
      this.bodyEnded = true;
      try {
        onBodySettled?.();
      } finally {
        this.maybeRelease();
      }
    };
    const abort = () => {
      if (ended) return;
      streamController.error(
        this.reason ?? new StudioError("PREVIEW_CANCELLED"),
      );
      finish();
    };
    return new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          streamController = controller;
          this.signal.addEventListener("abort", abort, { once: true });
          if (this.signal.aborted) abort();
        },
        pull: (controller) => {
          try {
            this.checkpoint();
            if (!retained || ended) return;
            if (offset === retained.length) {
              controller.close();
              finish();
              return;
            }
            const end = Math.min(
              offset + PREVIEW_LIMITS.imageChunkBytes,
              retained.length,
            );
            const chunk = new Uint8Array(end - offset);
            chunk.set(retained.subarray(offset, end));
            offset = end;
            controller.enqueue(chunk);
            // Closure occurs on the next pull, retaining a slot while the last chunk is backpressured.
          } catch (error) {
            controller.error(error);
            finish();
          }
        },
        cancel: () => {
          this.stop(new StudioError("PREVIEW_CANCELLED"));
          finish();
        },
      },
      { highWaterMark: 1 },
    );
  }
}
