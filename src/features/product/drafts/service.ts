import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioError } from "@/lib/http-security/errors";
import { withStudioWrite } from "@/lib/auth/write";
import { acquireReferenceWriteLock } from "../internal-versions/storage-lock";
import type { DatabaseTime } from "@/lib/auth/internal";
import { read as withStudioRead } from "@/features/quizpack/import/repository";
import { readReadyDraftSource } from "@/features/quizpack/draft-source";
import { productRow, iso } from "../workspace/repository";
import { productIdSchema } from "../workspace/contracts";
import {
  applyReadyValidationSchema,
  draftApplicationScopeSchema,
  draftApplicationFingerprint,
  draftIdSchema,
  draftIdempotencyKeySchema,
  validationStateRevisionSchema,
  draftRevisionDtoSchema,
  draftApplicationDtoSchema,
} from "./contracts";
import type { ProductDraftService } from "./service-contract";
import {
  applicationByKey,
  applicationDto,
  draftRoot,
  revisionMetadata,
  revisionBody,
  summaryDto,
  insertFirstDraft,
  auditDraftApplied,
} from "./repository";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new StudioError("INVALID_REQUEST");
  return value.data;
}
/** Real DB-only service. Confirmed transaction results are returned directly, never re-read after COMMIT. */
export function createProductDraftService(): ProductDraftService {
  return {
    async applyReadyValidation(db, credentials, scopeInput, inputValue) {
      const scope = parse(draftApplicationScopeSchema, scopeInput),
        input = parse(applyReadyValidationSchema, inputValue);
      const fingerprint = await draftApplicationFingerprint({
        productId: scope.productId,
        sourceImportId: scope.sourceImportId,
        sourceValidationId: scope.sourceValidationId,
        expectedValidationStateRevision: input.expectedValidationStateRevision,
        expectedCandidateSha256: input.expectedCandidateSha256,
        target: { kind: "new-draft" },
      });
      return withStudioWrite(
        db,
        credentials,
        "draft:write",
        async (tx, actor) => {
          const product = await productRow(tx, scope.productId, true);
          const previous = await applicationByKey(
            tx,
            scope.productId,
            input.idempotencyKey,
          );
          if (previous) {
            if (
              previous.target_kind !== "new-draft" ||
              previous.fingerprint !== fingerprint
            )
              throw new StudioError("IDEMPOTENCY_CONFLICT");
            return { created: false, application: applicationDto(previous) };
          }
          if (product.archived_at !== null)
            throw new StudioError("PRODUCT_ARCHIVED");
          await acquireReferenceWriteLock(tx);
          const source = await readReadyDraftSource(tx, scope, {
            expectedValidationStateRevision:
              input.expectedValidationStateRevision,
            expectedCandidateSha256: input.expectedCandidateSha256,
          });
          if (await draftRoot(tx, scope.productId))
            throw new StudioError("DRAFT_ALREADY_EXISTS");
          const draftId = randomUUID(),
            applicationId = randomUUID();
          const [moment] = await tx<
            { at: DatabaseTime }[]
          >`SELECT date_trunc('milliseconds',clock_timestamp())::text AS at`;
          if (!moment) throw new StudioError("STUDIO_UNAVAILABLE");
          const application = draftApplicationDtoSchema.parse({
            productId: scope.productId,
            draftId,
            revision: 1,
            applicationId,
            sourceImportId: source.sourceImportId,
            sourceValidationId: source.sourceValidationId,
            canonicalContentSha256: source.canonicalContentSha256,
            assetSetSha256: source.assetSetSha256,
            canonicalManifestSha256: source.canonicalManifestSha256,
            candidateSha256: source.candidateSha256,
            containerSchemaVersion: source.containerSchemaVersion,
            contentSchemaVersion: source.contentSchemaVersion,
            contentKind: source.contentKind,
            packId: source.packId,
            packVersion: source.packVersion,
            versions: source.versions,
            resourceCount: source.resourceCount,
            createdAt: iso(moment.at),
            createdBy: actor.id,
            platformApproval: "unverified",
            publishable: false,
            idempotencyKey: input.idempotencyKey,
            expectedValidationStateRevision:
              input.expectedValidationStateRevision,
            expectedCandidateSha256: input.expectedCandidateSha256,
            fingerprint,
            target: { kind: "new-draft" },
          });
          await insertFirstDraft(tx, {
            draftId,
            applicationId,
            source,
            input,
            fingerprint,
            actorId: actor.id,
            at: moment.at,
          });
          await auditDraftApplied(
            tx,
            actor,
            credentials,
            randomUUID(),
            draftId,
          );
          return { created: true, application };
        },
      );
    },
    async readDraft(db, sessionToken, productInput) {
      const productId = parse(productIdSchema, productInput);
      return withStudioRead(db, sessionToken, async (tx) => {
        await productRow(tx, productId);
        const root = await draftRoot(tx, productId);
        if (!root) return { kind: "empty", productId };
        const revision = await revisionMetadata(
          tx,
          productId,
          root.id,
          root.current_revision,
        );
        if (!revision) throw new StudioError("STUDIO_UNAVAILABLE");
        return { kind: "draft", draft: summaryDto(revision) };
      });
    },
    async readDraftRevision(
      db,
      sessionToken,
      productInput,
      draftInput,
      revisionInput,
    ) {
      const productId = parse(productIdSchema, productInput),
        draftId = parse(draftIdSchema, draftInput),
        revision = parse(validationStateRevisionSchema, revisionInput);
      return withStudioRead(db, sessionToken, async (tx) => {
        await productRow(tx, productId);
        const row = await revisionBody(tx, productId, draftId, revision);
        if (!row) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
        return draftRevisionDtoSchema.parse({
          draft: summaryDto(row),
          canonicalContentText: row.canonical_content_text,
          assetSetText: row.asset_set_text,
        });
      });
    },
    async readDraftApplicationByKey(db, sessionToken, productInput, keyInput) {
      const productId = parse(productIdSchema, productInput),
        key = parse(draftIdempotencyKeySchema, keyInput);
      return withStudioRead(db, sessionToken, async (tx) => {
        await productRow(tx, productId);
        const row = await applicationByKey(tx, productId, key);
        return row
          ? { kind: "applied", application: applicationDto(row) }
          : { kind: "empty", productId, idempotencyKey: key };
      });
    },
  };
}
