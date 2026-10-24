import type { ImportDto } from "@/features/quizpack/import/contracts";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import type { DraftApplicationDto } from "@/features/product/drafts/contracts";
import type { AppendDraftApplication } from "@/features/product/draft-revisions/contracts";
import { readPending } from "../validations/pending";
import { readDraftPending } from "../drafts/pending";
import { readRevisionPending } from "../draft-revisions/pending";

/** A valid historical receipt is not proof that this run's selected source completed. */
export function matchesContentCompletion(
  productId: string,
  selected: ValidationDto | undefined,
  application: DraftApplicationDto | AppendDraftApplication,
): boolean {
  return Boolean(
    selected &&
    selected.productId === productId &&
    selected.status === "ready" &&
    application.productId === productId &&
    application.sourceImportId === selected.importId &&
    application.sourceValidationId === selected.id &&
    application.expectedValidationStateRevision === selected.stateRevision &&
    selected.candidateSha256 !== null &&
    application.expectedCandidateSha256 === selected.candidateSha256 &&
    application.candidateSha256 === selected.candidateSha256 &&
    application.assetSetSha256 === selected.assetSetSha256,
  );
}

/** Only an acknowledged terminal rejection of this received source can end a run. */
export function isRejectedContentSource(
  received: ImportDto | undefined,
  rejected: ValidationDto | undefined,
): boolean {
  if (!received || received.storageCondition !== "clean") return false;
  if (received.status === "rejected") return true;
  return Boolean(
    received.status === "received" &&
    rejected &&
    rejected.productId === received.productId &&
    rejected.importId === received.id &&
    rejected.archiveSha256 === received.expectedArchiveSha256 &&
    rejected.archiveBytes === received.expectedArchiveBytes &&
    rejected.status === "rejected" &&
    rejected.storageCondition === "clean" &&
    !rejected.maintenanceRequired,
  );
}

/** Read original stores immediately before local owner disposal; never clear or rewrite them. */
export function assertNoContentPending(
  storage: Pick<Storage, "getItem" | "setItem">,
  productId: string,
): void {
  if (
    readPending(storage).some((entry) => entry.tuple.productId === productId) ||
    readDraftPending(storage).some(
      (entry) => entry.tuple.productId === productId,
    ) ||
    readRevisionPending(storage).some(
      (entry) => entry.tuple.productId === productId,
    )
  )
    throw new Error("CONTENT_PENDING_RETAINED");
}
