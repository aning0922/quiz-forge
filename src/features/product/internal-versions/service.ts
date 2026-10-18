import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import {
  requireCapability,
  type StudioCapability,
  type StudioActor,
} from "@/lib/auth/capabilities";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import { read } from "@/features/quizpack/import/repository";
import {
  readReadyDraftSourceEvidenceReadonly,
  readFrozenDraftSourceEvidenceReadonly,
  type ReadyDraftSourceEvidence,
} from "@/features/quizpack/draft-source-evidence";
import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import { productRow } from "../workspace/repository";
import {
  draftRoot,
  revisionMetadata,
  summaryDto,
  type DraftRevisionRow,
} from "../drafts/repository";
import { internalRevisionScopeSchema } from "./urls";
import {
  matchRegisteredBaseline,
  findBaselineDescriptor,
} from "./baseline-registry";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
  rendererImplementationAvailable,
  engineImplementationAvailable,
} from "./implementation-catalog";
import {
  resolveRendererServer,
  resolveEngineImplementation,
} from "./implementation-server";
import { acquireReferenceWriteLock } from "./storage-lock";
import type { InternalVersionOwner, InternalVersionWork } from "./lifecycle";
import { verifyFixedFontFiles } from "./verify-font";
import { buildInternalSnapshot } from "./snapshot";
import type { ProductInternalVersionService } from "./service-contract";
import {
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
  recordBaselineInputSchema,
  sealInternalVersionInputSchema,
  recordBaselineFingerprint,
  sealInternalVersionFingerprint,
  sameRecordBaselineBinding,
  sameSealInternalVersionBinding,
  sameRevisionTarget,
  internalCanonicalText,
  internalReviewFactsSchema,
  rendererIdentitySchema,
  engineIdentitySchema,
  recordBaselineResponseSchema,
  sealInternalVersionResponseSchema,
  internalReviewResolutionResponseSchema,
  internalVersionResolutionResponseSchema,
  internalReviewStateResponseSchema,
  internalVersionListResponseSchema,
  internalVersionDetailResponseSchema,
  INTERNAL_VERSION_LIMITS,
  type RevisionTarget,
  type InternalReviewReceipt,
  type RecordBaselineBinding,
  type SealInternalVersionBinding,
} from "./contracts";
import {
  verifyInternalReviewResolution,
  verifyInternalVersionResolution,
} from "./integrity";
import {
  reviewByKey,
  reviewById,
  reviewByTarget,
  reviewReceipt,
  reviewCount,
  versionByKey,
  versionById,
  versionBySnapshot,
  versionRows,
  versionDetail,
  versionMetadata,
  versionSlots,
  insertReview,
  insertVersion,
  auditInternalReference,
  targetFromRevision,
  type ReviewRow,
  type VersionRow,
} from "./repository";

type Tx = postgres.TransactionSql;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StudioError("INVALID_REQUEST");
  return parsed.data;
}
function server<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StudioError("STUDIO_UNAVAILABLE");
  return parsed.data;
}
function checkpoint(budget: DatabaseBudget) {
  if (
    !Number.isFinite(budget.deadlineMonotonicMs) ||
    performance.now() >= budget.deadlineMonotonicMs
  )
    throw new StudioError("PREVIEW_TIMEOUT");
  if (budget.signal.aborted) throw new StudioError("PREVIEW_CANCELLED");
}
function assertCredentials(c: StudioWriteCredentials) {
  if (!c.sessionToken) throw new StudioError("UNAUTHENTICATED");
  if (!c.csrfToken || !verifyCsrf(c.sessionToken, "session", c.csrfToken))
    throw new StudioError("CSRF_REJECTED");
  parse(z.uuid(), c.requestId);
}
function authorized<T>(
  db: P2aDatabase,
  token: string | null,
  capability: StudioCapability,
  work: (tx: Tx, actor: StudioActor) => Promise<T>,
) {
  return read(db, token, (tx, actor) => {
    requireCapability(actor, capability);
    return work(tx, actor);
  });
}
async function reauthorize(
  db: P2aDatabase,
  token: string | null,
  capability: StudioCapability = "studio:read",
) {
  await authorized(db, token, capability, async () => undefined);
}
async function revisionObservation(
  tx: Tx,
  productId: string,
  target: RevisionTarget,
) {
  const root = await draftRoot(tx, productId);
  if (!root || root.id !== target.draftId)
    throw new StudioError("DRAFT_NOT_FOUND");
  const revision = await revisionMetadata(
    tx,
    productId,
    target.draftId,
    target.revision,
  );
  if (!revision) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
  summaryDto(revision);
  if (
    !sameRevisionTarget(targetFromRevision(revision), target) ||
    root.current_revision < target.revision ||
    root.current_revision > 100
  )
    throw new StudioError("DRAFT_BASE_CONFLICT");
  return { revision, current: root.current_revision };
}
async function sourceForRevision(
  tx: Tx,
  r: DraftRevisionRow,
  historical = false,
) {
  const source = await (
    historical
      ? readFrozenDraftSourceEvidenceReadonly
      : readReadyDraftSourceEvidenceReadonly
  )(
    tx,
    {
      productId: r.product_id,
      sourceImportId: r.source_import_id,
      sourceValidationId: r.source_validation_id,
    },
    {
      expectedValidationStateRevision: r.source_validation_state_revision,
      expectedCandidateSha256: r.candidate_sha256,
    },
  );
  const d = summaryDto(r);
  if (
    source.canonicalContentSha256 !== r.canonical_content_sha256 ||
    source.assetSetSha256 !== r.asset_set_sha256 ||
    source.canonicalManifestSha256 !== r.canonical_manifest_sha256 ||
    source.resourceCount !== r.resource_count ||
    source.packId !== r.pack_id ||
    source.packVersion !== r.pack_version ||
    source.contentSchemaVersion !== r.content_schema_version ||
    source.contentKind !== r.content_kind ||
    internalCanonicalText(source.versions) !== internalCanonicalText(d.versions)
  )
    throw new StudioError("DRAFT_SOURCE_INVALID");
  return source;
}
async function fixedReview(row: ReviewRow, binding: RecordBaselineBinding) {
  const receipt = await reviewReceipt(row);
  if (!sameRecordBaselineBinding(receipt.binding, binding))
    throw new StudioError("IDEMPOTENCY_CONFLICT");
  return receipt;
}
async function fixedVersion(
  row: VersionRow,
  binding: SealInternalVersionBinding,
) {
  const detail = await versionDetail(row);
  if (!sameSealInternalVersionBinding(detail.version.binding, binding))
    throw new StudioError("IDEMPOTENCY_CONFLICT");
  return detail.version;
}
async function reviewForSeal(
  tx: Tx,
  b: SealInternalVersionBinding,
): Promise<InternalReviewReceipt> {
  const row = await reviewById(tx, b.productId, b.reviewId);
  if (!row) throw new StudioError("REVIEW_NOT_FOUND");
  const r = await reviewReceipt(row);
  if (
    r.reviewSha256 !== b.reviewSha256 ||
    !sameRevisionTarget(r.binding.target, b.target)
  )
    throw new StudioError("REVIEW_BASELINE_MISMATCH");
  return r;
}
function registered(source: ReadyDraftSourceEvidence, db: P2aDatabase) {
  const b = matchRegisteredBaseline(source, db.config.purpose);
  if (!b) throw new StudioError("REVIEW_BASELINE_MISMATCH");
  return b;
}
async function verifyExecution(
  binding: SealInternalVersionBinding,
  source: ReadyDraftSourceEvidence,
  review: InternalReviewReceipt,
  context: InternalVersionWork,
  config: P2aDatabase["config"],
) {
  const renderer = resolveRendererServer(binding.renderer),
    engine = resolveEngineImplementation(binding.engine),
    baseline = findBaselineDescriptor(review.facts.baseline);
  if (!renderer || !engine || !baseline)
    throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  context.checkpoint();
  const prepared = engine.prepare(JSON.parse(source.canonicalContentText));
  if (!prepared.ok) throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  context.checkpoint();
  const witnesses = engine.witnesses(prepared.value);
  context.checkpoint();
  if (
    !witnesses.ok ||
    witnesses.value.sourceBinding.canonicalContentSha256 !==
      source.canonicalContentSha256 ||
    witnesses.value.evidence.status !== "passed" ||
    witnesses.value.evidence.logicHash !== baseline.descriptor.logicHash
  )
    throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
  await verifyFixedFontFiles(
    renderer.descriptor.font,
    renderer.descriptor.closure.files,
    context,
  );
  const blobs = new Map(source.resources.map((r) => [r.sha256, r]));
  if (
    source.resources.length > INTERNAL_VERSION_LIMITS.resources ||
    blobs.size > INTERNAL_VERSION_LIMITS.resources ||
    [...blobs.values()].reduce((sum, r) => sum + r.bytes, 0) >
      INTERNAL_VERSION_LIMITS.resourceBytes
  )
    throw new StudioError("VERSION_RESOURCE_UNAVAILABLE");
  for (const [, resource] of [...blobs.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    context.checkpoint();
    await context.checkGuard();
    // Discard each verified buffer immediately. Every FD closes before advancing or entering the write TX.
    await readPrivateResource(
      config,
      resource,
      context.checkpoint,
      context.timeout,
      context.quarantine,
    );
    context.checkpoint();
    await context.checkGuard();
  }
}

/** One per-request service, with an explicit owner. No ambient connection, registration or hidden deadline. */
export function createProductInternalVersionService(
  owner: InternalVersionOwner,
): ProductInternalVersionService {
  return {
    async recordBaseline(db, credentials, scopeInput, inputValue, budget) {
      owner.assertOwns(db, budget);
      assertCredentials(credentials);
      checkpoint(budget);
      const scope = parse(internalRevisionScopeSchema, scopeInput),
        input = parse(recordBaselineInputSchema, inputValue),
        binding = parse(recordBaselineBindingSchema, {
          productId: scope.productId,
          ...input,
        });
      if (
        scope.draftId !== binding.target.draftId ||
        scope.revision !== binding.target.revision
      )
        throw new StudioError("INVALID_REQUEST");
      const previous = await authorized(
        db,
        credentials.sessionToken,
        "review:record-baseline",
        async (tx) => {
          await productRow(tx, binding.productId);
          const old = await reviewByKey(
            tx,
            binding.productId,
            binding.idempotencyKey,
          );
          return old ? fixedReview(old, binding) : null;
        },
      );
      checkpoint(budget);
      if (previous) {
        await reauthorize(
          db,
          credentials.sessionToken,
          "review:record-baseline",
        );
        checkpoint(budget);
        return server(recordBaselineResponseSchema, {
          ok: true,
          value: { created: false, review: previous },
        }).value;
      }
      return owner.runNew(db, budget, async (context) => {
        const source = await authorized(
          db,
          credentials.sessionToken,
          "review:record-baseline",
          async (tx) => {
            const p = await productRow(tx, binding.productId);
            const o = await revisionObservation(
              tx,
              binding.productId,
              binding.target,
            );
            if (p.archived_at !== null)
              throw new StudioError("PRODUCT_ARCHIVED");
            if (o.current !== binding.target.revision)
              throw new StudioError("DRAFT_BASE_CONFLICT");
            return sourceForRevision(tx, o.revision);
          },
        );
        context.checkpoint();
        const baseline = registered(source, db);
        if (
          internalCanonicalText(baseline.identity) !==
          internalCanonicalText(binding.baseline)
        )
          throw new StudioError("REVIEW_BASELINE_MISMATCH");
        const facts = server(internalReviewFactsSchema, {
          schemaVersion: "quizforge.internal-review-facts.v1",
          productId: binding.productId,
          target: binding.target,
          baseline: baseline.identity,
          purpose: "internal-test",
          approval: baseline.descriptor.approval,
        });
        await context.checkGuard();
        return context.write(
          credentials,
          "review:record-baseline",
          async (tx, actor) => {
            await acquireReferenceWriteLock(tx);
            await context.checkGuard();
            const p = await productRow(tx, binding.productId, true);
            const old = await reviewByKey(
              tx,
              binding.productId,
              binding.idempotencyKey,
            );
            if (old)
              return server(recordBaselineResponseSchema, {
                ok: true,
                value: {
                  created: false,
                  review: await fixedReview(old, binding),
                },
              }).value;
            if (p.archived_at !== null)
              throw new StudioError("PRODUCT_ARCHIVED");
            const o = await revisionObservation(
              tx,
              binding.productId,
              binding.target,
            );
            if (o.current !== binding.target.revision)
              throw new StudioError("DRAFT_BASE_CONFLICT");
            const current = await sourceForRevision(tx, o.revision);
            if (
              internalCanonicalText(registered(current, db).identity) !==
              internalCanonicalText(binding.baseline)
            )
              throw new StudioError("REVIEW_BASELINE_MISMATCH");
            if (await reviewByTarget(tx, binding.productId, binding.target))
              throw new StudioError("REVIEW_ALREADY_RECORDED");
            if ((await reviewCount(tx, binding.productId)) >= 100)
              throw new StudioError("REVIEW_LIMIT");
            context.checkpoint();
            const review = await insertReview(
              tx,
              binding,
              facts,
              current,
              actor,
            );
            await auditInternalReference(
              tx,
              actor,
              credentials,
              "review",
              review.id,
              binding.target.revision,
            );
            await context.checkGuard();
            return server(recordBaselineResponseSchema, {
              ok: true,
              value: { created: true, review },
            }).value;
          },
        );
      });
    },
    async sealInternalVersion(
      db,
      credentials,
      productInput,
      inputValue,
      budget,
    ) {
      owner.assertOwns(db, budget);
      assertCredentials(credentials);
      checkpoint(budget);
      const productId = parse(
          internalRevisionScopeSchema.shape.productId,
          productInput,
        ),
        input = parse(sealInternalVersionInputSchema, inputValue),
        binding = parse(sealInternalVersionBindingSchema, {
          productId,
          ...input,
        });
      const previous = await authorized(
        db,
        credentials.sessionToken,
        "version:seal-internal",
        async (tx) => {
          await productRow(tx, productId);
          const old = await versionByKey(tx, productId, binding.idempotencyKey);
          return old ? fixedVersion(old, binding) : null;
        },
      );
      checkpoint(budget);
      if (previous) {
        await reauthorize(
          db,
          credentials.sessionToken,
          "version:seal-internal",
        );
        checkpoint(budget);
        return server(sealInternalVersionResponseSchema, {
          ok: true,
          value: { created: false, version: previous },
        }).value;
      }
      return owner.runNew(db, budget, async (context) => {
        const { source, review } = await authorized(
          db,
          credentials.sessionToken,
          "version:seal-internal",
          async (tx) => {
            const p = await productRow(tx, productId);
            const o = await revisionObservation(tx, productId, binding.target);
            if (p.archived_at !== null)
              throw new StudioError("PRODUCT_ARCHIVED");
            if (o.current !== binding.target.revision)
              throw new StudioError("DRAFT_BASE_CONFLICT");
            return {
              source: await sourceForRevision(tx, o.revision),
              review: await reviewForSeal(tx, binding),
            };
          },
        );
        if (
          internalCanonicalText(registered(source, db).identity) !==
          internalCanonicalText(review.facts.baseline)
        )
          throw new StudioError("REVIEW_BASELINE_MISMATCH");
        const snapshot = buildInternalSnapshot(binding, review, source);
        await verifyExecution(binding, source, review, context, db.config);
        await context.checkGuard();
        return context.write(
          credentials,
          "version:seal-internal",
          async (tx, actor) => {
            await acquireReferenceWriteLock(tx);
            await context.checkGuard();
            const p = await productRow(tx, productId, true);
            const old = await versionByKey(
              tx,
              productId,
              binding.idempotencyKey,
            );
            if (old)
              return server(sealInternalVersionResponseSchema, {
                ok: true,
                value: {
                  created: false,
                  version: await fixedVersion(old, binding),
                },
              }).value;
            if (p.archived_at !== null)
              throw new StudioError("PRODUCT_ARCHIVED");
            const o = await revisionObservation(tx, productId, binding.target);
            if (o.current !== binding.target.revision)
              throw new StudioError("DRAFT_BASE_CONFLICT");
            const actualSource = await sourceForRevision(tx, o.revision),
              actualReview = await reviewForSeal(tx, binding);
            if (
              internalCanonicalText(registered(actualSource, db).identity) !==
                internalCanonicalText(actualReview.facts.baseline) ||
              buildInternalSnapshot(binding, actualReview, actualSource)
                .text !== snapshot.text
            )
              throw new StudioError("REVIEW_BASELINE_MISMATCH");
            if (
              !resolveRendererServer(binding.renderer) ||
              !resolveEngineImplementation(binding.engine)
            )
              throw new StudioError("VERSION_DEPENDENCY_UNAVAILABLE");
            if (await versionBySnapshot(tx, productId, snapshot.sha256))
              throw new StudioError("VERSION_ALREADY_SEALED");
            const slots = await versionSlots(tx, productId);
            if (slots.length >= 100) throw new StudioError("VERSION_LIMIT");
            const slot = Array.from({ length: 100 }, (_, i) => i + 1).find(
              (s) => !slots.includes(s),
            );
            if (!slot) throw new StudioError("VERSION_LIMIT");
            context.checkpoint();
            const version = await insertVersion(
              tx,
              binding,
              snapshot.snapshot,
              slot,
              actor,
            );
            await auditInternalReference(
              tx,
              actor,
              credentials,
              "version",
              version.id,
              binding.target.revision,
            );
            await context.checkGuard();
            return server(sealInternalVersionResponseSchema, {
              ok: true,
              value: { created: true, version },
            }).value;
          },
        );
      });
    },
    async resolveReview(db, sessionToken, input) {
      const binding = parse(recordBaselineBindingSchema, input),
        fingerprint = await recordBaselineFingerprint(binding);
      const result = await authorized(
        db,
        sessionToken,
        "studio:read",
        async (tx) => {
          await productRow(tx, binding.productId);
          const old = await reviewByKey(
            tx,
            binding.productId,
            binding.idempotencyKey,
          );
          if (old)
            return verifyInternalReviewResolution({
              kind: "recorded",
              binding,
              fingerprint,
              review: await fixedReview(old, binding),
            });
          const o = await revisionObservation(
              tx,
              binding.productId,
              binding.target,
            ),
            observation = {
              binding,
              fingerprint,
              observedCurrentRevision: o.current,
            };
          if (o.current > binding.target.revision)
            return verifyInternalReviewResolution({
              kind: "not-recorded-obsolete",
              ...observation,
            });
          const consumed = await reviewByTarget(
            tx,
            binding.productId,
            binding.target,
          );
          return verifyInternalReviewResolution(
            consumed
              ? {
                  kind: "not-recorded-target-used",
                  ...observation,
                  consumed: await reviewReceipt(consumed),
                }
              : { kind: "unresolved", ...observation },
          );
        },
      );
      await reauthorize(db, sessionToken);
      return server(internalReviewResolutionResponseSchema, {
        ok: true,
        value: result,
      }).value;
    },
    async resolveVersion(db, sessionToken, input) {
      const binding = parse(sealInternalVersionBindingSchema, input),
        fingerprint = await sealInternalVersionFingerprint(binding);
      const result = await authorized(
        db,
        sessionToken,
        "studio:read",
        async (tx) => {
          await productRow(tx, binding.productId);
          const old = await versionByKey(
            tx,
            binding.productId,
            binding.idempotencyKey,
          );
          if (old)
            return verifyInternalVersionResolution({
              kind: "sealed",
              binding,
              fingerprint,
              version: await fixedVersion(old, binding),
            });
          const o = await revisionObservation(
              tx,
              binding.productId,
              binding.target,
            ),
            observation = {
              binding,
              fingerprint,
              observedCurrentRevision: o.current,
            };
          if (o.current > binding.target.revision)
            return verifyInternalVersionResolution({
              kind: "not-sealed-obsolete",
              ...observation,
            });
          const slots = await versionSlots(tx, binding.productId);
          let snapshot: ReturnType<typeof buildInternalSnapshot> | undefined;
          try {
            snapshot = buildInternalSnapshot(
              binding,
              await reviewForSeal(tx, binding),
              await sourceForRevision(tx, o.revision, true),
            );
          } catch (error) {
            if (
              !(error instanceof StudioError) ||
              ![
                "REVIEW_NOT_FOUND",
                "REVIEW_BASELINE_MISMATCH",
                "DRAFT_SOURCE_INVALID",
                "DRAFT_SOURCE_CHANGED",
                "VERSION_DEPENDENCY_UNAVAILABLE",
              ].includes(error.code)
            )
              throw error;
          }
          if (snapshot) {
            const consumed = await versionBySnapshot(
              tx,
              binding.productId,
              snapshot.sha256,
            );
            if (consumed)
              return verifyInternalVersionResolution({
                kind: "not-sealed-target-used",
                ...observation,
                snapshotSha256: snapshot.sha256,
                consumed: (await versionDetail(consumed)).version,
              });
          }
          return verifyInternalVersionResolution(
            slots.length === 100
              ? {
                  kind: "not-sealed-capacity-exhausted",
                  ...observation,
                  limit: 100,
                  occupiedCount: 100,
                }
              : { kind: "unresolved", ...observation },
          );
        },
      );
      await reauthorize(db, sessionToken);
      return server(internalVersionResolutionResponseSchema, {
        ok: true,
        value: result,
      }).value;
    },
    async readReviewState(db, sessionToken, scopeInput) {
      const scope = parse(internalRevisionScopeSchema, scopeInput);
      const value = await authorized(
        db,
        sessionToken,
        "studio:read",
        async (tx) => {
          await productRow(tx, scope.productId);
          const r = await revisionMetadata(
            tx,
            scope.productId,
            scope.draftId,
            scope.revision,
          );
          if (!r) throw new StudioError("DRAFT_REVISION_NOT_FOUND");
          const target = targetFromRevision(r),
            o = await revisionObservation(tx, scope.productId, target);
          const stored = await reviewByTarget(tx, scope.productId, target),
            source = await sourceForRevision(tx, o.revision, true),
            baseline = matchRegisteredBaseline(source, db.config.purpose);
          const engine = baseline
            ? (IMPLEMENTATION_DESCRIPTORS.engines
                .map((e) =>
                  engineIdentitySchema.parse(implementationIdentity(e)),
                )
                .find(
                  (e) =>
                    e.id === source.versions.engine.id &&
                    e.version === source.versions.engine.version &&
                    engineImplementationAvailable(e),
                ) ?? null)
            : null;
          const rendererChoices = baseline
            ? IMPLEMENTATION_DESCRIPTORS.renderers
                .filter(
                  (r) =>
                    internalCanonicalText(r.descriptor.components) ===
                    internalCanonicalText(baseline.descriptor.components),
                )
                .map((r) => ({
                  renderer: rendererIdentitySchema.parse(
                    implementationIdentity(r),
                  ),
                  capability: r.descriptor.capability,
                }))
                .filter((r) => rendererImplementationAvailable(r.renderer))
            : [];
          return {
            productId: scope.productId,
            target,
            observedCurrentRevision: o.current,
            review: stored ? await reviewReceipt(stored) : null,
            baseline: baseline?.identity ?? null,
            rendererChoices,
            engine,
          };
        },
      );
      await reauthorize(db, sessionToken);
      return server(internalReviewStateResponseSchema, { ok: true, value })
        .value;
    },
    async readVersions(db, sessionToken, productInput) {
      const productId = parse(
        internalRevisionScopeSchema.shape.productId,
        productInput,
      );
      const value = await authorized(
        db,
        sessionToken,
        "studio:read",
        async (tx) => {
          await productRow(tx, productId);
          const rows = await versionRows(tx, productId);
          if (rows.length > 100) throw new StudioError("STUDIO_UNAVAILABLE");
          return {
            productId,
            versions: await Promise.all(rows.map(versionMetadata)),
          };
        },
      );
      await reauthorize(db, sessionToken);
      return server(internalVersionListResponseSchema, { ok: true, value })
        .value;
    },
    async readVersion(db, sessionToken, productInput, idInput) {
      const productId = parse(
          internalRevisionScopeSchema.shape.productId,
          productInput,
        ),
        id = parse(z.uuid(), idInput);
      const value = await authorized(
        db,
        sessionToken,
        "studio:read",
        async (tx) => {
          await productRow(tx, productId);
          const row = await versionById(tx, productId, id);
          if (!row) throw new StudioError("VERSION_NOT_FOUND");
          return versionDetail(row);
        },
      );
      await reauthorize(db, sessionToken);
      return server(internalVersionDetailResponseSchema, { ok: true, value })
        .value;
    },
  };
}
