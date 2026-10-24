import { z } from "zod";
import {
  revisionTargetSchema,
  baselineIdentitySchema,
  baselineApprovalSchema,
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import type { ProductDto } from "@/features/product/workspace/contracts";
import type {
  Observation,
  CollectionEvidence,
  RelatedEvidence,
  ImportEvidence,
  ValidationEvidence,
  DraftEvidence,
  ReviewEvidence,
  VersionEvidence,
  TestingEvidence,
  ProductOperations,
  NextAction,
} from "./contracts";

const uuid = z.uuid();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().min(0).max(2147483647);
const stateRevision = z.number().int().min(1).max(2147483647);
const moment = z.string().transform((value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("INVALID_METADATA_TIME");
  return date.toISOString();
});
const storageCondition = z.enum(["clean", "cleanup-required", "unknown"]);
export const importEvidenceSchema = z.strictObject({
  id: uuid,
  status: z.enum([
    "awaiting-upload",
    "receiving",
    "received",
    "retryable-failed",
    "rejected",
  ]),
  stateRevision,
  storageCondition,
  createdAt: moment,
});
export const validationEvidenceSchema = z.strictObject({
  id: uuid,
  importId: uuid,
  status: z.enum([
    "validating",
    "validated",
    "archiving",
    "ready",
    "rejected",
    "retryable-failed",
  ]),
  stateRevision,
  storageCondition,
  candidateSha256: sha.nullable(),
  createdAt: moment,
});
export const draftEvidenceSchema = z.strictObject({
  target: revisionTargetSchema,
  sourceImportId: uuid,
  sourceValidationId: uuid,
  sourceValidationStateRevision: stateRevision,
  candidateSha256: sha,
  createdAt: moment,
});
export const reviewEvidenceSchema = z.strictObject({
  id: uuid,
  target: revisionTargetSchema,
  reviewSha256: sha,
  sourceImportId: uuid,
  sourceValidationId: uuid,
  sourceValidationStateRevision: stateRevision,
  baseline: baselineIdentitySchema,
  approval: baselineApprovalSchema,
  recordedAt: moment,
});
export const versionEvidenceSchema = z.strictObject({
  id: uuid,
  target: revisionTargetSchema,
  reviewId: uuid,
  reviewSha256: sha,
  snapshotSha256: sha,
  createdAt: moment,
});
export const testingEvidenceSchema = z.strictObject({
  id: uuid,
  parentVersionId: uuid,
  parentSnapshotSha256: sha,
  snapshotSha256: sha,
  target: revisionTargetSchema,
  createdAt: moment,
});
export type EvidenceInput = {
  reception: { total: number; latest: ImportEvidence | null };
  validation: { total: number; latest: ValidationEvidence | null };
  draft: DraftEvidence | null;
  reviews: ReviewEvidence[];
  versions: VersionEvidence[];
  testing: TestingEvidence[];
};
const none = (reason: string): Observation<never> => ({
  state: "none",
  reason,
});
const present = <T>(value: T): Observation<T> => ({ state: "present", value });
function collection<T>(
  input: { total: number; latest: T | null },
  reason: string,
): CollectionEvidence<T> {
  count.parse(input.total);
  if ((input.total === 0) !== (input.latest === null))
    throw new Error("BROKEN_COLLECTION");
  return {
    total: input.total,
    latest: input.latest ? present(input.latest) : none(reason),
  };
}
function related<T extends { target: RevisionTarget }>(
  values: T[],
  target: RevisionTarget | null,
): RelatedEvidence<T> {
  if (values.length > 100) throw new Error("METADATA_LIMIT");
  // SQL supplies deterministic newest-first order. Keep both relationship groups, including when current is absent.
  const current = values.filter(
    (value) => target && sameRevisionTarget(value.target, target),
  );
  const historical = values.filter(
    (value) => !target || !sameRevisionTarget(value.target, target),
  );
  return {
    currentCount: current.length,
    historicalCount: historical.length,
    current: target
      ? current[0]
        ? present(current[0])
        : none("no-exact-current-target-record")
      : { state: "not-applicable", reason: "no-current-draft" },
    historical: historical[0]
      ? present(historical[0])
      : none("no-historical-record"),
  };
}
export function projectProductOperations(
  directory: ProductDto,
  asOf: string,
  raw: EvidenceInput,
): ProductOperations {
  const draft = raw.draft ? draftEvidenceSchema.parse(raw.draft) : null;
  const reviews = raw.reviews.map((value) => reviewEvidenceSchema.parse(value));
  const versions = raw.versions.map((value) =>
    versionEvidenceSchema.parse(value),
  );
  const testing = raw.testing.map((value) =>
    testingEvidenceSchema.parse(value),
  );
  if (
    (!draft && (reviews.length || versions.length || testing.length)) ||
    reviews.length > 100
  )
    throw new Error("BROKEN_DRAFT_RELATION");
  const reviewGroups = related(reviews, draft?.target ?? null);
  if (reviewGroups.currentCount > 1)
    throw new Error("DUPLICATE_CURRENT_REVIEW");
  if (draft && reviewGroups.current.state === "present") {
    const review = reviewGroups.current.value;
    if (
      review.sourceImportId !== draft.sourceImportId ||
      review.sourceValidationId !== draft.sourceValidationId ||
      review.sourceValidationStateRevision !==
        draft.sourceValidationStateRevision
    )
      throw new Error("BROKEN_REVIEW_SOURCE");
  }
  // Rows are not allowed to smuggle a cross-product/cross-target parent through an ID-only match.
  for (const version of versions) {
    const review = reviews.find((review) => review.id === version.reviewId);
    if (
      !review ||
      review.reviewSha256 !== version.reviewSha256 ||
      !sameRevisionTarget(review.target, version.target)
    )
      throw new Error("BROKEN_VERSION_REVIEW");
  }
  for (const play of testing) {
    const parent = versions.find(
      (version) => version.id === play.parentVersionId,
    );
    if (
      !parent ||
      parent.snapshotSha256 !== play.parentSnapshotSha256 ||
      !sameRevisionTarget(parent.target, play.target)
    )
      throw new Error("BROKEN_PLAY_PARENT");
  }
  const nextActions = operationsActions(
    directory.id,
    draft?.target ?? null,
    reviewGroups.currentCount > 0,
  );
  return {
    schemaVersion: "quizforge.product-operations.v1",
    asOf: moment.parse(asOf),
    directory,
    content: {
      reception: collection(
        {
          total: raw.reception.total,
          latest: raw.reception.latest
            ? importEvidenceSchema.parse(raw.reception.latest)
            : null,
        },
        "no-import-record",
      ),
      validation: collection(
        {
          total: raw.validation.total,
          latest: raw.validation.latest
            ? validationEvidenceSchema.parse(raw.validation.latest)
            : null,
        },
        "no-validation-record",
      ),
      draft: draft ? present(draft) : none("no-current-draft"),
    },
    review: {
      current: reviewGroups.current,
      historicalCount: reviewGroups.historicalCount,
      latestHistorical: reviewGroups.historical,
    },
    versions: related(versions, draft?.target ?? null),
    testing: related(testing, draft?.target ?? null),
    browserOperations: {
      state: "indeterminate",
      reason: "browser-operations-not-observable",
    },
    nextActions,
  };
}

export function operationsActions(
  productId: string,
  target: RevisionTarget | null,
  hasReview: boolean,
): NextAction[] {
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const nextActions: NextAction[] = [
    { kind: "directory", href: base, reason: "查看测评目录信息" },
    {
      kind: "imports",
      href: `${base}/imports`,
      reason: "查看内容包接收与原请求；摘要不核实浏览器待确认操作",
    },
  ];
  if (target) {
    const revision = `${base}/drafts/${target.draftId}/revisions/${target.revision}`;
    nextActions.push(
      {
        kind: "draft",
        href: `${base}/draft`,
        reason: "查看当前草稿与修订历史",
      },
      {
        kind: "preview",
        href: `${revision}/preview`,
        reason: "打开此固定修订预览；不表示已人工查看",
      },
      {
        kind: "review",
        href: `${revision}/internal-review`,
        reason: hasReview
          ? "查看精确匹配当前修订的审核依据"
          : "当前修订尚无匹配审核依据",
      },
    );
  }
  nextActions.push(
    {
      kind: "versions",
      href: `${base}/internal-versions`,
      reason: "查看固定内测版本及其来源",
    },
    {
      kind: "testing",
      href: `${base}/consumer-access`,
      reason: "查看测评内测记录；不表示公开发布",
    },
  );
  return nextActions;
}
