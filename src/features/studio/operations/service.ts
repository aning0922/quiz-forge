import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { read } from "@/features/quizpack/import/repository";
import { productIdSchema } from "@/features/product/workspace/contracts";
import { productRow } from "@/features/product/workspace/repository";
import { operationsQuerySchema, operationsListHref } from "./query";
import {
  operationsCount,
  operationsRows,
  observationTime,
  projectOperationsRows,
} from "./repository";
import type {
  OperationsQuery,
  ProductOperationsPage,
  ProductOperations,
  OperationsDashboard,
  DashboardMetric,
} from "./contracts";

function query(input: unknown): OperationsQuery {
  const parsed = operationsQuerySchema.safeParse(input);
  if (!parsed.success) throw new StudioError("INVALID_REQUEST");
  return parsed.data;
}
/** No stale RR-only authorization: each completed read is gated by a NEW read transaction. */
async function authorized<T>(
  db: P2aDatabase,
  token: string | null,
  work: Parameters<typeof read<T>>[2],
): Promise<T> {
  const result = await read(db, token, work);
  await read(db, token, async () => undefined);
  return result;
}
export async function listProductOperations(
  db: P2aDatabase,
  token: string | null,
  input: OperationsQuery,
): Promise<ProductOperationsPage> {
  const value = query(input);
  return authorized(db, token, async (tx) => {
    const asOf = await observationTime(tx),
      total = await operationsCount(tx, value);
    const items = await projectOperationsRows(
      tx,
      await operationsRows(tx, value),
      asOf,
    );
    return {
      schemaVersion: "quizforge.product-operations-page.v1",
      asOf,
      items,
      page: value.page,
      pageSize: value.pageSize,
      total,
      hasNext: value.page * value.pageSize < total,
    };
  });
}
export async function readProductOperations(
  db: P2aDatabase,
  token: string | null,
  productId: string,
): Promise<ProductOperations> {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) throw new StudioError("INVALID_REQUEST");
  return authorized(db, token, async (tx) => {
    const asOf = await observationTime(tx);
    const [value] = await projectOperationsRows(
      tx,
      [await productRow(tx, parsed.data)],
      asOf,
    );
    if (!value) throw new StudioError("STUDIO_UNAVAILABLE");
    return value;
  });
}
export async function readOperationsDashboard(
  db: P2aDatabase,
  token: string | null,
): Promise<OperationsDashboard> {
  return authorized(db, token, async (tx) => {
    const asOf = await observationTime(tx);
    const metric = async (
      input: Partial<OperationsQuery>,
    ): Promise<DashboardMetric> => {
      const value = query(input);
      return {
        count: await operationsCount(tx, value),
        query: value,
        href: operationsListHref(value),
      };
    };
    const directoryTotal = await metric({ status: "all" }),
      activeDrafts = await metric({ status: "active", draft: "present" }),
      activeMissingReview = await metric({
        status: "active",
        review: "missing",
      });
    const recentCreated = await projectOperationsRows(
      tx,
      await operationsRows(tx, query({ status: "all", pageSize: 5 })),
      asOf,
    );
    return {
      schemaVersion: "quizforge.operations-dashboard.v1",
      asOf,
      directoryTotal,
      activeDrafts,
      activeMissingReview,
      recentCreated,
    };
  });
}
export const operationsService = {
  listProductOperations,
  readProductOperations,
  readOperationsDashboard,
};
export type OperationsService = typeof operationsService;
