import { types } from "node:util";
import {
  cloneFoundationJson,
  hashFoundationJson,
  type FoundationJson,
} from "../../lib/foundation-json";

/** Local F1 envelope only; callers must separately validate content's domain contract. */
export interface ProductDraft {
  readonly productId: string;
  readonly draftId: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly content: FoundationJson;
}

/** Matching this binding proves freshness only, never approval or publishability. */
export type DraftEvidenceBinding = Pick<
  ProductDraft,
  "productId" | "draftId" | "revision" | "contentHash"
>;

export class ProductDraftError extends Error {
  constructor(public readonly code: string) {
    super("Draft operation rejected.");
    this.name = "ProductDraftError";
  }
}

const reject = (code: string): never => {
  throw new ProductDraftError(code);
};
const validId = (input: unknown): input is string =>
  typeof input === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input);
const validRevision = (input: unknown): input is number =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 1;

function record(
  input: unknown,
  allowed: readonly string[],
): Record<string, FoundationJson> {
  // Envelope metadata must not consume the content's own byte/depth budget.
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    types.isProxy(input)
  )
    reject("DRAFT_INVALID_INPUT");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    reject("DRAFT_INVALID_INPUT");
  if (Object.getOwnPropertySymbols(input).length) reject("DRAFT_INVALID_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const object: Record<string, FoundationJson> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (
      !allowed.includes(key) ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      reject("DRAFT_INVALID_INPUT");
    object[key] = cloneFoundationJson(descriptor.value);
  }
  return object;
}

function verifiedDraft(input: unknown): ProductDraft {
  const draft = record(input, [
    "productId",
    "draftId",
    "revision",
    "contentHash",
    "content",
  ]);
  if (!validId(draft.productId) || !validId(draft.draftId))
    reject("DRAFT_INVALID_IDENTITY");
  if (!validRevision(draft.revision)) reject("DRAFT_INVALID_REVISION");
  if (!Object.hasOwn(draft, "content")) reject("DRAFT_INVALID_INPUT");
  if (
    typeof draft.contentHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(draft.contentHash) ||
    hashFoundationJson(draft.content) !== draft.contentHash
  )
    reject("DRAFT_HASH_MISMATCH");
  return draft as unknown as ProductDraft;
}

export function createProductDraft(input: {
  productId: string;
  draftId: string;
  content: unknown;
}): ProductDraft {
  const request = record(input, ["productId", "draftId", "content"]);
  if (!validId(request.productId) || !validId(request.draftId))
    reject("DRAFT_INVALID_IDENTITY");
  if (!Object.hasOwn(request, "content")) reject("DRAFT_INVALID_INPUT");
  return {
    productId: request.productId as string,
    draftId: request.draftId as string,
    revision: 1,
    contentHash: hashFoundationJson(request.content),
    content: request.content!,
  };
}

/**
 * Full content replacement, with fixed identity and optimistic revision comparison.
 * Omitted content is an explicit no-op: a detached copy with the same revision/hash.
 * Canonically equal content is also a no-op, preserving evidence for the same content.
 */
export function updateProductDraft(
  input: ProductDraft,
  update: {
    productId: string;
    draftId: string;
    expectedRevision: number;
    content?: unknown;
  },
): ProductDraft {
  const draft = verifiedDraft(input);
  const request = record(update, [
    "productId",
    "draftId",
    "expectedRevision",
    "content",
  ]);
  if (
    request.productId !== draft.productId ||
    request.draftId !== draft.draftId
  )
    reject("DRAFT_IDENTITY_MISMATCH");
  if (!validRevision(request.expectedRevision))
    reject("DRAFT_INVALID_REVISION");
  if (request.expectedRevision !== draft.revision)
    reject("DRAFT_REVISION_CONFLICT");
  if (!Object.hasOwn(request, "content")) return draft;
  const contentHash = hashFoundationJson(request.content);
  if (contentHash === draft.contentHash)
    return { ...draft, content: request.content! };
  if (draft.revision === Number.MAX_SAFE_INTEGER)
    reject("DRAFT_REVISION_LIMIT");
  return {
    productId: draft.productId,
    draftId: draft.draftId,
    revision: draft.revision + 1,
    contentHash,
    content: request.content!,
  };
}

export function createDraftEvidenceBinding(
  input: ProductDraft,
): DraftEvidenceBinding {
  const draft = verifiedDraft(input);
  return {
    productId: draft.productId,
    draftId: draft.draftId,
    revision: draft.revision,
    contentHash: draft.contentHash,
  };
}

export function matchesDraftEvidence(
  input: ProductDraft,
  evidence: unknown,
): boolean {
  try {
    const draft = verifiedDraft(input);
    const binding = record(evidence, [
      "productId",
      "draftId",
      "revision",
      "contentHash",
    ]);
    return (
      binding.productId === draft.productId &&
      binding.draftId === draft.draftId &&
      binding.revision === draft.revision &&
      binding.contentHash === draft.contentHash
    );
  } catch {
    return false;
  }
}
