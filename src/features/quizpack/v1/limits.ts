import { types } from "node:util";

import type { Result } from "./api";

export interface PackLimits {
  archiveBytes: number;
  entries: number;
  resources: number;
  totalUncompressedBytes: number;
  manifestBytes: number;
  contentBytes: number;
  resourceBytes: number;
  compressionRatio: number;
  jsonDepth: number;
  questions: number;
  optionsPerQuestion: number;
  dimensions: number;
  results: number;
  imageDimension: number;
  imagePixels: number;
  operationMs: number;
  imageMs: number;
  issues: number;
}

export const QUIZPACK_POLICY_ID = "quizpack-local-p1.v1";
export const QUIZPACK_VALIDATOR_VERSION = "1.0.0";
export const PACK_LIMITS: Readonly<PackLimits> = Object.freeze({
  archiveBytes: 32 * 1024 * 1024,
  entries: 66,
  resources: 64,
  totalUncompressedBytes: 64 * 1024 * 1024,
  manifestBytes: 256 * 1024,
  contentBytes: 1024 * 1024,
  resourceBytes: 8 * 1024 * 1024,
  compressionRatio: 100,
  jsonDepth: 32,
  questions: 100,
  optionsPerQuestion: 8,
  dimensions: 16,
  results: 32,
  imageDimension: 8192,
  imagePixels: 16_000_000,
  operationMs: 60_000,
  imageMs: 5_000,
  issues: 100,
});

/** Snapshot only valid downward overrides before starting asynchronous work. */
export function resolvePackLimits(
  overrides?: Partial<PackLimits>,
): Result<Readonly<PackLimits>> {
  const invalid = (): Result<Readonly<PackLimits>> => ({
    ok: false,
    issues: [
      {
        code: "INVALID_LIMITS",
        path: [],
        message: "Invalid validation limits.",
      },
    ],
  });
  if (overrides === undefined) return { ok: true, value: { ...PACK_LIMITS } };
  if (
    overrides === null ||
    typeof overrides !== "object" ||
    types.isProxy(overrides) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(overrides))
  )
    return invalid();
  const result = { ...PACK_LIMITS };
  const descriptors = Object.getOwnPropertyDescriptors(overrides);
  for (const key of Reflect.ownKeys(overrides)) {
    if (typeof key !== "string" || !Object.hasOwn(PACK_LIMITS, key))
      return invalid();
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor) || !descriptor.enumerable) return invalid();
    const value: unknown = descriptor.value;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > PACK_LIMITS[key as keyof PackLimits]
    )
      return invalid();
    result[key as keyof PackLimits] = value;
  }
  return { ok: true, value: Object.freeze(result) };
}
