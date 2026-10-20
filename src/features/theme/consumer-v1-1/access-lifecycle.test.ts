import { expect, it } from "vitest";
import type { ConsumerExchangeResult } from "@/features/fulfillment/consumer-flow/contracts";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import { ConsumerClientError } from "../consumer-v1/request";
import { ConsumerAccessLifecycleV1_1 } from "./access-lifecycle";

const result: ConsumerExchangeResult = {
  schemaVersion: "quizforge.consumer-exchange.v1",
  session: {
    productId: "synthetic-product",
    keyId: "00000000-0000-4000-8000-000000000020",
    sessionId: "00000000-0000-4000-8000-000000000021",
    playVersionId: "00000000-0000-4000-8000-000000000022",
    playSnapshotSha256: "a".repeat(64),
  },
  destination: "play",
};
function host() {
  let address = new URL("http://127.0.0.1/access"),
    erasure: "normal" | "throw" | "noop" = "normal";
  const calls: {
    raw: string;
    signal: AbortSignal;
    resolve: (result: ConsumerExchangeResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  let navigations = 0;
  const lifecycle = new ConsumerAccessLifecycleV1_1({
    readAddress: () => ({
      href: address.href,
      pathname: address.pathname,
      search: address.search,
      hash: address.hash,
    }),
    erase: (pathname) => {
      if (erasure === "throw") throw Error("synthetic erasure failure");
      if (erasure === "normal") address = new URL(pathname, address);
    },
    exchange: (raw, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ raw, signal, resolve, reject });
      }),
    navigate: () => {
      navigations++;
    },
  });
  return {
    lifecycle,
    calls,
    input(hash: string, search = "") {
      address = new URL("/access" + search + hash, address);
      return address.href;
    },
    get clean() {
      return !address.hash && !address.search && !address.href.endsWith("#");
    },
    get navigations() {
      return navigations;
    },
    failErase(value: typeof erasure) {
      erasure = value;
    },
  };
}
const key = () => createConsumerToken("access-key");

it("captures/erases on attach and empty-to-Key, with zero automatic exchange", async () => {
  const h = host(),
    detach = h.lifecycle.attach(),
    raw = key();
  expect(h.lifecycle.getSnapshot()).toBe("empty");
  h.lifecycle.hashChange(h.input("#key=" + raw));
  expect(
    h.clean && h.lifecycle.getSnapshot() === "ready" && h.calls.length === 0,
  ).toBe(true);
  const verifying = h.lifecycle.verify();
  expect(h.calls.length === 1 && h.calls[0]!.raw === raw).toBe(true);
  h.calls[0]!.resolve(result);
  await verifying;
  expect(h.navigations).toBe(1);
  detach();
});

it("ready A to B submits only B on an explicit click", async () => {
  const h = host(),
    a = key(),
    b = key();
  h.input("#key=" + a);
  const detach = h.lifecycle.attach();
  h.lifecycle.hashChange(h.input("#key=" + b));
  expect(h.calls.length === 0 && h.clean).toBe(true);
  const verifying = h.lifecycle.verify();
  expect(
    h.calls.length === 1 && h.calls[0]!.raw === b && h.calls[0]!.raw !== a,
  ).toBe(true);
  h.calls[0]!.resolve(result);
  await verifying;
  detach();
});

for (const invalid of [
  "malformed",
  "duplicate",
  "other-field",
  "empty",
  "query",
] as const) {
  it(`invalidates old Key on ${invalid} input`, async () => {
    const h = host(),
      a = key(),
      b = key();
    h.input("#key=" + a);
    const detach = h.lifecycle.attach();
    const target = h.input(
      invalid === "malformed"
        ? "#key=bad"
        : invalid === "duplicate"
          ? `#key=${b}&key=${b}`
          : invalid === "other-field"
            ? `#key=${b}&other=value`
            : invalid === "empty"
              ? "#"
              : "#key=" + b,
      invalid === "query" ? "?source=synthetic" : "",
    );
    h.lifecycle.hashChange(target);
    await h.lifecycle.verify();
    expect(
      h.clean && h.calls.length === 0 && h.lifecycle.getSnapshot() === "empty",
    ).toBe(true);
    detach();
  });
}

for (const settle of ["success", "error"] as const) {
  it(`blocks old ${settle} before hashchange dispatch and retains freshly captured B`, async () => {
    const h = host(),
      a = key(),
      b = key();
    h.input("#key=" + a);
    const detach = h.lifecycle.attach();
    const old = h.lifecycle.verify(),
      target = h.input("#key=" + b);
    if (settle === "success") h.calls[0]!.resolve(result);
    else h.calls[0]!.reject(new ConsumerClientError("RATE_LIMITED"));
    await old;
    expect(
      h.navigations === 0 &&
        h.clean &&
        h.calls[0]!.signal.aborted &&
        h.lifecycle.getSnapshot() === "ready",
    ).toBe(true);
    h.lifecycle.hashChange(target);
    const current = h.lifecycle.verify();
    expect(h.calls.length === 2 && h.calls[1]!.raw === b).toBe(true);
    h.calls[1]!.resolve(result);
    await current;
    expect(h.navigations).toBe(1);
    detach();
  });
}

it("an old catch/finally cannot alter a new busy attempt or admit a duplicate", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  const old = h.lifecycle.verify(),
    b = key();
  h.lifecycle.hashChange(h.input("#key=" + b));
  const current = h.lifecycle.verify();
  h.calls[0]!.reject(new ConsumerClientError("RATE_LIMITED"));
  await old;
  expect(h.lifecycle.getSnapshot()).toBe("busy");
  await h.lifecycle.verify();
  expect(
    h.calls.length === 2 &&
      h.calls[0]!.signal.aborted &&
      !h.calls[1]!.signal.aborted &&
      h.calls[1]!.raw === b,
  ).toBe(true);
  h.calls[1]!.resolve(result);
  await current;
  detach();
});

it("a pre-event click captures and erases the new input but requires a fresh manual verification", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  const b = key(),
    target = h.input("#key=" + b);
  await h.lifecycle.verify();
  expect(
    h.calls.length === 0 && h.clean && h.lifecycle.getSnapshot() === "ready",
  ).toBe(true);
  h.lifecycle.hashChange(target);
  const current = h.lifecycle.verify();
  expect(h.calls.length === 1 && h.calls[0]!.raw === b).toBe(true);
  h.calls[0]!.resolve(result);
  await current;
  detach();
});

it("coalesces continuous native events without discarding the latest valid capture", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  const stale = h.input("#key=" + key()),
    empty = h.input(""),
    c = key(),
    latest = h.input("#key=" + c);
  for (const event of [stale, empty, latest, latest])
    h.lifecycle.hashChange(event);
  expect(
    h.clean && h.lifecycle.getSnapshot() === "ready" && h.calls.length === 0,
  ).toBe(true);
  const current = h.lifecycle.verify();
  expect(h.calls.length === 1 && h.calls[0]!.raw === c).toBe(true);
  h.calls[0]!.resolve(result);
  await current;
  detach();
});

it("a real queued final empty transition invalidates a prior usable capture", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  const stale = h.input("#key=" + key()),
    empty = h.input("");
  h.lifecycle.hashChange(stale);
  h.lifecycle.hashChange(empty);
  await h.lifecycle.verify();
  expect(h.calls.length === 0 && h.lifecycle.getSnapshot() === "empty").toBe(
    true,
  );
  detach();
});

for (const failure of ["throw", "noop"] as const) {
  it(`fails closed on ${failure} erasure without retaining the previous usable Key`, async () => {
    const h = host();
    h.input("#key=" + key());
    const detach = h.lifecycle.attach();
    h.failErase(failure);
    h.lifecycle.hashChange(h.input("#key=" + key()));
    await h.lifecycle.verify();
    expect(
      h.calls.length === 0 && h.lifecycle.getSnapshot() === "blocked",
    ).toBe(true);
    detach();
  });
}

it("preserves a valid capture across StrictMode's immediate effect cycle, then clears on real unmount", async () => {
  const h = host(),
    raw = key();
  h.input("#key=" + raw);
  h.lifecycle.attach()();
  const detach = h.lifecycle.attach();
  await Promise.resolve();
  expect(
    h.lifecycle.getSnapshot() === "ready" && h.clean && h.calls.length === 0,
  ).toBe(true);
  const current = h.lifecycle.verify();
  expect(h.calls.length === 1 && h.calls[0]!.raw === raw).toBe(true);
  detach();
  h.calls[0]!.resolve(result);
  await current;
  await Promise.resolve();
  expect(
    h.navigations === 0 &&
      h.calls[0]!.signal.aborted &&
      h.lifecycle.getSnapshot() === "empty",
  ).toBe(true);
  const detachAgain = h.lifecycle.attach();
  await h.lifecycle.verify();
  expect(h.calls.length).toBe(1);
  detachAgain();
});

it("handles popstate and query mutation without restoring or sending a stale token", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  h.input("#key=" + key(), "?source=synthetic");
  h.lifecycle.historyChange();
  await h.lifecycle.verify();
  expect(
    h.calls.length === 0 && h.clean && h.lifecycle.getSnapshot() === "empty",
  ).toBe(true);
  detach();
});

it("native clean popstate invalidates a capture even before its prior hashchange callback", async () => {
  const h = host(),
    detach = h.lifecycle.attach();
  const target = h.input("#key=" + key());
  h.lifecycle.historyChange();
  h.lifecycle.historyChange();
  h.lifecycle.hashChange(target);
  await h.lifecycle.verify();
  expect(h.calls.length === 0 && h.lifecycle.getSnapshot() === "empty").toBe(
    true,
  );
  detach();
});

it("duplicate verification is blocked and current errors permit only explicit retry", async () => {
  const h = host();
  h.input("#key=" + key());
  const detach = h.lifecycle.attach();
  const first = h.lifecycle.verify();
  await h.lifecycle.verify();
  expect(h.calls.length).toBe(1);
  h.calls[0]!.reject(new ConsumerClientError("RATE_LIMITED"));
  await first;
  expect(h.lifecycle.getSnapshot()).toBe("rate-limited");
  const second = h.lifecycle.verify();
  expect(h.calls.length).toBe(2);
  h.calls[1]!.reject(new ConsumerClientError("UNAVAILABLE"));
  await second;
  expect(h.lifecycle.getSnapshot()).toBe("unavailable");
  detach();
});
