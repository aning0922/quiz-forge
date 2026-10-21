export const RECOVERY_ERROR_CODES = [
  "RECOVERY_ARGUMENTS_INVALID",
  "RECOVERY_ENVIRONMENT_UNSUPPORTED",
  "RECOVERY_SOURCE_INVALID",
  "RECOVERY_SOURCE_NOT_QUIESCENT",
  "RECOVERY_LOCK_LOST",
  "RECOVERY_FORMAT_INVALID",
  "RECOVERY_INTEGRITY_FAILED",
  "RECOVERY_CODE_MISMATCH",
  "RECOVERY_LIMIT_EXCEEDED",
  "RECOVERY_DESTINATION_EXISTS",
  "RECOVERY_STORAGE_INVALID",
  "RECOVERY_PROCESS_FAILED",
  "RECOVERY_CLOSE_UNPROVEN",
  "RECOVERY_INTERRUPTED",
  "RECOVERY_RESTORE_FAILED_PRESERVED",
  "RECOVERY_OPERATION_FAILED",
] as const;
export type RecoveryErrorCode = (typeof RECOVERY_ERROR_CODES)[number];
export class RecoveryError extends Error {
  constructor(readonly code: RecoveryErrorCode) {
    super(code);
    this.name = "RecoveryError";
  }
}
/** CLI never exposes PG stderr, connection options, paths, arbitrary error messages or stacks. */
export function safeRecoveryError(error: unknown): { code: RecoveryErrorCode } {
  return {
    code:
      error instanceof RecoveryError &&
      RECOVERY_ERROR_CODES.includes(error.code)
        ? error.code
        : "RECOVERY_OPERATION_FAILED",
  };
}
