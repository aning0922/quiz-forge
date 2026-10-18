import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerErrorResponseSchema,
  CONSUMER_ERROR_STATUS,
  type ConsumerErrorCode,
} from "@/lib/consumer-contract/v1/errors";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_CSRF_HEADER_V1 } from "@/features/fulfillment/consumer-flow/http-protocol";

export class ConsumerClientError extends Error {
  constructor(readonly code: ConsumerErrorCode) {
    super(code);
  }
}
export const consumerAuthorityFailure = (error: unknown) =>
  error instanceof ConsumerClientError &&
  [
    "ACCESS_DENIED",
    "CSRF_REJECTED",
    "SOURCE_REJECTED",
    "OPERATOR_REQUIRED",
  ].includes(error.code);
export type ConsumerFetch = typeof fetch;
/** Validate the original spelling and the browser's actual URL normalization. */
export function consumerSameOriginPathV1(
  input: string,
  trustedOrigin: string,
): boolean {
  if (
    !input.startsWith("/") ||
    input.startsWith("//") ||
    /[\\\x00-\x20\x7f#]/.test(input)
  )
    return false;
  try {
    const base = new URL(trustedOrigin),
      parsed = new URL(input, base);
    return (
      parsed.origin === base.origin && !parsed.username && !parsed.password
    );
  } catch {
    return false;
  }
}
/** One browser deadline covers fetch, full stream and verification; no response/credential on errors. */
export async function requestConsumerJson<T>(
  url: string,
  options: {
    method: "GET" | "POST";
    body?: unknown;
    csrf?: string;
    headers?: Readonly<Record<string, string>>;
    maximum: number;
    statuses: readonly number[];
    signal: AbortSignal;
    fetcher?: ConsumerFetch;
    onAuthorityFailure?: (error: ConsumerClientError) => void;
  },
  verify: (input: unknown, status: number) => Promise<T> | T,
): Promise<T> {
  const controller = new AbortController(),
    until = performance.now() + L.deadlineMs;
  const abort = () => controller.abort();
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const timer = setTimeout(abort, L.deadlineMs);
  let stop: (() => void) | undefined,
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const check = () => {
    if (controller.signal.aborted || performance.now() >= until)
      throw new ConsumerClientError("TIMEOUT");
  };
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => reject(new ConsumerClientError("TIMEOUT"));
    controller.signal.addEventListener("abort", stop, { once: true });
    if (controller.signal.aborted) stop();
  });
  const perform = async () => {
    check();
    if (
      !consumerSameOriginPathV1(
        url,
        typeof location === "undefined" ? "http://127.0.0.1" : location.origin,
      )
    )
      throw new ConsumerClientError("INVALID_REQUEST");
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...options.headers,
    };
    if (options.method === "POST") headers["Content-Type"] = "application/json";
    if (options.csrf !== undefined)
      headers[CONSUMER_CSRF_HEADER_V1] = options.csrf;
    const response = await (options.fetcher ?? fetch)(url, {
      method: options.method,
      headers,
      credentials: "same-origin",
      mode: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    if (controller.signal.aborted || performance.now() >= until) {
      try {
        void response.body?.cancel().catch(() => undefined);
      } catch {
        /* Late response is discarded. */
      }
      check();
    }
    if (response.status === 204 && options.statuses.includes(204)) {
      const result = await verify(undefined, 204);
      check();
      return result;
    }
    const maximum = response.ok ? options.maximum : L.errorResponseBytes;
    if (
      !Number.isSafeInteger(maximum) ||
      maximum < 1 ||
      maximum > L.entryResponseBytes ||
      !response.body ||
      (response.headers.has("content-encoding") &&
        response.headers.get("content-encoding") !== "identity") ||
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        response.headers.get("content-type") ?? "",
      )
    )
      throw new ConsumerClientError("UNAVAILABLE");
    reader = response.body.getReader();
    const bytes = new Uint8Array(maximum);
    let length = 0,
      reads = 0;
    for (;;) {
      check();
      if (reads++ > 0 && reads % 32 === 0)
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      check();
      const part = await reader.read();
      check();
      if (part.done) break;
      if (
        !(part.value instanceof Uint8Array) ||
        part.value.byteLength > maximum - length
      )
        throw new ConsumerClientError("UNAVAILABLE");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    const input: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
    );
    consumerCanonicalText(input, maximum);
    check();
    if (!response.ok) {
      const error = consumerErrorResponseSchema.safeParse(input);
      if (
        !error.success ||
        CONSUMER_ERROR_STATUS[error.data.code] !== response.status
      )
        throw new ConsumerClientError("UNAVAILABLE");
      throw new ConsumerClientError(error.data.code);
    }
    if (!options.statuses.includes(response.status))
      throw new ConsumerClientError("UNAVAILABLE");
    const result = await verify(input, response.status);
    check();
    return result;
  };
  try {
    return await Promise.race([perform(), cancelled]);
  } catch (error) {
    const failure =
      error instanceof ConsumerClientError
        ? error
        : new ConsumerClientError("UNAVAILABLE");
    if (consumerAuthorityFailure(failure))
      options.onAuthorityFailure?.(failure);
    throw failure;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    if (stop) controller.signal.removeEventListener("abort", stop);
    try {
      void reader?.cancel().catch(() => undefined);
    } catch {
      /* Stable errors only. */
    }
    try {
      reader?.releaseLock();
    } catch {
      /* No credential/error body retained. */
    }
    controller.abort();
  }
}
