/** The caller supplies a frozen endpoint limit; actual decoded wire bytes govern. */
export async function readBoundedDraftJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > 4_390_912 ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      response.headers.get("content-type") ?? "",
    ) ||
    !response.body
  )
    throw new Error("INVALID_DRAFT_RESPONSE");
  const reader = response.body.getReader();
  const bytes = new Uint8Array(maximumBytes);
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (chunk.value.byteLength > maximumBytes - length)
        throw new Error("INVALID_DRAFT_RESPONSE");
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      ),
    ) as unknown;
  } catch {
    // Neither an untrusted cancel callback nor an input exception may replace
    // the finite failure or keep the caller waiting after the limit was crossed.
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      /* The reader may already have failed. */
    }
    throw new Error("INVALID_DRAFT_RESPONSE");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* A failed body cannot confer a successful result. */
    }
  }
}
