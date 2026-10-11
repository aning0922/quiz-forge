import { z } from "zod";
import { TextDecoder } from "node:util";
import { MEDIA_LIMITS } from "./contracts";
const networkStage = z.enum([
  "socket-denied",
  "operation-denied",
  "prerequisite-denied",
  "allowed",
  "failed",
]);
const common = { schema: z.literal("posix-probe.v1") };
export const probeResultSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    ...common,
    mode: z.literal("files"),
    readDenied: z.boolean(),
    writeDenied: z.boolean(),
    createDenied: z.boolean(),
    linkDenied: z.boolean(),
    renameDenied: z.boolean(),
    unlinkDenied: z.boolean(),
  }),
  z.strictObject({
    ...common,
    mode: z.literal("process"),
    threadAllowed: z.boolean(),
    forkDenied: z.boolean(),
    spawnDenied: z.boolean(),
  }),
  z.strictObject({
    ...common,
    mode: z.literal("network"),
    connect: networkStage,
    bind: networkStage,
    listen: networkStage,
    unix: networkStage,
  }),
  z.strictObject({
    ...common,
    mode: z.literal("fd"),
    scanComplete: z.boolean(),
    noInheritedFileOrSocket: z.boolean(),
  }),
]);
export type ProbeResult = z.infer<typeof probeResultSchema>;
export function parseProbeOutput(bytes: Uint8Array): ProbeResult | null {
  try {
    if (bytes.byteLength > MEDIA_LIMITS.stdoutBytes) return null;
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) !== text) return null;
    const parsed = probeResultSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const fdDiagnosticSchema = z.strictObject({
  schema: z.literal("posix-fd-diagnostic.v1"),
  scanComplete: z.boolean(),
  extraCount: z.number().int().nonnegative().max(65536),
  truncated: z.boolean(),
  descriptors: z
    .array(
      z.strictObject({
        type: z.enum([
          "regular",
          "socket",
          "pipe",
          "character",
          "block",
          "directory",
          "other",
        ]),
        readMode: z.boolean(),
        writeMode: z.boolean(),
        closeOnExec: z.boolean(),
        above255: z.boolean(),
      }),
    )
    .max(12),
});
export function parseFdDiagnostic(bytes: Uint8Array) {
  try {
    if (bytes.byteLength > 2048) return null;
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    const value: unknown = JSON.parse(text);
    if (JSON.stringify(value) !== text) return null;
    const p = fdDiagnosticSchema.safeParse(value);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}
