import type {
  ProductDto,
  Page,
  ProductListQuery,
} from "@/features/product/workspace/contracts";
import type {
  RevisionTarget,
  BaselineIdentity,
  InternalReviewFacts,
} from "@/features/product/internal-versions/identity-contracts";

export type OperationsQuery = ProductListQuery & {
  draft: "any" | "present" | "absent";
  /** missing means a current draft exists but has no exact-target review. */
  review: "any" | "current" | "missing";
};
export type Observation<T> =
  | { state: "present"; value: T }
  | { state: "none" | "not-applicable" | "indeterminate"; reason: string };
export type ImportEvidence = {
  id: string;
  status:
    | "awaiting-upload"
    | "receiving"
    | "received"
    | "retryable-failed"
    | "rejected";
  stateRevision: number;
  storageCondition: "clean" | "cleanup-required" | "unknown";
  createdAt: string;
};
export type ValidationEvidence = {
  id: string;
  importId: string;
  status:
    | "validating"
    | "validated"
    | "archiving"
    | "ready"
    | "rejected"
    | "retryable-failed";
  stateRevision: number;
  storageCondition: "clean" | "cleanup-required" | "unknown";
  candidateSha256: string | null;
  createdAt: string;
};
export type DraftEvidence = {
  target: RevisionTarget;
  sourceImportId: string;
  sourceValidationId: string;
  sourceValidationStateRevision: number;
  candidateSha256: string;
  createdAt: string;
};
export type ReviewEvidence = {
  id: string;
  target: RevisionTarget;
  reviewSha256: string;
  sourceImportId: string;
  sourceValidationId: string;
  sourceValidationStateRevision: number;
  baseline: BaselineIdentity;
  approval: InternalReviewFacts["approval"];
  recordedAt: string;
};
export type VersionEvidence = {
  id: string;
  target: RevisionTarget;
  reviewId: string;
  reviewSha256: string;
  snapshotSha256: string;
  createdAt: string;
};
export type TestingEvidence = {
  id: string;
  parentVersionId: string;
  parentSnapshotSha256: string;
  snapshotSha256: string;
  target: RevisionTarget;
  createdAt: string;
};
export type CollectionEvidence<T> = {
  total: number;
  latest: Observation<T>;
};
/** Representatives are latest by created time / ID within EACH relationship group. */
export type RelatedEvidence<T> = {
  currentCount: number;
  historicalCount: number;
  current: Observation<T>;
  historical: Observation<T>;
};
export type NextAction = {
  kind:
    | "directory"
    | "imports"
    | "draft"
    | "preview"
    | "review"
    | "versions"
    | "testing";
  href: string;
  reason: string;
};
export type ProductOperations = {
  schemaVersion: "quizforge.product-operations.v1";
  asOf: string;
  directory: ProductDto;
  content: {
    reception: CollectionEvidence<ImportEvidence>;
    validation: CollectionEvidence<ValidationEvidence>;
    draft: Observation<DraftEvidence>;
  };
  review: {
    current: Observation<ReviewEvidence>;
    historicalCount: number;
    latestHistorical: Observation<ReviewEvidence>;
  };
  versions: RelatedEvidence<VersionEvidence>;
  testing: RelatedEvidence<TestingEvidence>;
  /** This read model cannot resolve an operation retained by any browser tab. */
  browserOperations: {
    state: "indeterminate";
    reason: "browser-operations-not-observable";
  };
  nextActions: NextAction[];
};
export type ProductOperationsPage = Page<ProductOperations> & {
  schemaVersion: "quizforge.product-operations-page.v1";
  asOf: string;
};
export type DashboardMetric = {
  count: number;
  query: OperationsQuery;
  href: string;
};
export type OperationsDashboard = {
  schemaVersion: "quizforge.operations-dashboard.v1";
  asOf: string;
  directoryTotal: DashboardMetric;
  activeDrafts: DashboardMetric;
  activeMissingReview: DashboardMetric;
  recentCreated: ProductOperations[];
};
