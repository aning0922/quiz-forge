import {
  validationListQuerySchema,
  type ValidationListQuery,
} from "@/features/quizpack/validation/contracts";
export function parseValidationQuery(
  params: URLSearchParams,
): ValidationListQuery {
  const value: Record<string, unknown> = Object.create(null);
  for (const [key, raw] of params) {
    if (Object.hasOwn(value, key)) throw new Error("INVALID_REQUEST");
    if (key === "page" || key === "pageSize") {
      if (!/^[1-9][0-9]*$/.test(raw)) throw new Error("INVALID_REQUEST");
      value[key] = Number(raw);
    } else value[key] = raw;
  }
  return validationListQuerySchema.parse(value);
}
export function exactValidationQuery(key: string): string {
  return new URLSearchParams({
    validationKey: key,
    page: "1",
    pageSize: "1",
  }).toString();
}
