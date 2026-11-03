import { describe, expect, it, vi } from "vitest";
import {
  PlatformAccessController,
  platformAccessMessage,
} from "./access-controller";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import { ConsumerClientError } from "@/features/theme/consumer-v1/request";
import type { ConsumerExchangeResult } from "@/features/fulfillment/consumer-flow/contracts";
const result = (destination: "play" | "report"): ConsumerExchangeResult => ({
  schemaVersion: "quizforge.consumer-exchange.v1",
  destination,
  session: {
    productId: "synthetic-other-work",
    keyId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    playVersionId: "00000000-0000-4000-8000-000000000003",
    playSnapshotSha256: "a".repeat(64),
  },
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
describe("platform exchange owner", () => {
  it("uses the exact credential codec and never calls the service for demo/short/uppercase substitutions", async () => {
    const exchange = vi.fn(),
      owner = new PlatformAccessController({ exchange, navigate: vi.fn() });
    const detach = owner.attach();
    for (const key of [
      "QF-DEMO",
      "short",
      "x".repeat(80),
      createConsumerToken("access-key").toUpperCase(),
    ]) {
      await owner.submit(key);
      expect(owner.getSnapshot()).toEqual({
        phase: "error",
        code: "INVALID_REQUEST",
      });
    }
    expect(exchange).not.toHaveBeenCalled();
    detach();
  });
  it.each(["play", "report"] as const)(
    "follows the verified %s destination for the actual bound session",
    async (destination) => {
      const raw = createConsumerToken("access-key"),
        exchange = vi.fn(async () => result(destination)),
        navigate = vi.fn();
      const owner = new PlatformAccessController({ exchange, navigate }),
        detach = owner.attach();
      await owner.submit(raw);
      expect(exchange.mock.calls.length).toBe(1);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(
        `/play/${result(destination).session.sessionId}${destination === "report" ? "/report" : ""}`,
      );
      expect(JSON.stringify(owner.getSnapshot())).not.toContain(raw);
      detach();
    },
  );
  it("busy prevents duplicate exchange, cancellation and a late old result cannot affect a newer attempt", async () => {
    const first = deferred<ConsumerExchangeResult>(),
      second = deferred<ConsumerExchangeResult>(),
      signals: AbortSignal[] = [];
    const exchange = vi.fn((_raw: string, signal: AbortSignal) => {
        signals.push(signal);
        return signals.length === 1 ? first.promise : second.promise;
      }),
      navigate = vi.fn();
    const owner = new PlatformAccessController({ exchange, navigate }),
      detach = owner.attach();
    const a = owner.submit(createConsumerToken("access-key"));
    await owner.submit(createConsumerToken("access-key"));
    expect(exchange).toHaveBeenCalledTimes(1);
    owner.cancel();
    expect(signals[0]!.aborted).toBe(true);
    expect(platformAccessMessage(owner.getSnapshot())).toContain(
      "服务端可能已处理",
    );
    const b = owner.submit(createConsumerToken("access-key"));
    first.resolve(result("play"));
    await a;
    expect(owner.getSnapshot()).toEqual({ phase: "busy" });
    expect(navigate).not.toHaveBeenCalled();
    second.resolve(result("report"));
    await b;
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      `/play/${result("report").session.sessionId}/report`,
    );
    detach();
  });
  it("StrictMode detach/reattach cannot resend or publish a discarded success/error", async () => {
    const task = deferred<ConsumerExchangeResult>(),
      exchange = vi.fn(() => task.promise),
      navigate = vi.fn(),
      owner = new PlatformAccessController({ exchange, navigate });
    const detach = owner.attach();
    const pending = owner.submit(createConsumerToken("access-key"));
    detach();
    const detachAgain = owner.attach();
    task.reject(new ConsumerClientError("RATE_LIMITED"));
    await pending;
    expect(owner.getSnapshot()).toEqual({ phase: "idle" });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    detachAgain();
  });
  it("rejects malformed responses, cannot navigate after synchronous subscriber teardown, and exposes finite error facts", async () => {
    const navigate = vi.fn(),
      owner = new PlatformAccessController({
        exchange: async () =>
          ({
            ...result("play"),
            destination: "https://invalid.example",
          }) as unknown as ConsumerExchangeResult,
        navigate,
      });
    const detach = owner.attach();
    await owner.submit(createConsumerToken("access-key"));
    expect(owner.getSnapshot()).toEqual({
      phase: "error",
      code: "UNAVAILABLE",
    });
    expect(navigate).not.toHaveBeenCalled();
    detach();
    const other = new PlatformAccessController({
        exchange: async () => result("report"),
        navigate,
      }),
      close = other.attach();
    const unsubscribe = other.subscribe(() => {
      if (other.getSnapshot().phase === "navigating") close();
    });
    await other.submit(createConsumerToken("access-key"));
    expect(navigate).not.toHaveBeenCalled();
    unsubscribe();
  });
  it("keeps protocol-specific explanations without rendering arbitrary server errors or retrying", async () => {
    const messages = new Set<string>();
    for (const code of [
      "KEY_NOT_ACTIVE",
      "KEY_ALREADY_CLAIMED",
      "RATE_LIMITED",
      "SOURCE_OBSOLETE",
      "OUTCOME_UNKNOWN",
    ] as const) {
      const exchange = vi.fn(async () => {
          throw new ConsumerClientError(code);
        }),
        owner = new PlatformAccessController({ exchange, navigate: vi.fn() }),
        detach = owner.attach();
      await owner.submit(createConsumerToken("access-key"));
      expect(owner.getSnapshot()).toEqual({ phase: "error", code });
      messages.add(platformAccessMessage(owner.getSnapshot()));
      expect(exchange).toHaveBeenCalledTimes(1);
      detach();
    }
    expect(messages.size).toBe(5);
  });
});
