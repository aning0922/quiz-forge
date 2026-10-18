import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type { DraftApplicationScope } from "../drafts/contracts";
import type {
  AppendDraftBinding,
  AppendReadyValidation,
  AppendDraftResult,
  DraftRevisionResolution,
  DraftRevisionHistoryQuery,
  DraftRevisionHistory,
} from "./contracts";

/** New operations, separate from the frozen first-draft protocol. */
export interface ProductDraftRevisionService {
  appendReadyValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: DraftApplicationScope,
    input: AppendReadyValidation,
  ): Promise<AppendDraftResult>;
  /** One RR business snapshot; final current read authorization before success. No session/audit writes. */
  resolveApplication(
    db: P2aDatabase,
    sessionToken: string | null,
    binding: AppendDraftBinding,
  ): Promise<DraftRevisionResolution>;
  readHistory(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    draftId: string,
    query: DraftRevisionHistoryQuery,
  ): Promise<DraftRevisionHistory>;
}
