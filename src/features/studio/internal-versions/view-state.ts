import {
  internalReviewStateSchema,
  internalVersionListSchema,
  type InternalVersionList,
  sameRevisionTarget,
  internalCanonicalText,
  type InternalReviewState,
  type InternalReviewReceipt,
  type RendererIdentity,
} from "@/features/product/internal-versions/contracts";
import { freezeInternalRequest, type InternalRequest } from "./request";
const equal = (a: unknown, b: unknown) =>
  internalCanonicalText(a) === internalCanonicalText(b);
/** Select only the server's existing baseline; this never manufactures an author approval. */
export function reviewRequestFromState(
  input: InternalReviewState,
  key: string,
): InternalRequest {
  const state = internalReviewStateSchema.parse(input);
  if (
    state.target.revision !== state.observedCurrentRevision ||
    !state.baseline ||
    state.review
  )
    throw Error("INTERNAL_REVIEW_NOT_PREPARABLE");
  return freezeInternalRequest({
    operation: "review",
    tuple: {
      productId: state.productId,
      schemaVersion: "quizforge.review-record.v1",
      idempotencyKey: key,
      target: state.target,
      baseline: state.baseline,
    },
  });
}
function availableVersionCapacity(
  productId: string,
  input: InternalVersionList | undefined,
) {
  const parsed = internalVersionListSchema.safeParse(input);
  return (
    parsed.success &&
    parsed.data.productId === productId &&
    parsed.data.versions.length < 100
  );
}
export function sealRequestFromState(
  input: InternalReviewState,
  choice: RendererIdentity,
  key: string,
  versions: InternalVersionList,
): InternalRequest {
  const state = internalReviewStateSchema.parse(input);
  if (
    !availableVersionCapacity(state.productId, versions) ||
    state.target.revision !== state.observedCurrentRevision ||
    !state.review ||
    !state.engine ||
    !state.rendererChoices.some((c) => equal(c.renderer, choice))
  )
    throw Error("INTERNAL_SEAL_NOT_PREPARABLE");
  return freezeInternalRequest({
    operation: "seal",
    tuple: {
      productId: state.productId,
      schemaVersion: "quizforge.internal-version-seal.v1",
      idempotencyKey: key,
      target: state.target,
      reviewId: state.review.id,
      reviewSha256: state.review.reviewSha256,
      renderer: choice,
      engine: state.engine,
    },
  });
}
export function matchesInternalSelection(
  request: InternalRequest,
  input: InternalReviewState | undefined,
  versions?: InternalVersionList,
) {
  if (!input) return false;
  const parsed = internalReviewStateSchema.safeParse(input);
  if (!parsed.success) return false;
  const state = parsed.data;
  if (
    state.productId !== request.tuple.productId ||
    state.observedCurrentRevision !== request.tuple.target.revision ||
    !sameRevisionTarget(state.target, request.tuple.target)
  )
    return false;
  return request.operation === "review"
    ? !state.review &&
        !!state.baseline &&
        equal(state.baseline, request.tuple.baseline)
    : availableVersionCapacity(state.productId, versions) &&
        !!state.review &&
        state.review.id === request.tuple.reviewId &&
        state.review.reviewSha256 === request.tuple.reviewSha256 &&
        !!state.engine &&
        equal(state.engine, request.tuple.engine) &&
        state.rendererChoices.some((c) =>
          equal(c.renderer, request.tuple.renderer),
        );
}
export type InternalConfirmation = Readonly<{
  request: InternalRequest;
  state: InternalReviewState;
  versions?: InternalVersionList;
}>;
export function internalConfirmation(
  request: InternalRequest,
  state: InternalReviewState,
  versions?: InternalVersionList,
): InternalConfirmation {
  const frozen = freezeInternalRequest(request);
  if (!matchesInternalSelection(frozen, state, versions))
    throw Error("INTERNAL_CONFIRMATION_CHANGED");
  return Object.freeze({
    request: frozen,
    state,
    ...(versions ? { versions } : {}),
  });
}
/** A failed read or a new read object (even identical fields) invalidates unsent confirmation. */
export function matchesInternalConfirmation(
  confirmation: InternalConfirmation,
  state: InternalReviewState | undefined,
  versions?: InternalVersionList,
) {
  return (
    confirmation.state === state &&
    (confirmation.request.operation === "review" ||
      confirmation.versions === versions) &&
    matchesInternalSelection(confirmation.request, state, versions)
  );
}
export function reviewApprovalPresentation(review: InternalReviewReceipt) {
  const approval = review.facts.approval;
  return approval.kind === "author-baseline"
    ? {
        label: "作者既有内测基线批准",
        source: approval.sourceRecordId,
        approvedOn: approval.approvedOn,
        recordedBy: review.recordedBy,
        recordedAt: review.recordedAt,
      }
    : {
        label: "合成测试证据（非作者批准）",
        source: approval.fixtureId,
        approvedOn: null,
        recordedBy: review.recordedBy,
        recordedAt: review.recordedAt,
      };
}
export function versionRevisionRelation(
  targetRevision: number,
  currentRevision: number | undefined,
) {
  return currentRevision === undefined
    ? "当前 head 尚未可靠读取"
    : targetRevision === currentRevision
      ? "封存来源为本次读取的当前修订"
      : targetRevision < currentRevision
        ? "历史修订的固定内测版本"
        : "版本来源高于本次读取值，请重新核对";
}
export const INTERNAL_VERSION_DISCLOSURE =
  "仅限内测；记录既有基线或封存版本不授予对外发布资格。";
