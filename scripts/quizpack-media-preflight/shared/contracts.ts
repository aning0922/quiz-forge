// Only the offline entry accepts a structural context. Production requires the factory identity.
export {
  MEDIA_LIMITS,
  LAUNCH_FAILURE_CODES,
  type ImageDeclaration,
  type ImageFacts,
  type LaunchFailureCode,
  type LaunchResult,
} from "../../../src/features/quizpack/server/media/contracts";
import type {
  ImageDeclaration,
  LaunchResult,
} from "../../../src/features/quizpack/server/media/contracts";
export type LaunchContext = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
export type IsolatedImageLauncher = (
  bytes: Uint8Array,
  expected: ImageDeclaration,
  context: LaunchContext,
) => Promise<LaunchResult>;
