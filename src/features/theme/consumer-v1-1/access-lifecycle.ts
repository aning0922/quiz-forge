import type { ConsumerExchangeResult } from "@/features/fulfillment/consumer-flow/contracts";
import { takeConsumerAccessFragmentV1 } from "../consumer-v1/access-fragment";
import { ConsumerClientError } from "../consumer-v1/request";

export type ConsumerAccessStatusV1_1 =
  "empty" | "ready" | "busy" | "unavailable" | "rate-limited" | "blocked";
type Address = Pick<Location, "href" | "pathname" | "search" | "hash">;
type Environment = Readonly<{
  readAddress: () => Address;
  erase: (pathname: string) => void;
  exchange: (
    rawKey: string,
    signal: AbortSignal,
  ) => Promise<ConsumerExchangeResult>;
  navigate: (result: ConsumerExchangeResult) => void;
}>;
type Attempt = Readonly<{ epoch: number; controller: AbortController }>;

/** Only a non-secret status is observable. Credentials and queued event targets stay private. */
export class ConsumerAccessLifecycleV1_1 {
  #raw: string | null = null;
  #cleanURL: string | null = null;
  // If a callback/continuation consumes a later URL before its native hash event,
  // ignore older queued events until that URL's event arrives. Never export it.
  #awaitingHashURL: string | null = null;
  #attempt: Attempt | null = null;
  #epoch = 0;
  #attached = false;
  #initialized = false;
  #teardown = 0;
  #status: ConsumerAccessStatusV1_1 = "empty";
  #listeners = new Set<() => void>();
  constructor(private readonly environment: Environment) {}
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
  getSnapshot = () => this.#status;
  getServerSnapshot = (): ConsumerAccessStatusV1_1 => "empty";
  #publish(status: ConsumerAccessStatusV1_1) {
    if (status === this.#status) return;
    this.#status = status;
    this.#listeners.forEach((listener) => listener());
  }
  #invalidate() {
    this.#epoch++;
    const previous = this.#attempt;
    this.#attempt = null;
    previous?.controller.abort();
  }
  #atCleanAddress() {
    try {
      return (
        this.#cleanURL !== null &&
        this.environment.readAddress().href === this.#cleanURL
      );
    } catch {
      return false;
    }
  }
  #consume(eventTarget?: string, nativeHashExpected = false) {
    this.#invalidate();
    this.#raw = null;
    this.#cleanURL = null;
    this.#awaitingHashURL = null;
    this.#initialized = true;
    try {
      const before = this.environment.readAddress();
      const clean = new URL(before.pathname, before.href).href;
      const value = takeConsumerAccessFragmentV1(
        before,
        this.environment.erase,
      );
      const after = this.environment.readAddress();
      if (after.href !== clean || after.hash !== "" || after.search !== "")
        throw Error("ACCESS_ERASURE_UNCONFIRMED");
      this.#cleanURL = clean;
      this.#raw = value;
      if (
        nativeHashExpected &&
        before.href !== clean &&
        before.href !== eventTarget
      )
        this.#awaitingHashURL = before.href;
      this.#publish(value ? "ready" : "empty");
    } catch {
      // No credential remains usable when replace throws or silently fails.
      this.#raw = null;
      this.#cleanURL = null;
      this.#awaitingHashURL = null;
      this.#publish("blocked");
    }
  }
  attach() {
    this.#attached = true;
    this.#teardown++;
    if (!this.#initialized || !this.#atCleanAddress()) this.#consume();
    else if (this.#raw && this.#status === "busy") this.#publish("ready");
    return () => {
      this.#attached = false;
      this.#invalidate();
      const teardown = ++this.#teardown;
      // React StrictMode immediately attaches the same private instance again.
      // A real unmount clears it after the effect cycle; it cannot verify detached.
      queueMicrotask(() => {
        if (this.#attached || teardown !== this.#teardown) return;
        this.#raw = null;
        this.#cleanURL = null;
        this.#awaitingHashURL = null;
        this.#initialized = false;
        this.#publish("empty");
      });
    };
  }
  hashChange(eventTarget: string) {
    if (!this.#attached) return;
    if (!this.#atCleanAddress()) {
      this.#consume(eventTarget, true);
      return;
    }
    if (this.#awaitingHashURL) {
      if (eventTarget === this.#awaitingHashURL) this.#awaitingHashURL = null;
      return;
    }
    // Nonempty targets with an already clean address were consumed synchronously
    // (e.g. initial mount). A real transition to the clean URL is new empty input.
    if (eventTarget === this.#cleanURL) this.#consume();
  }
  historyChange() {
    if (!this.#attached) return;
    // Native popstate is a new navigation, including traversal to an already
    // clean URL. replaceState erasure does not emit it. Never suppress it just
    // because a previous hashchange callback is still queued.
    this.#consume(undefined, true);
  }
  #mayCommit(attempt: Attempt) {
    if (
      !this.#attached ||
      this.#attempt !== attempt ||
      attempt.epoch !== this.#epoch ||
      attempt.controller.signal.aborted
    )
      return false;
    if (!this.#atCleanAddress()) {
      // URL changes precede hashchange dispatch. Revoke the old operation now,
      // not only when that later callback gets its turn.
      this.#consume(undefined, true);
      return false;
    }
    return true;
  }
  async verify() {
    if (!this.#attached) return;
    if (!this.#atCleanAddress()) {
      this.#consume(undefined, true);
      return; // A click on the previous input never silently verifies a new one.
    }
    if (!this.#raw || this.#attempt) return;
    const attempt: Attempt = {
      epoch: this.#epoch,
      controller: new AbortController(),
    };
    this.#attempt = attempt;
    this.#publish("busy");
    try {
      const result = await this.environment.exchange(
        this.#raw,
        attempt.controller.signal,
      );
      if (!this.#mayCommit(attempt)) return;
      this.#raw = null;
      this.#awaitingHashURL = null;
      this.environment.navigate(result);
    } catch (error) {
      if (!this.#mayCommit(attempt)) return;
      this.#publish(
        !this.#raw
          ? "blocked"
          : error instanceof ConsumerClientError &&
              error.code === "RATE_LIMITED"
            ? "rate-limited"
            : "unavailable",
      );
    } finally {
      if (
        this.#attached &&
        this.#attempt === attempt &&
        this.#epoch === attempt.epoch
      )
        this.#attempt = null;
    }
  }
}
