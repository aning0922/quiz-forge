import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  consumerExchangeResultSchema,
  type ConsumerExchangeResult,
} from "../../src/features/fulfillment/consumer-flow/contracts";
import { CONSUMER_LIMITS_V1 as L } from "../../src/lib/consumer-contract/v1/limits";

export type ConsumerExchangeObservation =
  | { ok: true; status: 200; result: ConsumerExchangeResult }
  | {
      ok: false;
      status: number;
      code:
        | "EXCHANGE_HTTP_FAILURE"
        | "EXCHANGE_BODY_UNAVAILABLE"
        | "EXCHANGE_BODY_INVALID"
        | "EXCHANGE_OBSERVER_UNAVAILABLE"
        | "EXCHANGE_OBSERVER_TIMEOUT";
    };

/**
 * Test-only, single-response observer, armed after Access has erased its URL.
 * Calls native fetch once with the original arguments and returns the original
 * Response. Only its bounded clone is read; no Request body/headers are inspected.
 * The Node acknowledgement precedes returning the Response, so subsequent page
 * navigation cannot destroy the observer's DTO. Does not prove a DB transaction.
 */
export async function observeNextConsumerExchange(page: Page) {
  const address = new URL(page.url());
  if (
    address.protocol !== "http:" ||
    address.hostname !== "127.0.0.1" ||
    address.pathname !== "/access" ||
    address.search ||
    address.hash ||
    address.username ||
    address.password
  )
    throw Error("EXCHANGE_OBSERVER_SCOPE_REJECTED");
  const origin = address.origin,
    name = "__qfExchangeObservation_" + randomUUID().replaceAll("-", ""),
    control = name + "_restore",
    nonce = randomUUID();
  let active = true,
    settled = false;
  async function restoreDocumentObserver() {
    try {
      await page.evaluate(
        ({ control, name }) => {
          const restore = Reflect.get(globalThis, control);
          if (typeof restore === "function") restore();
          Reflect.deleteProperty(globalThis, name);
        },
        { control, name },
      );
    } catch {
      /* Navigation/closure already destroyed that document. */
    }
  }
  let settle!: (observation: ConsumerExchangeObservation) => void;
  const observation = new Promise<ConsumerExchangeObservation>((resolve) => {
    settle = resolve;
  });
  const finish = (value: ConsumerExchangeObservation) => {
    if (!settled) {
      settled = true;
      active = false;
      clearTimeout(timer);
      settle(value);
    }
  };
  const timer = setTimeout(() => {
    finish({ ok: false, status: 0, code: "EXCHANGE_OBSERVER_TIMEOUT" });
    void restoreDocumentObserver();
  }, L.deadlineMs);
  try {
    await page.exposeBinding(name, (source, value: unknown) => {
      let allowed = false;
      try {
        const current = new URL(source.frame.url());
        allowed =
          active &&
          source.page === page &&
          source.frame === page.mainFrame() &&
          current.origin === origin &&
          current.pathname === "/access" &&
          !current.search &&
          !current.hash;
      } catch {}
      if (!allowed || !value || typeof value !== "object") return false;
      const incoming = value as {
        nonce?: unknown;
        status?: unknown;
        body?: unknown;
        code?: unknown;
      };
      if (incoming.nonce !== nonce) return false;
      const status =
        typeof incoming.status === "number" &&
        Number.isInteger(incoming.status) &&
        incoming.status >= 100 &&
        incoming.status <= 599
          ? incoming.status
          : 0;
      if (status !== 200) {
        finish({ ok: false, status, code: "EXCHANGE_HTTP_FAILURE" });
        return true;
      }
      if (incoming.code === "EXCHANGE_BODY_UNAVAILABLE") {
        finish({ ok: false, status, code: "EXCHANGE_BODY_UNAVAILABLE" });
        return true;
      }
      const parsed = consumerExchangeResultSchema.safeParse(incoming.body);
      finish(
        parsed.success
          ? { ok: true, status: 200, result: parsed.data }
          : { ok: false, status, code: "EXCHANGE_BODY_INVALID" },
      );
      return true;
    });
    await page.evaluate(
      ({ origin, name, control, nonce, maximum, deadlineMs }) => {
        if (
          location.origin !== origin ||
          location.pathname !== "/access" ||
          location.search ||
          location.hash ||
          top !== self
        )
          throw Error("EXCHANGE_OBSERVER_SCOPE_REJECTED");
        const nativeFetch = globalThis.fetch;
        let enabled = true;
        const helper = {
          restore() {
            enabled = false;
            if (globalThis.fetch === helper.fetch)
              globalThis.fetch = nativeFetch;
            Reflect.deleteProperty(globalThis, control);
          },
          async fetch(
            this: unknown,
            ...args: Parameters<typeof globalThis.fetch>
          ) {
            const [input, init] = args;
            let matches = false;
            try {
              const url = new URL(
                input instanceof Request ? input.url : String(input),
                location.href,
              );
              const method =
                init?.method ??
                (input instanceof Request ? input.method : "GET");
              matches =
                enabled &&
                location.origin === origin &&
                location.pathname === "/access" &&
                !location.search &&
                !location.hash &&
                method.toUpperCase() === "POST" &&
                url.origin === origin &&
                url.pathname === "/access/exchange" &&
                !url.search &&
                !url.hash &&
                !url.username &&
                !url.password;
            } catch {}
            // Restore before dispatch. Any other request is outside this observer;
            // any duplicate exchange still goes to native fetch and is not hidden.
            if (matches) helper.restore();
            const response = await Reflect.apply(nativeFetch, this, args);
            if (!matches) return response;
            let observationTimer: ReturnType<typeof setTimeout> | undefined;
            let cloneReader:
              ReadableStreamDefaultReader<Uint8Array> | undefined;
            const budget = new Promise<never>((_, reject) => {
              observationTimer = setTimeout(() => {
                void cloneReader?.cancel().catch(() => {});
                reject(Error("EXCHANGE_OBSERVATION_TIMEOUT"));
              }, deadlineMs);
            });
            let payload: { status: number; body?: unknown; code?: string } = {
              status: response.status,
            };
            if (response.status === 200) {
              let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
              try {
                reader = cloneReader = response.clone().body?.getReader();
                if (!reader) throw Error("EXCHANGE_BODY_UNAVAILABLE");
                const chunks: Uint8Array[] = [];
                let total = 0;
                for (;;) {
                  const part = await Promise.race([reader.read(), budget]);
                  if (part.done) break;
                  total += part.value.byteLength;
                  if (total > maximum) throw Error("EXCHANGE_BODY_UNAVAILABLE");
                  chunks.push(part.value);
                }
                const bytes = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) {
                  bytes.set(chunk, offset);
                  offset += chunk.byteLength;
                }
                payload = {
                  status: response.status,
                  body: JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
                  ),
                };
              } catch {
                void reader?.cancel().catch(() => {});
                payload = {
                  status: response.status,
                  code: "EXCHANGE_BODY_UNAVAILABLE",
                };
              } finally {
                try {
                  reader?.releaseLock();
                } catch {
                  /* Preserve original Response. */
                }
              }
            }
            try {
              const report = Reflect.get(globalThis, name) as (
                value: unknown,
              ) => Promise<void>;
              await Promise.race([report({ ...payload, nonce }), budget]);
            } catch {
              /* Observation failure never substitutes the actual Response. */
            } finally {
              clearTimeout(observationTimer);
            }
            return response;
          },
        };
        Reflect.set(globalThis, control, helper.restore);
        globalThis.fetch = helper.fetch;
      },
      {
        origin,
        name,
        control,
        nonce,
        maximum: L.operationRequestBytes,
        deadlineMs: L.deadlineMs,
      },
    );
    if (!active) throw Error("EXCHANGE_OBSERVER_SETUP_FAILED");
  } catch {
    active = false;
    clearTimeout(timer);
    finish({ ok: false, status: 0, code: "EXCHANGE_OBSERVER_UNAVAILABLE" });
    await restoreDocumentObserver();
    throw Error("EXCHANGE_OBSERVER_SETUP_FAILED");
  }
  return {
    observation,
    async dispose() {
      active = false;
      clearTimeout(timer);
      finish({ ok: false, status: 0, code: "EXCHANGE_OBSERVER_UNAVAILABLE" });
      await restoreDocumentObserver();
    },
  };
}
