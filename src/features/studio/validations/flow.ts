import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import { StudioClientError } from "../client";
import {
  preparedValidationDtoSchema,
  type StartValidationResult,
  type ValidationDto,
} from "@/features/quizpack/validation/contracts";
import {
  acquirePair,
  addPrepared,
  markBeforeStart,
  pendingTupleSchema,
  readPending,
  removeExact,
  sameTuple,
  type PendingStorage,
  type PendingTuple,
} from "./pending";
import {
  checkedValidationFetch,
  checkPrepared,
  checkStart,
  checkValidationPage,
  validationEndpoint,
  type RoutePair,
} from "./client";
import { exactValidationQuery } from "./query";
const json = (csrf: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-csrf-token": csrf },
  body: JSON.stringify(body),
});
export function preparedTuple(
  dto: Parameters<typeof checkPrepared>[0],
): PendingTuple {
  // Parse strict DTO before replacing the public key name.
  const value = preparedValidationDtoSchema.parse(dto);
  return pendingTupleSchema.parse({
    productId: value.productId,
    importId: value.importId,
    expectedImportStateRevision: value.expectedImportStateRevision,
    archiveSha256: value.archiveSha256,
    archiveBytes: value.archiveBytes,
    identitySha256: value.identitySha256,
    expectedValidationKey: value.validationKey,
  });
}
type Invocation = {
  tuple: PendingTuple;
  token: object;
  authorityEpoch: number;
};
const notStartedInvocations = new WeakMap<object, Invocation>();
const currentInvocations = new Map<string, Invocation>();
const invocationPair = (tuple: PendingTuple) =>
  JSON.stringify([tuple.productId, tuple.importId]);
function retireInvocation(tuple: PendingTuple) {
  const key = invocationPair(tuple);
  const current = currentInvocations.get(key);
  if (current && sameTuple(current.tuple, tuple))
    currentInvocations.delete(key);
}
async function sendPrepared(
  storage: PendingStorage,
  tuple: PendingTuple,
  csrf: string,
): Promise<StartValidationResult> {
  const authorityEpoch = captureStudioEpoch();
  // Persistence, complete readback, and first fetch are one synchronous turn.
  const invocation = { tuple, token: Object.freeze({}), authorityEpoch };
  // Revoke any earlier proof even if persistence succeeds but its readback fails.
  currentInvocations.set(invocationPair(tuple), invocation);
  markBeforeStart(storage, tuple);
  const result = await checkedValidationFetch(
    validationEndpoint(tuple),
    json(csrf, {
      expectedImportStateRevision: tuple.expectedImportStateRevision,
      expectedValidationKey: tuple.expectedValidationKey,
    }),
    (value, status) => checkStart(value, status, tuple),
    true,
    [200, 201],
  );
  if (result.outcome === "record") {
    retireInvocation(tuple);
    if (!acceptsStudioEpoch(authorityEpoch))
      throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
    removeExact(storage, tuple, true);
  } else if (
    currentInvocations.get(invocationPair(tuple))?.token === invocation.token
  )
    notStartedInvocations.set(result, invocation);
  // A strict not-started result remains pending until the user explicitly abandons this invocation.
  return result;
}
export async function prepareAndStart(
  storage: PendingStorage,
  expected: Parameters<typeof checkPrepared>[1],
  csrf: string,
  onPrepared?: (tuple: PendingTuple) => void,
): Promise<StartValidationResult> {
  const authorityEpoch = captureStudioEpoch();
  const release = acquirePair(expected);
  try {
    if (
      readPending(storage).some(
        (entry) =>
          entry.tuple.productId === expected.productId &&
          entry.tuple.importId === expected.importId,
      )
    )
      throw new Error("PENDING_REQUEST_EXISTS");
    currentInvocations.delete(
      JSON.stringify([expected.productId, expected.importId]),
    );
    const dto = await checkedValidationFetch(
      `${validationEndpoint(expected)}/prepare`,
      json(csrf, {
        expectedImportStateRevision: expected.expectedImportStateRevision,
      }),
      (value) => checkPrepared(value, expected),
    );
    if (!acceptsStudioEpoch(authorityEpoch))
      throw new StudioClientError("STUDIO_REQUEST_STALE");
    const tuple = Object.freeze(preparedTuple(dto));
    addPrepared(storage, tuple);
    onPrepared?.(tuple);
    return await sendPrepared(storage, tuple, csrf);
  } finally {
    release();
  }
}
export async function continuePrepared(
  storage: PendingStorage,
  input: PendingTuple,
  csrf: string,
): Promise<StartValidationResult> {
  const tuple = Object.freeze(pendingTupleSchema.parse(input));
  const release = acquirePair(tuple);
  try {
    return await sendPrepared(storage, tuple, csrf);
  } finally {
    release();
  }
}
export async function reconcilePending(
  storage: PendingStorage,
  input: PendingTuple,
): Promise<ValidationDto | null> {
  const authorityEpoch = captureStudioEpoch();
  const tuple = Object.freeze(pendingTupleSchema.parse(input));
  const page = await checkedValidationFetch(
    `${validationEndpoint(tuple)}?${exactValidationQuery(tuple.expectedValidationKey)}`,
    {},
    (value) =>
      checkValidationPage(value, { ...tuple, page: 1, pageSize: 1, tuple }),
  );
  const row = page.items[0];
  if (!row) return null;
  retireInvocation(tuple);
  if (!acceptsStudioEpoch(authorityEpoch))
    throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
  removeExact(storage, tuple, true);
  return row;
}
export function abandonNotStarted(
  storage: PendingStorage,
  tuple: PendingTuple,
  result: StartValidationResult,
): boolean {
  // Only the current invocation may pass its strict result; UI never offers this after reload.
  const proof = notStartedInvocations.get(result);
  if (
    !proof ||
    !acceptsStudioEpoch(proof.authorityEpoch) ||
    currentInvocations.get(invocationPair(tuple))?.token !== proof.token ||
    !sameTuple(proof.tuple, tuple) ||
    checkStart(result, 200, tuple).outcome !== "not-started"
  )
    throw new Error("INVALID_NOT_STARTED_RESPONSE");
  const release = acquirePair(tuple);
  try {
    const removed = removeExact(storage, tuple, true);
    if (removed) {
      notStartedInvocations.delete(result);
      retireInvocation(tuple);
    }
    return removed;
  } finally {
    release();
  }
}
export type { RoutePair };
