import { z } from "zod";
import {
  consumerIdSchema,
  consumerUuidSchema,
  internalPlayRefSchema,
} from "@/lib/consumer-contract/v1/primitives";
import { createInternalPlayBindingSchema } from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSchema,
  type IssueAccessKeyBinding,
} from "@/features/fulfillment/access/contracts";
import {
  consumerCanonicalText,
  sameConsumerFact,
} from "@/lib/consumer-contract/v1/integrity";
import {
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import type { ConsumerPendingStorage } from "@/features/theme/consumer-v1/pending";

export const studioConsumerScopeSchemaV1 = z.strictObject({
  origin: z.string().refine((s) => {
    try {
      const u = new URL(s);
      return (
        u.origin === s &&
        u.protocol === "http:" &&
        u.hostname === "127.0.0.1" &&
        Number(u.port) >= 1024
      );
    } catch {
      return false;
    }
  }),
  instanceId: z.string().regex(/^[a-f0-9]{32}$/),
  issuerId: consumerUuidSchema,
  productId: consumerIdSchema,
});
const operationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("play"),
    binding: createInternalPlayBindingSchema,
  }),
  // null preserves an original binding after known local raw loss; it never permits a new issue/replay.
  z.strictObject({
    kind: z.literal("issue"),
    binding: issueAccessKeyBindingSchema,
    raw: z.string().length(50).nullable(),
  }),
  z.strictObject({
    kind: z.literal("void"),
    binding: voidUnusedAccessKeyBindingSchema,
  }),
]);
const pendingSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.studio-consumer-pending.v1"),
  scope: studioConsumerScopeSchemaV1,
  operation: operationSchema,
  mayHaveBeenSent: z.boolean(),
});
export type StudioConsumerScopeV1 = z.infer<typeof studioConsumerScopeSchemaV1>;
export type StudioConsumerOperationV1 = z.infer<typeof operationSchema>;
export type StudioConsumerPendingV1 = z.infer<typeof pendingSchema>;
export class StudioConsumerPendingError extends Error {
  constructor() {
    super("STUDIO_CONSUMER_PENDING_UNAVAILABLE");
  }
}
const maximum = L.playRequestBytes + L.operationRequestBytes;
const text = (v: unknown) => consumerCanonicalText(v, maximum);
const key = (scope: StudioConsumerScopeV1) =>
  `quizforge:p4:studio-pending:v1:${scope.instanceId}:${scope.issuerId}:${scope.productId}`;
function read(storage: ConsumerPendingStorage, scope: StudioConsumerScopeV1) {
  try {
    return storage.getItem(key(scope));
  } catch {
    throw new StudioConsumerPendingError();
  }
}
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
async function checked(value: unknown, scope: StudioConsumerScopeV1) {
  try {
    const v = pendingSchema.parse(value);
    text(v);
    if (!sameConsumerFact(v.scope, scope, maximum)) throw Error("scope");
    const operation = v.operation;
    const productId =
      operation.kind === "play"
        ? operation.binding.parent.productId
        : operation.kind === "issue"
          ? operation.binding.play.productId
          : operation.binding.productId;
    if (productId !== scope.productId) throw Error("scope");
    if (
      operation.kind === "issue" &&
      operation.raw !== null &&
      (await digestConsumerToken(operation.raw, "access-key")) !==
        operation.binding.credentialDigest
    )
      throw Error("digest");
    return freeze(v);
  } catch {
    throw new StudioConsumerPendingError();
  }
}
/** Origin-scoped sessionStorage is a per-tab recovery helper, not cross-tab uniqueness or XSS isolation. */
export async function readStudioConsumerPendingV1(
  storage: ConsumerPendingStorage,
  input: StudioConsumerScopeV1,
) {
  const scope = studioConsumerScopeSchemaV1.parse(input),
    raw = read(storage, scope);
  if (raw === null) return null;
  if (raw.length > maximum) throw new StudioConsumerPendingError();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new StudioConsumerPendingError();
  }
  const v = await checked(value, scope);
  if (read(storage, scope) !== raw) throw new StudioConsumerPendingError();
  return v;
}
/** CSPRNG only in the operator browser. Raw is returned for local escrow, never an API input. */
export async function newStudioIssueV1(
  playInput: unknown,
  validForSeconds: number = L.defaultKeyLifetimeSeconds,
): Promise<Extract<StudioConsumerOperationV1, { kind: "issue" }>> {
  const play = internalPlayRefSchema.parse(playInput),
    raw = createConsumerToken("access-key"),
    credentialDigest = await digestConsumerToken(raw, "access-key");
  const binding: IssueAccessKeyBinding = issueAccessKeyBindingSchema.parse({
    schemaVersion: "quizforge.access-key-issue.v1",
    operationKey: crypto.randomUUID(),
    keyId: crypto.randomUUID(),
    play,
    credentialDigest,
    validForSeconds,
  });
  return freeze({ kind: "issue", raw, binding });
}
export async function prepareStudioConsumerPendingV1(
  storage: ConsumerPendingStorage,
  scopeInput: StudioConsumerScopeV1,
  operation: StudioConsumerOperationV1,
  current: () => boolean,
) {
  if (!current()) throw new StudioConsumerPendingError();
  const scope = studioConsumerScopeSchemaV1.parse(scopeInput),
    v = await checked(
      {
        schemaVersion: "quizforge.studio-consumer-pending.v1",
        scope,
        operation,
        mayHaveBeenSent: false,
      },
      scope,
    );
  if (
    !current() ||
    read(storage, scope) !== null ||
    (v.operation.kind === "issue" && v.operation.raw === null)
  )
    throw new StudioConsumerPendingError();
  try {
    storage.setItem(key(scope), text(v));
  } catch {
    throw new StudioConsumerPendingError();
  }
  const back = await readStudioConsumerPendingV1(storage, scope);
  if (!current() || back === null || text(back) !== text(v))
    throw new StudioConsumerPendingError();
  return back;
}
/** Complete readback and raw->digest verification must settle before POST is invoked. */
export async function markStudioConsumerBeforeSendV1(
  storage: ConsumerPendingStorage,
  original: StudioConsumerPendingV1,
  current: () => boolean,
) {
  if (!current()) throw new StudioConsumerPendingError();
  const stable = await checked(original, original.scope),
    back = await readStudioConsumerPendingV1(storage, stable.scope);
  if (
    !current() ||
    back === null ||
    text(back) !== text(stable) ||
    (back.operation.kind === "issue" && back.operation.raw === null)
  )
    throw new StudioConsumerPendingError();
  const next = freeze({ ...back, mayHaveBeenSent: true });
  try {
    storage.setItem(key(next.scope), text(next));
  } catch {
    throw new StudioConsumerPendingError();
  }
  const sent = await readStudioConsumerPendingV1(storage, next.scope);
  if (!current() || sent === null || text(sent) !== text(next))
    throw new StudioConsumerPendingError();
  return sent;
}
/** Caller needs strict original terminal evidence plus explicit user acknowledgment before discarding raw. */
export async function removeExactStudioConsumerPendingV1(
  storage: ConsumerPendingStorage,
  original: StudioConsumerPendingV1,
  current: () => boolean,
) {
  if (!current()) throw new StudioConsumerPendingError();
  const stable = await checked(original, original.scope),
    back = await readStudioConsumerPendingV1(storage, stable.scope);
  if (!current() || back === null || text(back) !== text(stable))
    throw new StudioConsumerPendingError();
  try {
    storage.removeItem(key(stable.scope));
    if (storage.getItem(key(stable.scope)) !== null) throw Error("readback");
  } catch {
    throw new StudioConsumerPendingError();
  }
}
