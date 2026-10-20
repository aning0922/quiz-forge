import "server-only";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type { InternalRevisionScope } from "./urls";
import type {
  RecordBaselineInput,
  SealInternalVersionInput,
  RecordBaselineBinding,
  SealInternalVersionBinding,
  InternalReviewReceipt,
  InternalVersionReceipt,
  InternalReviewResolution,
  InternalVersionResolution,
  InternalReviewState,
  InternalVersionList,
  InternalVersionDetail,
} from "./contracts";
/** Server-only application service. All scope and operation bindings are re-parsed here. */
export interface ProductInternalVersionService {
  recordBaseline(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    scope: InternalRevisionScope,
    input: RecordBaselineInput,
    budget: DatabaseBudget,
  ): Promise<{ created: boolean; review: InternalReviewReceipt }>;
  sealInternalVersion(
    db: P2aDatabase,
    credentials: StudioWriteCredentials,
    productId: string,
    input: SealInternalVersionInput,
    budget: DatabaseBudget,
  ): Promise<{ created: boolean; version: InternalVersionReceipt }>;
  /** Single RR READ ONLY business observation, followed by fresh current authorization. */
  resolveReview(
    db: P2aDatabase,
    sessionToken: string | null,
    binding: RecordBaselineBinding,
  ): Promise<InternalReviewResolution>;
  resolveVersion(
    db: P2aDatabase,
    sessionToken: string | null,
    binding: SealInternalVersionBinding,
  ): Promise<InternalVersionResolution>;
  readReviewState(
    db: P2aDatabase,
    sessionToken: string | null,
    scope: InternalRevisionScope,
  ): Promise<InternalReviewState>;
  readVersions(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
  ): Promise<InternalVersionList>;
  readVersion(
    db: P2aDatabase,
    sessionToken: string | null,
    productId: string,
    versionId: string,
  ): Promise<InternalVersionDetail>;
}
