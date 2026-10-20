import "server-only";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import type { DatabaseBudget } from "@/lib/db/client";
import {
  configuredHost,
  type LocalStudioProfile,
} from "@/lib/http-security/source";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  CONSUMER_COOKIE_NAME_V1,
  CONSUMER_EXCHANGE_HEADER_V1,
  CONSUMER_EXCHANGE_HEADER_VALUE_V1,
  parseConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import { consumerUuidSchema } from "@/lib/consumer-contract/v1/primitives";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";

/** Exact loopback profile only. Missing Fetch Metadata is rejected for every consumer API. */
export function assertConsumerSource(
  request: Request,
  config: LocalStudioProfile,
  options: { post: boolean; exchange?: boolean },
) {
  let host: string;
  try {
    host = configuredHost(config);
  } catch {
    throw new ConsumerError("UNAVAILABLE");
  }
  let url: URL;
  try {
    // NextRequest's public url normalizes loopback hosts to localhost. The
    // standard Request getter retains the adapter's native URL, so compare it
    // exactly without granting localhost or another loopback an origin alias.
    const getUrl = Object.getOwnPropertyDescriptor(
      Request.prototype,
      "url",
    )?.get;
    const nativeUrl: unknown = getUrl?.call(request);
    if (typeof nativeUrl !== "string") throw new Error();
    url = new URL(nativeUrl);
  } catch {
    throw new ConsumerError("SOURCE_REJECTED");
  }
  if (
    request.headers.get("host") !== host ||
    url.origin !== config.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin" ||
    (options.post && request.headers.get("origin") !== config.origin)
  )
    throw new ConsumerError("SOURCE_REJECTED");
  if (
    options.exchange &&
    request.headers.get(CONSUMER_EXCHANGE_HEADER_V1) !==
      CONSUMER_EXCHANGE_HEADER_VALUE_V1
  )
    throw new ConsumerError("SOURCE_REJECTED");
}

/** Duplicate or malformed matching cookies never select one of several possible identities. */
export function consumerGrantCookie(headers: Headers): string | null {
  const matches = (headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.split("=", 1)[0]!.trim() === CONSUMER_COOKIE_NAME_V1);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new ConsumerError("ACCESS_DENIED");
  const part = matches[0]!,
    split = part.indexOf("="),
    raw = split < 0 ? null : part.slice(split + 1);
  if (part.slice(0, split) !== CONSUMER_COOKIE_NAME_V1)
    throw new ConsumerError("ACCESS_DENIED");
  if (!parseConsumerToken(raw, "grant"))
    throw new ConsumerError("ACCESS_DENIED");
  return raw;
}

/** This header is request-local only; never expose or persist the grant token in a JSON DTO. */
export function consumerSetCookie(
  raw: string,
  sessionId: string,
  clear = false,
): string {
  consumerUuidSchema.parse(sessionId);
  if (!clear && !parseConsumerToken(raw, "grant"))
    throw new ConsumerError("UNAVAILABLE");
  return `${CONSUMER_COOKIE_NAME_V1}=${clear ? "" : raw}; Path=/play/${sessionId}; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : L.grantLifetimeSeconds}`;
}

/** Actual stream bytes, one fixed buffer and one original absolute budget. No JSON/stream fault text escapes. */
export async function readConsumerJson(
  request: Request,
  maximum: number,
  budget: DatabaseBudget,
): Promise<unknown> {
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > L.saveRequestBytes
  )
    throw new ConsumerError("UNAVAILABLE");
  const type = request.headers.get("content-type"),
    encoding = request.headers.get("content-encoding");
  if (
    !type ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
    (encoding !== null && encoding !== "identity") ||
    !request.body
  )
    throw new ConsumerError("INVALID_REQUEST");
  const until = Math.min(budget.deadlineMonotonicMs, performance.now() + 5000);
  const checkpoint = () => {
    if (
      budget.signal.aborted ||
      !Number.isFinite(until) ||
      performance.now() >= until
    )
      throw new ConsumerError("TIMEOUT");
  };
  checkpoint();
  const reader = request.body.getReader(),
    bytes = new Uint8Array(maximum);
  let length = 0,
    reads = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    abort: (() => void) | undefined;
  const cancel = () => {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* Untrusted cancellation cannot replace the finite error. */
    }
  };
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => {
      reject(new ConsumerError("TIMEOUT"));
      cancel();
    };
    budget.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(abort, Math.max(0, until - performance.now()));
    if (budget.signal.aborted) abort();
  });
  const read = async () => {
    for (;;) {
      checkpoint();
      if (reads > 0 && reads % 32 === 0) await yieldToEventLoop();
      checkpoint();
      const part = await reader.read();
      checkpoint();
      reads++;
      if (part.done) break;
      if (!(part.value instanceof Uint8Array))
        throw new ConsumerError("INVALID_REQUEST");
      if (part.value.byteLength > maximum - length)
        throw new ConsumerError("PAYLOAD_TOO_LARGE");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    checkpoint();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
    const result: unknown = JSON.parse(text);
    canonicalOrdinaryJson(result, { maxBytes: maximum, maxDepth: L.depth });
    checkpoint();
    return result;
  };
  try {
    // A single race retains one interruption reaction, independently of chunk count.
    return await Promise.race([read(), interrupted]);
  } catch (error) {
    cancel();
    throw error instanceof ConsumerError
      ? error
      : new ConsumerError("INVALID_REQUEST");
  } finally {
    clearTimeout(timer);
    if (abort) budget.signal.removeEventListener("abort", abort);
    try {
      reader.releaseLock();
    } catch {
      /* Bounded failure remains authoritative. */
    }
  }
}
