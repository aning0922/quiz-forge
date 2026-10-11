import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type {
  CreateImportIntent,
  RecoverReceive,
  ImportDto,
  ImportListQuery,
  ImportSettingsDto,
  Page,
} from "./contracts";
export type ReceiveContext = {
  signal: AbortSignal;
  deadlineMonotonicMs: number;
};
export type ReceiveSource = {
  chunks: AsyncIterable<Uint8Array>;
  cancel: () => Promise<void>;
};
export interface ImportReceiveService {
  readImportSettings(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
  ): Promise<ImportSettingsDto>;
  createIntent(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    idempotencyKey: string,
    input: CreateImportIntent,
  ): Promise<{ import: ImportDto; created: boolean }>;
  readImport(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    importId: string,
  ): Promise<ImportDto>;
  listImports(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    query: ImportListQuery,
  ): Promise<Page<ImportDto>>;
  /** db belongs exclusively to this operation; its pool is permanently destroyed on deadline/abort. */
  receiveArchive(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    source: ReceiveSource,
    context: ReceiveContext,
  ): Promise<ImportDto>;
  /** Same dedicated DB and handler-start absolute budget requirement as receiveArchive. */
  recoverReceive(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    importId: string,
    input: RecoverReceive,
    context: ReceiveContext,
  ): Promise<ImportDto>;
}
