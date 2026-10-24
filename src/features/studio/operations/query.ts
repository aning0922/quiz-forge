import { z } from "zod";
import {
  parseWorkspaceQuery,
  productListQuerySchema,
} from "@/features/product/workspace/contracts";
import type { OperationsQuery } from "./contracts";

export const operationsQuerySchema = productListQuerySchema.extend({
  draft: z.enum(["any", "present", "absent"]).default("any"),
  review: z.enum(["any", "current", "missing"]).default("any"),
});
/** Keep directory decoding, normalization and strictness; consume only the two new dimensions. */
export function parseOperationsQuery(params: URLSearchParams): OperationsQuery {
  if (new TextEncoder().encode(params.toString()).byteLength > 4096)
    throw new Error("INVALID_REQUEST");
  const directory = new URLSearchParams(params);
  for (const key of ["draft", "review"]) {
    if (params.getAll(key).length > 1) throw new Error("INVALID_REQUEST");
    directory.delete(key);
  }
  return operationsQuerySchema.parse({
    ...parseWorkspaceQuery(directory, "product"),
    ...(params.has("draft") ? { draft: params.get("draft") } : {}),
    ...(params.has("review") ? { review: params.get("review") } : {}),
  });
}
export function operationsListHref(query: OperationsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(operationsQuerySchema.parse(query)))
    if (value !== undefined) params.set(key, String(value));
  return `/studio/products?${params}`;
}
