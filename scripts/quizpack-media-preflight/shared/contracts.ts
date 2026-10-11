import type {
  ImageDeclaration,
  ImageFacts,
} from "../../../src/features/quizpack/v1/api";

export type { ImageDeclaration, ImageFacts };
export type LaunchContext = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
export const LAUNCH_FAILURE_CODES = [
  "UNSUPPORTED_PLATFORM",
  "ISOLATION_UNAVAILABLE",
  "BUSY",
  "INVALID_INPUT",
  "INPUT_LIMIT",
  "DECODE_REJECTED",
  "WORKER_FAILED",
  "OUTPUT_INVALID",
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "STOP_UNCONFIRMED",
] as const;
export type LaunchFailureCode = (typeof LAUNCH_FAILURE_CODES)[number];
export type LaunchResult =
  | {
      outcome: "decoded";
      runId: string;
      profileId: string;
      facts: ImageFacts;
      stopped: "confirmed";
    }
  | {
      outcome: "failed";
      runId: string;
      profileId: string | null;
      code: LaunchFailureCode;
      stopped: "not-started" | "confirmed" | "unknown";
    };
export type IsolatedImageLauncher = (
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
) => Promise<LaunchResult>;
export const MEDIA_LIMITS = Object.freeze({
  bytes: 8 * 1024 * 1024,
  dimension: 8192,
  pixels: 16_000_000,
  executionMs: 5000,
  cleanupMs: 5000,
  stdoutBytes: 2048,
  stderrBytes: 4096,
  controlBytes: 16 * 1024,
});
