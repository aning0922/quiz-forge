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
