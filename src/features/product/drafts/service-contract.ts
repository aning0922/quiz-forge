import "server-only";
import type { P2aDatabase } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type {
  ApplyDraftResult,
  ApplyReadyValidation,
  DraftApplicationReadResult,
  DraftApplicationScope,
  DraftReadResult,
  DraftRevisionDto,
} from "./contracts";

/** HTTP supplies one exclusive DatabaseBudget-bound DB; no media context or new execution budget. */
export interface ProductDraftService {
  applyReadyValidation(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: DraftApplicationScope,
    input: ApplyReadyValidation,
  ): Promise<ApplyDraftResult>;
  readDraft(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
  ): Promise<DraftReadResult>;
  readDraftRevision(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    draftId: string,
    revision: number,
  ): Promise<DraftRevisionDto>;
  readDraftApplicationByKey(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    idempotencyKey: string,
  ): Promise<DraftApplicationReadResult>;
}
