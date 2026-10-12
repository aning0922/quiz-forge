import type { MediaRuntimeRoots } from "../../../src/features/quizpack/server/media/internal/runtime-location";
import type {
  CommandOptions,
  CommandResult,
} from "../../../src/features/quizpack/server/media/internal/linux/command";
export const ROOT: string;
export const DIR: string;
export const CORE_DIR: string;
export const CACHE: string;
export const STATE: string;
export const RUNTIME_TARGET: "main" | "fixture" | null;
export const RUNTIME_ROOTS: MediaRuntimeRoots;
export { command } from "../../../src/features/quizpack/server/media/internal/linux/command";
export const hash: (bytes: Uint8Array | string) => string;
export const privateDir: (path: string) => Promise<void>;
export const writePrivate: (
  path: string,
  bytes: Uint8Array | string,
) => Promise<void>;
export const readPrivate: (path: string, maximum?: number) => Promise<Buffer>;
export function setHarnessEndpoint(endpoint: string | null): void;
export function docker(
  args: readonly string[],
  options?: CommandOptions,
): Promise<CommandResult>;
export function json(bytes: Uint8Array): unknown;
export function safeMain(
  operation: () => Promise<unknown>,
  stage?: () => string | null,
): void;
