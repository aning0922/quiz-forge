import { TextDecoder } from "node:util";
import { z } from "zod";
const stage = z.enum(["allowed", "denied", "closed", "failed"]);
const macSchema = z.union([
  z.strictObject({
    schema: z.literal("mac-probe.v1"),
    mode: z.literal("ipc"),
    machLookup: stage,
    sharedMemory: stage,
    peerSignal: stage,
  }),
  z.strictObject({
    schema: z.literal("mac-probe.v1"),
    mode: z.enum(["vfork", "spawn-self"]),
    denied: z.boolean(),
  }),
  z.strictObject({
    schema: z.literal("mac-probe.v1"),
    mode: z.literal("fd-data"),
    read: stage,
    write: stage,
  }),
  z.strictObject({
    schema: z.literal("mac-probe.v1"),
    mode: z.literal("listen"),
    listen: stage,
  }),
  z.strictObject({
    schema: z.literal("mac-service.v1"),
    ready: z.literal(true),
  }),
  z.strictObject({ schema: z.literal("mac-shm.v1"), created: z.literal(true) }),
  z.strictObject({ schema: z.literal("mac-shm.v1"), removed: z.literal(true) }),
]);
export const identitySchema = z.union([
  z.strictObject({
    schema: z.literal("mac-identity.v1"),
    present: z.literal(false),
  }),
  z.strictObject({
    schema: z.literal("mac-identity.v1"),
    present: z.literal(true),
    owned: z.boolean(),
    startSec: z.number().int().nonnegative(),
    startUsec: z.number().int().nonnegative(),
    executable: z.enum(["worker", "sandbox", "other", "unknown"]),
    residentBytes: z.number().int().nonnegative(),
    peakFootprintBytes: z.number().int().nonnegative(),
  }),
]);
function json(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 2048) throw new Error("OUTPUT_INVALID");
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (JSON.stringify(value) !== text) throw new Error("OUTPUT_INVALID");
  return value;
}
export function parseMacOutput(
  bytes: Uint8Array,
): Record<string, unknown> | null {
  try {
    const p = macSchema.safeParse(json(bytes));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}
export function parseNativeIdentity(
  bytes: Uint8Array,
): z.infer<typeof identitySchema> | null {
  try {
    const p = identitySchema.safeParse(json(bytes));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}
