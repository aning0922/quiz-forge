/** Frozen B2-1 limits; no configuration or HTTP overrides. */
export const MAX_ARCHIVE_BYTES = 33_554_432;
export const RECEIVE_TIMEOUT_MS = 60_000;
export const LEASE_MS = 120_000;
export const MAX_ATTEMPTS = 3;
export const MAX_PENDING_INTENTS = 20;
export const UPLOAD_QUOTA_BYTES = 536_870_912;
export const MAX_IMPORT_DIRECTORIES = 1024;
export const MAX_FILES_PER_IMPORT = 16;
export const MAX_SCAN_ENTRIES = 8192;
export const SCAN_TIMEOUT_MS = 5000;
export const MAX_RECEIPT_BYTES = 2048;
export const MAX_REVISION = 2_147_483_647;
export const STORAGE_LOCK = [72461, 2] as const;
export const attemptReservation = (bytes: number) => 2 * bytes + 65_536;
