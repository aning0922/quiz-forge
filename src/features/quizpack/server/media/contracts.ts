import type { ImageDeclaration, ImageFacts } from "../../v1/api";

export type { ImageDeclaration, ImageFacts };

declare const mediaOperationContext: unique symbol;
/** Only createMediaOperationContext can issue a valid runtime identity. */
export interface MediaOperationContext {
  readonly [mediaOperationContext]: true;
  readonly signal: AbortSignal;
  readonly deadlineMonotonicMs: number;
}

export const MEDIA_STOP_REASONS = [
  "CANCELLED",
  "BUSINESS_DEADLINE_EXCEEDED",
  "IMAGE_DEADLINE_EXCEEDED",
  "STORAGE_LOCK_LOST",
  "RUNTIME_FAILED",
  "STOP_UNCONFIRMED",
  "STOP_REQUESTED",
] as const;
export type MediaStopReason = (typeof MEDIA_STOP_REASONS)[number];
export type MediaStopState = Readonly<{
  reason: MediaStopReason;
  stopStartedMonotonicMs: number;
  cleanupDeadlineMonotonicMs: number;
}>;
export type MediaOperationState =
  | Readonly<{
      phase: "active";
      signal: AbortSignal;
      deadlineMonotonicMs: number;
    }>
  | Readonly<{
      phase: "stopping";
      signal: AbortSignal;
      deadlineMonotonicMs: number;
      stop: MediaStopState;
    }>;

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
  | Readonly<{
      outcome: "decoded";
      runId: string;
      profileId: string;
      facts: Readonly<ImageFacts>;
      stopped: "confirmed";
    }>
  | Readonly<{
      outcome: "failed";
      runId: string;
      profileId: string | null;
      code: LaunchFailureCode;
      stopped: "not-started" | "confirmed" | "unknown";
    }>;
export type MediaFailureClassification = "content-rejected" | "interrupted";
/** Runtime/stop failure must never be frozen as a permanent content verdict. */
export function classifyMediaFailure(
  code: LaunchFailureCode,
): MediaFailureClassification {
  return code === "INPUT_LIMIT" || code === "DECODE_REJECTED"
    ? "content-rejected"
    : "interrupted";
}

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

/** Safe evidence identity only; no root, daemon identity, commands or private paths. */
export type MediaRuntimeBinding = Readonly<{
  schema: "quizpack-media-runtime-binding.v1";
  platform: "darwin-arm64" | "linux-x64";
  componentId: string;
  deploymentId: string;
  runtimeBundleHash: string;
  limitsHash: string;
}>;
export type MediaRuntimeBindingResult =
  | Readonly<{ outcome: "bound"; binding: MediaRuntimeBinding }>
  | Readonly<{
      outcome: "unavailable";
      code: Extract<
        LaunchFailureCode,
        | "INVALID_INPUT"
        | "CANCELLED"
        | "DEADLINE_EXCEEDED"
        | "UNSUPPORTED_PLATFORM"
        | "ISOLATION_UNAVAILABLE"
        | "WORKER_FAILED"
        | "STOP_UNCONFIRMED"
      >;
    }>;

export type MediaEvidenceParseResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; code: "INVALID_MEDIA_EVIDENCE" }>;

/** An invalid context is interrupted, even when no OS launch was issued. */
export function mediaStopFailureCode(
  stop: MediaStopState,
): Extract<
  LaunchFailureCode,
  "CANCELLED" | "DEADLINE_EXCEEDED" | "STOP_UNCONFIRMED" | "WORKER_FAILED"
> {
  if (stop.reason === "CANCELLED") return "CANCELLED";
  if (
    stop.reason === "BUSINESS_DEADLINE_EXCEEDED" ||
    stop.reason === "IMAGE_DEADLINE_EXCEEDED"
  )
    return "DEADLINE_EXCEEDED";
  if (stop.reason === "STOP_UNCONFIRMED") return "STOP_UNCONFIRMED";
  return "WORKER_FAILED";
}
