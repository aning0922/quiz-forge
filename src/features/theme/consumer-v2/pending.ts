import { z } from "zod";
import {
  consumerSessionRefSchema,
  type ConsumerSessionRef,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerSaveInputV2Schema,
  verifyConsumerSaveInputV2,
  type ConsumerSaveInputV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerCompleteBindingV2Schema,
  type ConsumerCompleteBindingV2,
} from "@/lib/consumer-contract/v2/state";
import {
  consumerCanonicalText,
  sameConsumerFact,
} from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

const maximum = L.saveRequestBytes + L.operationRequestBytes;
const common = {
  schemaVersion: z.literal("quizforge.consumer-client-pending.v2"),
  mayHaveBeenSent: z.boolean(),
};
const pendingSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...common,
    operation: z.literal("save"),
    input: consumerSaveInputV2Schema,
  }),
  z.strictObject({
    ...common,
    operation: z.literal("complete"),
    binding: consumerCompleteBindingV2Schema,
  }),
]);
export type ConsumerPendingV2 = z.infer<typeof pendingSchema>;
export type ConsumerPendingStorageV2 = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export class ConsumerPendingError extends Error {
  constructor(
    readonly code:
      | "PENDING_UNAVAILABLE"
      | "PENDING_CORRUPT"
      | "PENDING_CHANGED"
      | "PENDING_EXISTS",
  ) {
    super(code);
  }
}
const pendingSession = (v: ConsumerPendingV2) =>
  v.operation === "save" ? v.input.binding.session : v.binding.session;
const text = (v: ConsumerPendingV2) => consumerCanonicalText(v, maximum);
function freeze<T>(v: T): T {
  if (v !== null && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
}
function storageRead(storage: ConsumerPendingStorageV2, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    throw new ConsumerPendingError("PENDING_UNAVAILABLE");
  }
}
function scopeKey(session: ConsumerSessionRef) {
  return `quizforge:p4:consumer-pending:v2:${session.sessionId}`;
}
async function checked(
  input: unknown,
  session: ConsumerSessionRef,
): Promise<ConsumerPendingV2> {
  try {
    const value = pendingSchema.parse(input);
    text(value);
    if (
      !sameConsumerFact(pendingSession(value), session, L.operationRequestBytes)
    )
      throw Error("scope");
    if (value.operation === "save")
      await verifyConsumerSaveInputV2(value.input);
    return freeze(value);
  } catch {
    throw new ConsumerPendingError("PENDING_CORRUPT");
  }
}
/** Browser-local answers/progress anchor only. Raw Key, grant and CSRF never belong here. */
export async function readConsumerPendingV2(
  storage: ConsumerPendingStorageV2,
  sessionInput: unknown,
): Promise<ConsumerPendingV2 | null> {
  const session = consumerSessionRefSchema.parse(sessionInput),
    key = scopeKey(session),
    raw = storageRead(storage, key);
  if (raw === null) return null;
  if (raw.length > maximum) throw new ConsumerPendingError("PENDING_CORRUPT");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConsumerPendingError("PENDING_CORRUPT");
  }
  const result = await checked(value, session);
  if (storageRead(storage, key) !== raw)
    throw new ConsumerPendingError("PENDING_CHANGED");
  return result;
}
/** Must settle before any POST. A failed or corrupt readback never authorizes sending. */
export async function prepareConsumerPendingV2(
  storage: ConsumerPendingStorageV2,
  operation:
    | { kind: "save"; input: ConsumerSaveInputV2 }
    | { kind: "complete"; binding: ConsumerCompleteBindingV2 },
  isCurrent: () => boolean,
): Promise<ConsumerPendingV2> {
  if (!isCurrent()) throw new ConsumerPendingError("PENDING_CHANGED");
  const session = consumerSessionRefSchema.parse(
      operation.kind === "save"
        ? operation.input.binding.session
        : operation.binding.session,
    ),
    key = scopeKey(session);
  const value = await checked(
    {
      schemaVersion: "quizforge.consumer-client-pending.v2",
      mayHaveBeenSent: false,
      ...(operation.kind === "save"
        ? { operation: "save", input: operation.input }
        : { operation: "complete", binding: operation.binding }),
    },
    session,
  );
  if (!isCurrent()) throw new ConsumerPendingError("PENDING_CHANGED");
  if (storageRead(storage, key) !== null)
    throw new ConsumerPendingError("PENDING_EXISTS");
  try {
    storage.setItem(key, text(value));
  } catch {
    throw new ConsumerPendingError("PENDING_UNAVAILABLE");
  }
  const read = await readConsumerPendingV2(storage, session);
  if (!isCurrent() || read === null || text(read) !== text(value))
    throw new ConsumerPendingError("PENDING_CHANGED");
  return read;
}
/** Synchronize may-have-sent and fully read it back before the caller may invoke fetch. */
export async function markConsumerBeforeSendV2(
  storage: ConsumerPendingStorageV2,
  expected: ConsumerPendingV2,
  isCurrent: () => boolean,
): Promise<ConsumerPendingV2> {
  if (!isCurrent()) throw new ConsumerPendingError("PENDING_CHANGED");
  const stable = pendingSchema.parse(expected),
    session = pendingSession(stable),
    key = scopeKey(session),
    current = await readConsumerPendingV2(storage, session);
  if (!isCurrent() || current === null || text(current) !== text(stable))
    throw new ConsumerPendingError("PENDING_CHANGED");
  const next = freeze({ ...stable, mayHaveBeenSent: true });
  try {
    storage.setItem(key, text(next));
  } catch {
    throw new ConsumerPendingError("PENDING_UNAVAILABLE");
  }
  const read = await readConsumerPendingV2(storage, session);
  if (!isCurrent() || read === null || text(read) !== text(next))
    throw new ConsumerPendingError("PENDING_CHANGED");
  return read;
}
/** Caller first verifies a permitted terminal observation and explicit user action. No auto-clear. */
export async function removeExactConsumerPendingV2(
  storage: ConsumerPendingStorageV2,
  expected: ConsumerPendingV2,
  isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) throw new ConsumerPendingError("PENDING_CHANGED");
  const stable = pendingSchema.parse(expected),
    session = pendingSession(stable),
    key = scopeKey(session),
    current = await readConsumerPendingV2(storage, session);
  if (!isCurrent() || current === null || text(current) !== text(stable))
    throw new ConsumerPendingError("PENDING_CHANGED");
  try {
    storage.removeItem(key);
  } catch {
    throw new ConsumerPendingError("PENDING_UNAVAILABLE");
  }
  if (storageRead(storage, key) !== null)
    throw new ConsumerPendingError("PENDING_CHANGED");
}
