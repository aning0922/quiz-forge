import {
  importListQuerySchema,
  type ImportListQuery,
} from "@/features/quizpack/import/contracts";

export function parseImportQuery(params: URLSearchParams): ImportListQuery {
  const value: Record<string, unknown> = Object.create(null);
  for (const [key, raw] of params) {
    if (Object.hasOwn(value, key)) throw new Error("INVALID_REQUEST");
    if (key === "page" || key === "pageSize") {
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("INVALID_REQUEST");
      value[key] = Number(raw);
    } else value[key] = raw;
  }
  return importListQuerySchema.parse(value);
}

export function exactIntentQuery(idempotencyKey: string): string {
  return new URLSearchParams({
    idempotencyKey,
    page: "1",
    pageSize: "1",
  }).toString();
}
