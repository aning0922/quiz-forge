import { z } from "zod";
import {
  productIdSchema,
  productSlugSchema,
  titleSchema,
  taxonomyIdSchema,
  taxonomyNameSchema,
  revisionSchema,
} from "@/features/product/workspace/contracts";
import {
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import {
  importEvidenceSchema,
  validationEvidenceSchema,
  draftEvidenceSchema,
  reviewEvidenceSchema,
  versionEvidenceSchema,
  testingEvidenceSchema,
  operationsActions,
} from "./projection";
import { operationsQuerySchema, operationsListHref } from "./query";
import type {
  ProductOperations,
  ProductOperationsPage,
  OperationsDashboard,
  OperationsQuery,
} from "./contracts";

export const OPERATIONS_RESPONSE_BYTES = {
  list: 1_048_576,
  detail: 65_536,
  dashboard: 131_072,
} as const;
const moment = z.iso.datetime({ precision: 3 }),
  count = z.number().int().min(0).max(2147483647);
const taxonomy = z.strictObject({
  id: taxonomyIdSchema,
  slug: productSlugSchema,
  name: taxonomyNameSchema,
  revision: revisionSchema,
  archivedAt: moment.nullable(),
});
const directory = z.strictObject({
  id: productIdSchema,
  slug: productSlugSchema,
  title: titleSchema,
  metadataRevision: revisionSchema,
  createdAt: moment,
  updatedAt: moment,
  archivedAt: moment.nullable(),
  primaryCategory: taxonomy.nullable(),
  tags: z.array(taxonomy).max(8),
});
const observation = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("present"), value }),
    z.strictObject({
      state: z.enum(["none", "not-applicable", "indeterminate"]),
      reason: z.string().min(1).max(120),
    }),
  ]);
const collection = <T extends z.ZodType>(value: T) =>
  z.strictObject({ total: count, latest: observation(value) });
const related = <T extends z.ZodType>(value: T) =>
  z.strictObject({
    currentCount: count.max(100),
    historicalCount: count.max(100),
    current: observation(value),
    historical: observation(value),
  });
const productSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.product-operations.v1"),
  asOf: moment,
  directory,
  content: z.strictObject({
    reception: collection(importEvidenceSchema),
    validation: collection(validationEvidenceSchema),
    draft: observation(draftEvidenceSchema),
  }),
  review: z.strictObject({
    current: observation(reviewEvidenceSchema),
    historicalCount: count.max(100),
    latestHistorical: observation(reviewEvidenceSchema),
  }),
  versions: related(versionEvidenceSchema),
  testing: related(testingEvidenceSchema),
  browserOperations: z.strictObject({
    state: z.literal("indeterminate"),
    reason: z.literal("browser-operations-not-observable"),
  }),
  nextActions: z
    .array(
      z.strictObject({
        kind: z.enum([
          "directory",
          "imports",
          "draft",
          "preview",
          "review",
          "versions",
          "testing",
        ]),
        href: z.string().max(512),
        reason: z.string().max(200),
      }),
    )
    .max(7),
});
function requireFact(condition: unknown): asserts condition {
  if (!condition) throw new Error("OPERATIONS_RESPONSE_INVALID");
}
function within(input: unknown, maximum: number) {
  requireFact(
    new TextEncoder().encode(JSON.stringify(input)).byteLength <= maximum,
  );
}
function checkProduct(value: ProductOperations, productId?: string): void {
  requireFact(!productId || value.directory.id === productId);
  requireFact(
    new Set(value.directory.tags.map((tag) => tag.id)).size ===
      value.directory.tags.length,
  );
  const draft = value.content.draft;
  requireFact(
    draft.state === "present" ||
      (draft.state === "none" && draft.reason === "no-current-draft"),
  );
  const target = draft.state === "present" ? draft.value.target : null;
  for (const [item, reason] of [
    [value.content.reception, "no-import-record"],
    [value.content.validation, "no-validation-record"],
  ] as const)
    requireFact(
      item.total
        ? item.latest.state === "present"
        : item.latest.state === "none" && item.latest.reason === reason,
    );
  const review = value.review.current;
  if (!target)
    requireFact(
      review.state === "not-applicable" &&
        review.reason === "no-current-draft" &&
        !value.review.historicalCount &&
        !value.versions.historicalCount &&
        !value.testing.historicalCount,
    );
  else if (review.state === "present") {
    requireFact(sameRevisionTarget(review.value.target, target));
    if (draft.state === "present")
      requireFact(
        review.value.sourceImportId === draft.value.sourceImportId &&
          review.value.sourceValidationId === draft.value.sourceValidationId &&
          review.value.sourceValidationStateRevision ===
            draft.value.sourceValidationStateRevision,
      );
  } else
    requireFact(
      review.state === "none" &&
        review.reason === "no-exact-current-target-record",
    );
  const checkGroup = (
    amount: number,
    observation: {
      state: string;
      value?: { target: RevisionTarget };
      reason?: string;
    },
    current: boolean,
  ) => {
    requireFact(
      amount
        ? observation.state === "present"
        : current && !target
          ? observation.state === "not-applicable" &&
            observation.reason === "no-current-draft"
          : observation.state === "none" &&
            observation.reason ===
              (current
                ? "no-exact-current-target-record"
                : "no-historical-record"),
    );
    if (observation.state === "present")
      requireFact(
        target &&
          sameRevisionTarget(observation.value!.target, target) === current,
      );
  };
  checkGroup(
    value.review.historicalCount,
    value.review.latestHistorical,
    false,
  );
  for (const item of [value.versions, value.testing]) {
    requireFact(item.currentCount + item.historicalCount <= 100);
    checkGroup(item.currentCount, item.current, true);
    checkGroup(item.historicalCount, item.historical, false);
  }
  if (value.versions.current.state === "present") {
    requireFact(review.state === "present");
    requireFact(
      value.versions.current.value.reviewId === review.value.id &&
        value.versions.current.value.reviewSha256 === review.value.reviewSha256,
    );
  }
  if (value.testing.currentCount) requireFact(value.versions.currentCount > 0);
  if (value.testing.historicalCount)
    requireFact(value.versions.historicalCount > 0);
  requireFact(
    JSON.stringify(value.nextActions) ===
      JSON.stringify(
        operationsActions(
          value.directory.id,
          target,
          review.state === "present",
        ),
      ),
  );
}
export function parseProductOperations(
  input: unknown,
  productId?: string,
): ProductOperations {
  within(input, OPERATIONS_RESPONSE_BYTES.detail);
  const value = productSchema.parse(input);
  checkProduct(value, productId);
  return value;
}
export function parseProductOperationsPage(
  input: unknown,
  query?: OperationsQuery,
): ProductOperationsPage {
  within(input, OPERATIONS_RESPONSE_BYTES.list);
  const value = z
    .strictObject({
      schemaVersion: z.literal("quizforge.product-operations-page.v1"),
      asOf: moment,
      items: z.array(productSchema).max(50),
      page: z.number().int().min(1).max(1000),
      pageSize: z.number().int().min(1).max(50),
      total: count,
      hasNext: z.boolean(),
    })
    .parse(input);
  requireFact(
    value.items.length ===
      Math.min(
        value.pageSize,
        Math.max(0, value.total - (value.page - 1) * value.pageSize),
      ) && value.hasNext === value.page * value.pageSize < value.total,
  );
  requireFact(
    new Set(value.items.map((item) => item.directory.id)).size ===
      value.items.length,
  );
  if (query)
    requireFact(value.page === query.page && value.pageSize === query.pageSize);
  for (const [index, item] of value.items.entries()) {
    checkProduct(item);
    requireFact(item.asOf === value.asOf);
    const previous = value.items[index - 1]?.directory;
    if (previous)
      requireFact(
        previous.createdAt > item.directory.createdAt ||
          (previous.createdAt === item.directory.createdAt &&
            previous.id < item.directory.id),
      );
    if (query) {
      const draft = item.content.draft.state === "present",
        review = item.review.current.state === "present";
      requireFact(
        query.status === "all" ||
          (item.directory.archivedAt !== null) ===
            (query.status === "archived"),
      );
      requireFact(
        query.draft === "any" || draft === (query.draft === "present"),
      );
      requireFact(
        query.review === "any" ||
          (query.review === "current" ? review : draft && !review),
      );
      if (query.categoryId)
        requireFact(item.directory.primaryCategory?.id === query.categoryId);
      if (query.unclassified)
        requireFact(item.directory.primaryCategory === null);
      if (query.tagId)
        requireFact(item.directory.tags.some((tag) => tag.id === query.tagId));
    }
  }
  return value;
}
export function parseOperationsDashboard(input: unknown): OperationsDashboard {
  within(input, OPERATIONS_RESPONSE_BYTES.dashboard);
  const metric = z.strictObject({
    count,
    query: operationsQuerySchema,
    href: z.string().max(2048),
  });
  const value = z
    .strictObject({
      schemaVersion: z.literal("quizforge.operations-dashboard.v1"),
      asOf: moment,
      directoryTotal: metric,
      activeDrafts: metric,
      activeMissingReview: metric,
      recentCreated: z.array(productSchema).max(5),
    })
    .parse(input);
  for (const [item, condition] of [
    [value.directoryTotal, { status: "all" }],
    [value.activeDrafts, { status: "active", draft: "present" }],
    [value.activeMissingReview, { status: "active", review: "missing" }],
  ] as const) {
    const expected = operationsQuerySchema.parse(condition);
    requireFact(
      JSON.stringify(item.query) === JSON.stringify(expected) &&
        item.href === operationsListHref(expected),
    );
  }
  requireFact(
    value.activeMissingReview.count <= value.activeDrafts.count &&
      value.activeDrafts.count <= value.directoryTotal.count,
  );
  parseProductOperationsPage({
    schemaVersion: "quizforge.product-operations-page.v1",
    asOf: value.asOf,
    items: value.recentCreated,
    page: 1,
    pageSize: 5,
    total: value.directoryTotal.count,
    hasNext: value.directoryTotal.count > 5,
  });
  return value;
}
