import type {
  DisplayAssetV1,
  DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v1";
import { DISPLAY_LIMITS_V1 } from "@/lib/assessment-contract/display-limits-v1";
import {
  DisplayClientError,
  checkpoint,
  withDisplayDeadline,
} from "./display-task";

export async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
/** Full bounded bytes are verified before a decode URL exists. A partial stream cannot become an image. */
export async function readVerifiedBytes(
  response: Response,
  expectedBytes: number,
  expectedHash: string,
  signal: AbortSignal,
  deadline: number,
  exact = true,
) {
  if (
    !response.body ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > DISPLAY_LIMITS_V1.imageBytes
  )
    throw new DisplayClientError("PREVIEW_RESOURCE_UNAVAILABLE");
  const reader = response.body.getReader(),
    bytes = new Uint8Array(expectedBytes);
  let expire: (() => void) | undefined,
    interruptedError: DisplayClientError | undefined;
  let length = 0,
    timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const interrupted = new Promise<never>((_, reject) => {
      expire = () => {
        interruptedError = new DisplayClientError(
          signal.aborted ? "PREVIEW_CANCELLED" : "PREVIEW_TIMEOUT",
        );
        reject(interruptedError);
        cancel();
      };
      timer = setTimeout(expire, Math.max(1, deadline - performance.now()));
      signal.addEventListener("abort", expire, { once: true });
      if (signal.aborted) expire();
    });
    let reads = 0;
    for (;;) {
      if (interruptedError) throw interruptedError;
      if (reads++ > 0 && reads % 32 === 0)
        await Promise.race([
          new Promise<void>((resolve) => setTimeout(resolve, 0)),
          interrupted,
        ]);
      checkpoint(signal, deadline);
      const part = await Promise.race([reader.read(), interrupted]);
      if (interruptedError) throw interruptedError;
      checkpoint(signal, deadline);
      if (part.done) break;
      if (part.value.byteLength > expectedBytes - length)
        throw new DisplayClientError("PREVIEW_RESOURCE_UNAVAILABLE");
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
    const actual = bytes.slice(0, length);
    if (
      (exact && length !== expectedBytes) ||
      (await sha256(actual)) !== expectedHash
    )
      throw new DisplayClientError("PREVIEW_RESOURCE_UNAVAILABLE");
    checkpoint(signal, deadline);
    return actual;
  } catch (error) {
    cancel();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (expire) signal.removeEventListener("abort", expire);
    reader.releaseLock();
  }
}
export type VerifiedImage = Readonly<{
  url: string;
  image: HTMLImageElement;
  release: () => void;
}>;
export async function loadVerifiedImage(
  asset: DisplayAssetV1,
  transport: DisplayResourceTransport,
  signal: AbortSignal,
  deadlineMonotonicMs = Infinity,
): Promise<VerifiedImage> {
  return withDisplayDeadline(
    signal,
    async (active, deadline) => {
      const response = await transport(asset, active, deadline);
      if (
        response.status !== 200 ||
        response.headers.get("content-type") !== asset.mediaType
      )
        throw new DisplayClientError("PREVIEW_RESOURCE_UNAVAILABLE");
      const bytes = await readVerifiedBytes(
        response,
        asset.bytes,
        asset.sha256,
        active,
        deadline,
      );
      let url: string | undefined;
      try {
        checkpoint(active, deadline);
        url = URL.createObjectURL(new Blob([bytes], { type: asset.mediaType }));
        const ownedUrl = url,
          image = new Image();
        const release = () => URL.revokeObjectURL(ownedUrl);
        image.src = ownedUrl;
        let abort: (() => void) | undefined;
        try {
          await Promise.race([
            image.decode(),
            new Promise<never>((_, reject) => {
              abort = () => {
                release();
                reject(new DisplayClientError("PREVIEW_CANCELLED"));
              };
              active.addEventListener("abort", abort, { once: true });
              if (active.aborted) abort();
            }),
          ]);
        } finally {
          if (abort) active.removeEventListener("abort", abort);
        }
        checkpoint(active, deadline);
        if (
          image.naturalWidth !== asset.width ||
          image.naturalHeight !== asset.height
        )
          throw new DisplayClientError("PREVIEW_RESOURCE_UNAVAILABLE");
        return Object.freeze({ url: ownedUrl, image, release });
      } catch (error) {
        if (url) URL.revokeObjectURL(url);
        throw error;
      }
    },
    deadlineMonotonicMs,
  );
}
