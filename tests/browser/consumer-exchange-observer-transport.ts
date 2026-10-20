import { expect, type Page } from "@playwright/test";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import { observeNextConsumerExchange } from "../e2e/consumer-exchange-observer";

/** Extra transport/attacker/timeout proofs against the same actual SSR HTTP host. */
export async function proveExchangeObserverTransport(fixture: {
  newPage: () => Promise<Page>;
  ready: (page: Page, raw: string) => Promise<void>;
  permit: (raw: string, content: "valid" | "hang") => void;
  posts: () => number;
}) {
  const facts: Record<string, unknown>[] = [];
  for (const arity of [1, 2]) {
    const page = await fixture.newPage(),
      raw = createConsumerToken("access-key");
    await fixture.ready(page, raw);
    await page.evaluate(
      ({ raw, arity }) => {
        const native = globalThis.fetch;
        const init: RequestInit = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rawKey: raw }),
        };
        const request = new Request(location.origin + "/access/exchange", init);
        const args: Parameters<typeof fetch> =
          arity === 1
            ? [request]
            : [location.origin + "/access/exchange", init];
        let actual: Response | undefined,
          sameArgs = false,
          sameThis = false;
        const hook = {
          async fetch(this: unknown, ...received: Parameters<typeof fetch>) {
            sameArgs =
              received.length === args.length &&
              received.every((value, i) => value === args[i]);
            sameThis = this === globalThis;
            actual = await Reflect.apply(native, this, received);
            return actual;
          },
          async invoke() {
            const response: Response = await Reflect.apply(
              globalThis.fetch,
              globalThis,
              args,
            );
            const originalResponse = response === actual,
              bodyUnused = !response.bodyUsed;
            const body = await response.json();
            return {
              sameArgs,
              sameThis,
              originalResponse,
              bodyUnused,
              status: response.status,
              bodyMatched:
                body.schemaVersion === "quizforge.consumer-exchange.v1",
            };
          },
        };
        globalThis.fetch = hook.fetch;
        Reflect.set(
          window.accessLifecycleProbe,
          "invokeTransport",
          hook.invoke,
        );
      },
      { raw, arity },
    );
    const observer = await observeNextConsumerExchange(page),
      before = fixture.posts();
    fixture.permit(raw, "valid");
    const proof = await page.evaluate(() =>
      Reflect.get(window.accessLifecycleProbe, "invokeTransport")(),
    );
    const observed = await observer.observation;
    expect(observed.ok && fixture.posts() === before + 1).toBe(true);
    expect(proof).toEqual({
      sameArgs: true,
      sameThis: true,
      originalResponse: true,
      bodyUnused: true,
      status: 200,
      bodyMatched: true,
    });
    await observer.dispose();
    await page.close();
    facts.push({
      name: "observer-original-transport-arity-" + arity,
      ...proof,
      posts: 1,
    });
  }
  for (const rejection of [
    "native-invalid-receiver",
    "exact-rejection-object",
  ]) {
    const page = await fixture.newPage(),
      before = fixture.posts();
    await page.evaluate((rejection) => {
      const native = globalThis.fetch,
        failure = new TypeError("synthetic fetch rejection");
      if (rejection === "exact-rejection-object") {
        const rejected = {
          fetch() {
            return Promise.reject(failure);
          },
        };
        globalThis.fetch = rejected.fetch;
      }
      const invoke = {
        async run() {
          try {
            await Reflect.apply(
              globalThis.fetch,
              rejection === "native-invalid-receiver" ? {} : globalThis,
              [location.origin + "/access/exchange", { method: "POST" }],
            );
            return false;
          } catch (error) {
            return rejection === "exact-rejection-object"
              ? error === failure
              : error instanceof TypeError;
          }
        },
      };
      Reflect.set(window.accessLifecycleProbe, "originalFetch", native);
      Reflect.set(window.accessLifecycleProbe, "invokeRejection", invoke.run);
    }, rejection);
    const observer = await observeNextConsumerExchange(page);
    expect(
      await page.evaluate(() =>
        Reflect.get(window.accessLifecycleProbe, "invokeRejection")(),
      ),
    ).toBe(true);
    await observer.dispose();
    const observed = await observer.observation;
    expect(!observed.ok && fixture.posts() === before).toBe(true);
    facts.push({ name: rejection, originalRejectionPreserved: true, posts: 0 });
    await page.close();
  }
  {
    const page = await fixture.newPage(),
      raw = createConsumerToken("access-key");
    await fixture.ready(page, raw);
    await page.evaluate(async () => {
      const child = document.createElement("iframe");
      child.src = "/unrelated";
      const loaded = new Promise<void>((resolve) => {
        child.onload = () => resolve();
      });
      document.body.append(child);
      await loaded;
    });
    let sourceProof: unknown;
    await page.exposeBinding(
      "__qfSourceRejectionProof",
      (source, value: unknown) => {
        expect(source.page === page && source.frame === page.mainFrame()).toBe(
          true,
        );
        sourceProof = value;
      },
    );
    const observer = await observeNextConsumerExchange(page);
    const forgedRejected = await page.evaluate(async () => {
      const name = Object.getOwnPropertyNames(globalThis).find(
        (key) =>
          key.startsWith("__qfExchangeObservation_") &&
          !key.endsWith("_restore"),
      )!;
      const report = Reflect.get(globalThis, name);
      const rejected =
        (await report({
          nonce: "synthetic-wrong-nonce",
          status: 200,
          body: {},
        })) === false;
      const hook = {
        async report(payload: unknown) {
          const child = document.querySelector("iframe")!.contentWindow!;
          const foreign = await Reflect.get(child, name)(payload);
          const first = await report(payload),
            second = await report(payload);
          await Reflect.get(
            globalThis,
            "__qfSourceRejectionProof",
          )({
            otherFrameRejected: foreign === false,
            secondCallRejected: second === false,
            firstAccepted: first === true,
          });
          return first;
        },
      };
      Reflect.set(globalThis, name, hook.report);
      return rejected;
    });
    expect(forgedRejected).toBe(true);
    const before = fixture.posts();
    fixture.permit(raw, "valid");
    await page.getByRole("button", { name: "验证访问", exact: true }).click();
    const observed = await observer.observation;
    expect(observed.ok && fixture.posts() === before + 1).toBe(true);
    await expect.poll(() => sourceProof !== undefined).toBe(true);
    expect(sourceProof).toEqual({
      otherFrameRejected: true,
      secondCallRejected: true,
      firstAccepted: true,
    });
    await observer.dispose();
    await page.close();
    facts.push({
      name: "observer-source-nonce-single-call",
      forgedRejected,
      ...(sourceProof as Record<string, boolean>),
      posts: 1,
    });
  }
  for (const hanging of ["clone", "ack"] as const) {
    const page = await fixture.newPage(),
      raw = createConsumerToken("access-key");
    await fixture.ready(page, raw);
    await page.evaluate((raw) => {
      const native = globalThis.fetch,
        controller = new AbortController();
      let actual: Response | undefined;
      const hook = {
        async fetch(this: unknown, ...args: Parameters<typeof fetch>) {
          actual = await Reflect.apply(native, this, args);
          return actual;
        },
        async invoke() {
          const response = await globalThis.fetch("/access/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ rawKey: raw }),
            signal: controller.signal,
          });
          const originalResponse = response === actual,
            originalSignalIntact = !controller.signal.aborted,
            bodyUnused = !response.bodyUsed;
          controller.abort();
          return {
            originalResponse,
            originalSignalIntact,
            bodyUnused,
            status: response.status,
          };
        },
      };
      globalThis.fetch = hook.fetch;
      Reflect.set(window.accessLifecycleProbe, "invokeHanging", hook.invoke);
    }, raw);
    const observer = await observeNextConsumerExchange(page);
    if (hanging === "ack")
      await page.evaluate(() => {
        const name = Object.getOwnPropertyNames(globalThis).find(
          (key) =>
            key.startsWith("__qfExchangeObservation_") &&
            !key.endsWith("_restore"),
        )!;
        const hangingBinding = {
          async report() {
            await new Promise<void>(() => {});
          },
        };
        Reflect.set(globalThis, name, hangingBinding.report);
      });
    const before = fixture.posts();
    fixture.permit(raw, hanging === "clone" ? "hang" : "valid");
    const started = Date.now();
    const proof = await page.evaluate(() =>
      Reflect.get(window.accessLifecycleProbe, "invokeHanging")(),
    );
    const observed = await observer.observation,
      elapsedMs = Date.now() - started;
    expect(
      !observed.ok &&
        observed.code === "EXCHANGE_OBSERVER_TIMEOUT" &&
        elapsedMs < 25_000 &&
        fixture.posts() === before + 1,
    ).toBe(true);
    expect(proof).toEqual({
      originalResponse: true,
      originalSignalIntact: true,
      bodyUnused: true,
      status: 200,
    });
    await observer.dispose();
    await page.close();
    facts.push({
      name: "observer-hung-" + hanging,
      code: observed.ok ? null : observed.code,
      elapsedMs,
      ...proof,
      posts: 1,
    });
  }
  return facts;
}
