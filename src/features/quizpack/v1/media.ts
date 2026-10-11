import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  ImageDeclaration,
  ImageFacts,
  ImageInspectionContext,
  Result,
} from "./api";
import { PACK_LIMITS, resolvePackLimits } from "./limits";
import {
  assetPathSchema,
  imageMediaTypeSchema,
  sha256Schema,
} from "./manifest";

const declarationSchema = z.object({
  path: assetPathSchema,
  mediaType: imageMediaTypeSchema,
  bytes: z.number().int().positive().max(PACK_LIMITS.resourceBytes),
  sha256: sha256Schema,
  width: z.number().int().positive().max(PACK_LIMITS.imageDimension),
  height: z.number().int().positive().max(PACK_LIMITS.imageDimension),
});
const factsSchema = z.strictObject({
  ok: z.literal(true),
  mediaType: imageMediaTypeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.literal(1),
  mediaDecoded: z.literal(true),
});
const workerPath = fileURLToPath(
  new URL("./media-worker.mjs", import.meta.url),
);
const failure = (code: string): Result<ImageFacts> => ({
  ok: false,
  issues: [
    {
      code,
      path: [],
      message: "Image does not satisfy the static media validation policy.",
    },
  ],
});

// Serialize native decoder processes, including callers outside the ZIP orchestrator.
let decoderBusy = false;
const waiters: (() => void)[] = [];
function releaseDecoder() {
  const next = waiters.shift();
  if (next) next();
  else decoderBusy = false;
}
function acquireDecoder(
  signal: AbortSignal,
): Promise<(() => void) | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  if (!decoderBusy) {
    decoderBusy = true;
    return Promise.resolve(releaseDecoder);
  }
  return new Promise((resolve) => {
    const grant = () => {
      signal.removeEventListener("abort", cancel);
      resolve(releaseDecoder);
    };
    const cancel = () => {
      const i = waiters.indexOf(grant);
      if (i >= 0) waiters.splice(i, 1);
      resolve(undefined);
    };
    waiters.push(grant);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
function sniff(bytes: Buffer): ImageFacts["mediaType"] | undefined {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return undefined;
}
/** libvips may decode only the default APNG image, so reject animation chunks explicitly. */
function hasAnimation(
  bytes: Buffer,
  mediaType: ImageFacts["mediaType"],
): boolean {
  if (mediaType === "image/png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(type)) return true;
      offset += length + 12;
    }
  }
  if (mediaType === "image/webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (
        type === "ANIM" ||
        type === "ANMF" ||
        (type === "VP8X" && length > 0 && ((bytes[offset + 8] ?? 0) & 2) !== 0)
      )
        return true;
      offset += length + 8 + (length % 2);
    }
  }
  return false;
}

/** Offline subprocess isolation, not an OS sandbox or native-memory hard limit. */
export async function inspectImage(
  input: Uint8Array,
  expected: ImageDeclaration,
  context: ImageInspectionContext,
): Promise<Result<ImageFacts>> {
  const start = Date.now();
  const effective = resolvePackLimits(context.limits);
  if (!effective.ok) return effective;
  const limits = effective.value;
  if (context.signal.aborted) return failure("MEDIA_CANCELLED");
  const parsed = declarationSchema.safeParse(expected);
  if (!parsed.success || !(input instanceof Uint8Array))
    return failure("MEDIA_DECLARATION_INVALID");
  const declaration = parsed.data;
  if (
    input.byteLength > limits.resourceBytes ||
    declaration.width > limits.imageDimension ||
    declaration.height > limits.imageDimension ||
    declaration.width * declaration.height > limits.imagePixels
  )
    return failure("MEDIA_LIMIT");
  const bytes = Buffer.from(input); // Independent snapshot before awaiting the decoder.
  if (
    bytes.length !== declaration.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== declaration.sha256
  )
    return failure("MEDIA_INTEGRITY_MISMATCH");
  const mediaType = sniff(bytes);
  const extension = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  }[declaration.mediaType];
  if (
    mediaType !== declaration.mediaType ||
    !declaration.path.endsWith(`.${extension}`)
  )
    return failure("MEDIA_FORMAT_MISMATCH");
  if (hasAnimation(bytes, mediaType)) return failure("MEDIA_ANIMATED");
  const local = new AbortController();
  let reason = "MEDIA_TIMEOUT";
  const abort = () => {
    reason = "MEDIA_CANCELLED";
    local.abort();
  };
  context.signal.addEventListener("abort", abort, { once: true });
  if (context.signal.aborted) abort();
  const remaining = limits.imageMs - (Date.now() - start);
  const timer = setTimeout(() => local.abort(), Math.max(0, remaining));
  if (remaining <= 0) local.abort();
  let release: (() => void) | undefined;
  try {
    release = await acquireDecoder(local.signal);
    if (!release || local.signal.aborted) return failure(reason);
    return await new Promise<Result<ImageFacts>>((resolve) => {
      const child = spawn(
        process.execPath,
        [
          workerPath,
          String(limits.resourceBytes),
          String(limits.imageDimension),
          String(limits.imagePixels),
        ],
        {
          stdio: ["pipe", "pipe", "ignore"],
          env: { NODE_ENV: "production" },
          shell: false,
        },
      );
      const output: Buffer[] = [];
      let outputBytes = 0;
      let forcedFailure: string | undefined;
      const terminate = (code: string) => {
        forcedFailure ??= code;
        child.stdin.destroy();
        child.stdout.destroy();
        child.kill("SIGKILL");
      };
      const cancel = () => terminate(reason);
      local.signal.addEventListener("abort", cancel, { once: true });
      child.on("error", () => {
        forcedFailure ??= "MEDIA_WORKER_FAILED";
      });
      child.stdin.on("error", () => {
        terminate("MEDIA_WORKER_FAILED");
      });
      child.stdout.on("error", () => {
        terminate("MEDIA_WORKER_FAILED");
      });
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 2048) terminate("MEDIA_WORKER_FAILED");
        else output.push(chunk);
      });
      // 'close' follows process exit and stdio closure: never return on kill alone.
      child.once("close", (code, signal) => {
        local.signal.removeEventListener("abort", cancel);
        if (forcedFailure) {
          resolve(failure(forcedFailure));
          return;
        }
        if (code !== 0 || signal) {
          resolve(failure("MEDIA_WORKER_FAILED"));
          return;
        }
        try {
          const value: unknown = JSON.parse(
            Buffer.concat(output).toString("utf8"),
          );
          const parsedFacts = factsSchema.safeParse(value);
          if (!parsedFacts.success) {
            const rejection = z
              .strictObject({
                ok: z.literal(false),
                code: z.enum([
                  "MEDIA_FORMAT_MISMATCH",
                  "MEDIA_ANIMATED",
                  "MEDIA_LIMIT",
                  "MEDIA_DECODE_FAILED",
                ]),
              })
              .safeParse(value);
            resolve(
              failure(
                rejection.success ? rejection.data.code : "MEDIA_WORKER_FAILED",
              ),
            );
            return;
          }
          const facts = parsedFacts.data;
          if (
            facts.width > limits.imageDimension ||
            facts.height > limits.imageDimension ||
            facts.width * facts.height > limits.imagePixels
          ) {
            resolve(failure("MEDIA_LIMIT"));
            return;
          }
          if (
            facts.mediaType !== declaration.mediaType ||
            facts.width !== declaration.width ||
            facts.height !== declaration.height
          ) {
            resolve(failure("MEDIA_DECLARATION_MISMATCH"));
            return;
          }
          resolve({
            ok: true,
            value: {
              mediaType: facts.mediaType,
              width: facts.width,
              height: facts.height,
              frames: 1,
              mediaDecoded: true,
            },
          });
        } catch {
          resolve(failure("MEDIA_WORKER_FAILED"));
        }
      });
      if (local.signal.aborted) cancel();
      else child.stdin.end(bytes);
    });
  } catch {
    return failure("MEDIA_WORKER_FAILED");
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener("abort", abort);
    release?.();
  }
}
