import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { StudioError } from "@/lib/http-security/errors";
import { withStudioWrite } from "@/lib/auth/write";
import { acquireReferenceWriteLock } from "../internal-versions/storage-lock";
import type { DatabaseTime } from "@/lib/auth/internal";
import { read } from "@/features/quizpack/import/repository";
import {
  readReadyDraftSource,
  readReadyDraftSourceReadonly,
} from "@/features/quizpack/draft-source";
import { productRow } from "../workspace/repository";
import { productIdSchema } from "../workspace/contracts";
import {
  draftApplicationScopeSchema,
  draftIdSchema,
} from "../drafts/contracts";
import { draftRoot, revisionMetadata, summaryDto } from "../drafts/repository";
import {
  appendDraftBindingSchema,
  appendReadyValidationSchema,
  appendDraftFingerprint,
  fingerprintInputFromAppendBinding,
  appendDraftResultSchema,
  draftRevisionResolutionSchema,
  draftRevisionHistoryQuerySchema,
  draftRevisionHistorySchema,
  sameAppendDraftBinding,
  appendBindingFromApplication,
  type AppendDraftBinding,
} from "./contracts";
import type { ProductDraftRevisionService } from "./service-contract";
import {
  applicationByKey,
  appendApplicationDto,
  consumedSource,
  consumedManifest,
  insertAppend,
  advanceCurrent,
  historyMetadata,
} from "./repository";
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new StudioError("INVALID_REQUEST");
  return r.data;
}
/** Reads exact base facts only. It never authorizes a replacement request. */
async function baseObservation(
  tx: Parameters<typeof draftRoot>[0],
  binding: AppendDraftBinding,
) {
  const root = await draftRoot(tx, binding.productId);
  if (!root) throw new StudioError("DRAFT_NOT_FOUND");
  if (root.id !== binding.target.draftId)
    throw new StudioError("DRAFT_BASE_CONFLICT");
  const base = await revisionMetadata(
    tx,
    binding.productId,
    root.id,
    binding.target.expectedRevision,
  );
  if (!base) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
  if (
    base.canonical_content_sha256 !==
      binding.target.expectedCanonicalContentSha256 ||
    base.asset_set_sha256 !== binding.target.expectedAssetSetSha256 ||
    root.current_revision < binding.target.expectedRevision ||
    root.current_revision > 100
  )
    throw new StudioError("DRAFT_BASE_CONFLICT");
  return {
    base: summaryDto(base),
    observedCurrentRevision: root.current_revision,
  };
}
export function createProductDraftRevisionService(): ProductDraftRevisionService {
  return {
    async appendReadyValidation(db, credentials, scopeInput, inputValue) {
      const scope = parse(draftApplicationScopeSchema, scopeInput),
        input = parse(appendReadyValidationSchema, inputValue),
        binding = parse(appendDraftBindingSchema, { ...scope, ...input });
      const fingerprint = await appendDraftFingerprint(
        fingerprintInputFromAppendBinding(binding),
      );
      return withStudioWrite(
        db,
        credentials,
        "draft:write",
        async (tx, actor) => {
          const product = await productRow(tx, scope.productId, true),
            previous = await applicationByKey(
              tx,
              scope.productId,
              input.idempotencyKey,
            );
          if (previous) {
            if (
              previous.target_kind !== "append-revision" ||
              previous.fingerprint !== fingerprint
            )
              throw new StudioError("IDEMPOTENCY_CONFLICT");
            const application = await appendApplicationDto(tx, previous);
            if (
              !sameAppendDraftBinding(
                binding,
                appendBindingFromApplication(application),
              )
            )
              throw new StudioError("IDEMPOTENCY_CONFLICT");
            return appendDraftResultSchema.parse({
              created: false,
              application,
            });
          }
          if (product.archived_at !== null)
            throw new StudioError("PRODUCT_ARCHIVED");
          const observation = await baseObservation(tx, binding);
          if (
            observation.observedCurrentRevision !==
            input.target.expectedRevision
          )
            throw new StudioError("DRAFT_BASE_CONFLICT");
          if (observation.observedCurrentRevision >= 100)
            throw new StudioError("DRAFT_REVISION_LIMIT");
          await acquireReferenceWriteLock(tx);
          const source = await readReadyDraftSource(tx, scope, {
            expectedValidationStateRevision:
              input.expectedValidationStateRevision,
            expectedCandidateSha256: input.expectedCandidateSha256,
          });
          if (
            (await consumedSource(tx, scope.productId, scope.sourceImportId)) ||
            (await consumedManifest(
              tx,
              scope.productId,
              source.canonicalManifestSha256,
            ))
          )
            throw new StudioError("DRAFT_SOURCE_ALREADY_APPLIED");
          const applicationId = randomUUID();
          const [moment] = await tx<
            { at: DatabaseTime }[]
          >`SELECT date_trunc('milliseconds',clock_timestamp())::text AS at`;
          if (!moment) throw new StudioError("STUDIO_UNAVAILABLE");
          await insertAppend(tx, {
            source,
            input,
            applicationId,
            fingerprint,
            actorId: actor.id,
            at: moment.at,
          });
          await advanceCurrent(
            tx,
            scope.productId,
            input.target.draftId,
            input.target.expectedRevision,
          );
          await tx`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${randomUUID()},clock_timestamp(),'draft_applied','success',${actor.id},${actor.sessionId},${credentials.requestId},'draft',${input.target.draftId},${input.target.expectedRevision + 1})`;
          const stored = await applicationByKey(
            tx,
            scope.productId,
            input.idempotencyKey,
          );
          if (!stored) throw new StudioError("STUDIO_UNAVAILABLE");
          return appendDraftResultSchema.parse({
            created: true,
            application: await appendApplicationDto(tx, stored),
          });
        },
      );
    },
    async resolveApplication(db, sessionToken, bindingInput) {
      const binding = parse(appendDraftBindingSchema, bindingInput),
        fingerprint = await appendDraftFingerprint(
          fingerprintInputFromAppendBinding(binding),
        );
      const result = await read(db, sessionToken, async (tx) => {
        await productRow(tx, binding.productId);
        const previous = await applicationByKey(
          tx,
          binding.productId,
          binding.idempotencyKey,
        );
        if (previous) {
          if (
            previous.target_kind !== "append-revision" ||
            previous.fingerprint !== fingerprint
          )
            throw new StudioError("IDEMPOTENCY_CONFLICT");
          return draftRevisionResolutionSchema.parse({
            kind: "applied",
            binding,
            fingerprint,
            application: await appendApplicationDto(tx, previous),
          });
        }
        const observation = await baseObservation(tx, binding),
          common = { binding, fingerprint, ...observation };
        if (
          observation.observedCurrentRevision > binding.target.expectedRevision
        )
          return draftRevisionResolutionSchema.parse({
            kind: "not-applied-obsolete",
            ...common,
          });
        const consumed = await consumedSource(
          tx,
          binding.productId,
          binding.sourceImportId,
        );
        if (consumed) {
          const row = await revisionMetadata(
            tx,
            binding.productId,
            consumed.draft_id,
            consumed.revision,
          );
          if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
          return draftRevisionResolutionSchema.parse({
            kind: "not-applied-source-used",
            ...common,
            proof: {
              reason: "source-import",
              consumed: summaryDto(row),
              consumingIdempotencyKey: consumed.idempotency_key,
            },
          });
        }
        const source = await readReadyDraftSourceReadonly(
          tx,
          {
            productId: binding.productId,
            sourceImportId: binding.sourceImportId,
            sourceValidationId: binding.sourceValidationId,
          },
          {
            expectedValidationStateRevision:
              binding.expectedValidationStateRevision,
            expectedCandidateSha256: binding.expectedCandidateSha256,
          },
        );
        const manifest = await consumedManifest(
          tx,
          binding.productId,
          source.canonicalManifestSha256,
        );
        if (manifest) {
          const row = await revisionMetadata(
            tx,
            binding.productId,
            manifest.draft_id,
            manifest.revision,
          );
          if (!row) throw new StudioError("STUDIO_UNAVAILABLE");
          return draftRevisionResolutionSchema.parse({
            kind: "not-applied-source-used",
            ...common,
            proof: {
              reason: "canonical-manifest",
              consumed: summaryDto(row),
              consumingIdempotencyKey: manifest.idempotency_key,
              canonicalManifestSha256: source.canonicalManifestSha256,
            },
          });
        }
        return draftRevisionResolutionSchema.parse({
          kind: "unresolved",
          ...common,
        });
      });
      await read(db, sessionToken, async () => undefined);
      return result;
    },
    async readHistory(db, sessionToken, productInput, draftInput, queryInput) {
      const productId = parse(productIdSchema, productInput),
        draftId = parse(draftIdSchema, draftInput),
        query = parse(draftRevisionHistoryQuerySchema, queryInput);
      const result = await read(db, sessionToken, async (tx) => {
        await productRow(tx, productId);
        const root = await draftRoot(tx, productId);
        if (!root || root.id !== draftId)
          throw new StudioError("DRAFT_NOT_FOUND");
        const anchor = query.anchorRevision ?? root.current_revision;
        if (
          anchor > root.current_revision ||
          !(await revisionMetadata(tx, productId, draftId, anchor))
        )
          throw new StudioError("DRAFT_REVISION_NOT_FOUND");
        const before = query.beforeRevision ?? anchor + 1,
          items = await historyMetadata(
            tx,
            productId,
            draftId,
            anchor,
            before,
            query.pageSize,
          ),
          last = items.at(-1)?.revision;
        return draftRevisionHistorySchema.parse({
          productId,
          draftId,
          anchorRevision: anchor,
          beforeRevision: before,
          pageSize: query.pageSize,
          items,
          nextBeforeRevision: last !== undefined && last > 1 ? last : null,
        });
      });
      await read(db, sessionToken, async () => undefined);
      return result;
    },
  };
}
