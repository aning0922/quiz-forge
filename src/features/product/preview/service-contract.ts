import "server-only";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import type { PreviewCredentials } from "./auth";
import type {
  PreviewEntry,
  PreviewReveal,
  PreviewScope,
  PreviewScoreRequest,
} from "./contracts";
export interface ProductPreviewService {
  entry(
    db: P2aDatabase,
    credentials: PreviewCredentials,
    scope: PreviewScope,
    budget: DatabaseBudget,
  ): Promise<PreviewEntry>;
  score(
    db: P2aDatabase,
    credentials: PreviewCredentials,
    scope: PreviewScope,
    input: PreviewScoreRequest,
    budget: DatabaseBudget,
  ): Promise<PreviewReveal>;
}
