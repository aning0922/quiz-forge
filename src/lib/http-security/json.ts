import "server-only";
import { StudioError } from "./errors";

export const JSON_BYTE_LIMIT = 4096;
export const JSON_DEADLINE_MS = 5000;

/** Read the actual stream; neither Content-Length nor a client timeout is trusted. */
export async function readStudioJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type");
  if (
    !type ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type) ||
    (request.headers.has("content-encoding") &&
      request.headers.get("content-encoding") !== "identity")
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
  if (!request.body) throw new StudioError("INVALID_REQUEST");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new StudioError("INVALID_REQUEST"));
      void reader.cancel().catch(() => undefined);
    }, JSON_DEADLINE_MS);
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > JSON_BYTE_LIMIT) {
        void reader.cancel().catch(() => undefined);
        throw new StudioError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError("INVALID_REQUEST");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function emptyDto(value: unknown): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 0
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
}

export function loginDto(value: unknown): { credential: string } {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("credential" in value) ||
    typeof value.credential !== "string" ||
    value.credential.length > 128 ||
    value.credential.length === 0
  ) {
    throw new StudioError("INVALID_REQUEST");
  }
  return { credential: value.credential };
}
