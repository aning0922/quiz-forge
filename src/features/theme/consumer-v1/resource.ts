import type { DisplayResourceTransport } from "@/lib/assessment-contract/display-v1";
import { consumerResourceUrl } from "@/features/fulfillment/consumer-flow/urls";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  ConsumerClientError,
  requestConsumerJson,
  type ConsumerFetch,
} from "./request";
import type { ConsumerTaskV1 } from "./controller";
/** Aggregate untrusted network chunks once; the frozen image decoder receives one bounded chunk. */
export function consumerResourceTransportV1(
  sessionId: string,
  task: ConsumerTaskV1,
  onAuthorityFailure: () => void,
  fetcher: ConsumerFetch = fetch,
): DisplayResourceTransport {
  return async (asset, signal, deadline) => {
    const until = Math.min(performance.now() + L.deadlineMs, deadline),
      controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelReader = () => {
      try {
        void reader?.cancel().catch(() => undefined);
      } catch {
        /* Finite failures only. */
      }
    };
    let interrupt!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      interrupt = () => {
        controller.abort();
        cancelReader();
        reject(new ConsumerClientError("TIMEOUT"));
      };
    });
    const signals = new Set([signal, task.signal]);
    signals.forEach((s) =>
      s.addEventListener("abort", interrupt, { once: true }),
    );
    const timer = setTimeout(interrupt, Math.max(0, until - performance.now()));
    const check = () => {
      if (!task.current()) throw new ConsumerClientError("ACCESS_DENIED");
      if (
        controller.signal.aborted ||
        signal.aborted ||
        task.signal.aborted ||
        performance.now() >= until
      )
        throw new ConsumerClientError("TIMEOUT");
    };
    const read = async () => {
      check();
      if (
        !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 1 ||
        asset.bytes > L.imageBytes
      )
        throw new ConsumerClientError("UNAVAILABLE");
      const url = consumerResourceUrl(sessionId, {
        resourceId: asset.resourceRef.id,
        resourceVersion: asset.resourceRef.version,
        sha256: asset.sha256,
      });
      const response = await fetcher(url, {
        credentials: "same-origin",
        mode: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (controller.signal.aborted || !task.current()) {
        try {
          void response.body?.cancel().catch(() => undefined);
        } catch {
          /* Late response discarded. */
        }
        check();
      }
      if (response.status !== 200) {
        await requestConsumerJson(
          url,
          {
            method: "GET",
            maximum: L.errorResponseBytes,
            statuses: [200],
            signal: controller.signal,
            fetcher: async () => response,
            onAuthorityFailure: () => {
              if (task.current()) onAuthorityFailure();
            },
          },
          () => {
            throw new ConsumerClientError("UNAVAILABLE");
          },
        );
        throw new ConsumerClientError("UNAVAILABLE");
      }
      if (
        !response.body ||
        response.headers.get("content-type") !== asset.mediaType ||
        (response.headers.has("content-encoding") &&
          response.headers.get("content-encoding") !== "identity")
      ) {
        try {
          void response.body?.cancel().catch(() => undefined);
        } catch {
          /* Header rejection remains authoritative. */
        }
        throw new ConsumerClientError("UNAVAILABLE");
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(asset.bytes);
      let length = 0,
        reads = 0;
      for (;;) {
        check();
        if (reads++ > 0 && reads % 32 === 0)
          await new Promise<void>((r) => setTimeout(r, 0));
        check();
        const part = await reader.read();
        check();
        if (part.done) break;
        if (
          !(part.value instanceof Uint8Array) ||
          part.value.byteLength > asset.bytes - length
        )
          throw new ConsumerClientError("UNAVAILABLE");
        bytes.set(part.value, length);
        length += part.value.byteLength;
      }
      if (length !== asset.bytes) throw new ConsumerClientError("UNAVAILABLE");
      check();
      return new Response(bytes, {
        headers: { "content-type": asset.mediaType },
      });
    };
    try {
      return await Promise.race([read(), interrupted]);
    } catch (error) {
      throw error instanceof ConsumerClientError
        ? error
        : new ConsumerClientError("UNAVAILABLE");
    } finally {
      clearTimeout(timer);
      signals.forEach((s) => s.removeEventListener("abort", interrupt));
      cancelReader();
      try {
        reader?.releaseLock();
      } catch {
        /* Finite failures only. */
      }
      controller.abort();
    }
  };
}
