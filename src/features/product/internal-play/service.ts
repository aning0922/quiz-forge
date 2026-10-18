import "server-only";
import {
  consumerIdSchema,
  consumerUuidSchema,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_PROTOCOLS_V1 } from "@/lib/consumer-contract/v1/identities";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { appendConsumerOperatorAudit } from "@/lib/auth/consumer-audit";
import { readConsumerFixedSource } from "@/features/quizpack/consumer-fixed-source";
import type { ConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import type { InternalPlayService } from "@/features/fulfillment/consumer-flow/service-contract";
import {
  consumerServiceCall,
  operatorRead,
  operatorWrite,
  parseConsumer,
  consumerReferenceShare,
  assertOperatorWriteCredentials,
} from "@/features/fulfillment/consumer-flow/transaction";
import {
  fixedConsumerExecution,
  verifyConsumerExecutionIo,
} from "@/features/fulfillment/consumer-flow/fixed-execution";
import {
  createInternalPlayResultSchema,
  verifyInternalPlayResolution,
} from "@/features/fulfillment/consumer-flow/operator-resolutions";
import {
  createInternalPlayBindingSchema,
  internalPlayBindingSha256,
  internalPlaySnapshotSchema,
  internalPlayListSchema,
} from "./contracts";
import { resolveConsumerImplementation } from "./implementation-server";
import {
  lockConsumerProduct,
  readConsumerProduct,
  readConsumerParent,
  assertConsumerParentSource,
  findInternalPlayOperation,
  readInternalPlayById,
  listInternalPlayFacts,
  insertInternalPlay,
} from "./repository";
const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.playSnapshotBytes);
export function createInternalPlayService(
  owner: ConsumerRequestOwner,
): InternalPlayService {
  return Object.freeze<InternalPlayService>({
    create(credentials, productInput, bindingInput) {
      return consumerServiceCall(
        owner,
        "create-play",
        async (c, observation) => {
          assertOperatorWriteCredentials(credentials);
          const productId = parseConsumer(consumerIdSchema, productInput),
            binding = parseConsumer(
              createInternalPlayBindingSchema,
              bindingInput,
            );
          if (binding.parent.productId !== productId)
            throw new ConsumerError("INVALID_REQUEST");
          const prior = await c.sql((db, check) =>
            operatorRead(
              db,
              credentials.sessionToken,
              check,
              async (tx) => {
                await readConsumerProduct(tx, productId);
                const old = await findInternalPlayOperation(
                  tx,
                  productId,
                  binding.operationKey,
                );
                if (old) {
                  if (!same(old.play.binding, binding))
                    throw new ConsumerError("OPERATION_CONFLICT");
                  return old.play;
                }
                const product = await readConsumerProduct(tx, productId);
                if (product.archivedAt !== null)
                  throw new ConsumerError("PRODUCT_ARCHIVED");
                const parent = await readConsumerParent(tx, binding.parent);
                await assertConsumerParentSource(tx, parent, true);
                const source = await readConsumerFixedSource(
                  tx,
                  parent.snapshot,
                );
                fixedConsumerExecution(
                  parent.snapshot,
                  binding.renderer,
                  source,
                );
                return null;
              },
              "version:seal-internal",
            ),
          );
          if (prior)
            return createInternalPlayResultSchema.parse({
              created: false,
              play: prior,
            });
          return c.io(async (io) => {
            const checked = await operatorRead(
              io.db,
              credentials.sessionToken,
              io.checkpoint,
              async (tx) => {
                const old = await findInternalPlayOperation(
                  tx,
                  productId,
                  binding.operationKey,
                );
                if (old) {
                  if (!same(old.play.binding, binding))
                    throw new ConsumerError("OPERATION_CONFLICT");
                  return { kind: "existing" as const, play: old.play };
                }
                const product = await readConsumerProduct(tx, productId);
                if (product.archivedAt !== null)
                  throw new ConsumerError("PRODUCT_ARCHIVED");
                const parent = await readConsumerParent(tx, binding.parent);
                await assertConsumerParentSource(tx, parent, true);
                return {
                  kind: "new" as const,
                  parent,
                  source: await readConsumerFixedSource(tx, parent.snapshot),
                };
              },
              "version:seal-internal",
            );
            if (checked.kind === "existing")
              return createInternalPlayResultSchema.parse({
                created: false,
                play: checked.play,
              });
            await verifyConsumerExecutionIo(
              io,
              checked.parent.snapshot,
              binding.renderer,
              checked.source,
            );
            return operatorWrite(
              io.db,
              credentials,
              "version:seal-internal",
              io.checkpoint,
              observation,
              async (tx, actor) => {
                await consumerReferenceShare(tx);
                const product = await lockConsumerProduct(tx, productId);
                const old = await findInternalPlayOperation(
                  tx,
                  productId,
                  binding.operationKey,
                );
                if (old) {
                  if (!same(old.play.binding, binding))
                    throw new ConsumerError("OPERATION_CONFLICT");
                  return createInternalPlayResultSchema.parse({
                    created: false,
                    play: old.play,
                  });
                }
                if (product.archivedAt !== null)
                  throw new ConsumerError("PRODUCT_ARCHIVED");
                const parent = await readConsumerParent(tx, binding.parent);
                await assertConsumerParentSource(tx, parent, true);
                const source = await readConsumerFixedSource(
                  tx,
                  parent.snapshot,
                );
                if (
                  !same(parent, checked.parent) ||
                  !same(
                    source.evidence.validation,
                    checked.source.evidence.validation,
                  ) ||
                  source.evidence.assetSetSha256 !==
                    checked.source.evidence.assetSetSha256 ||
                  source.evidence.canonicalContentSha256 !==
                    checked.source.evidence.canonicalContentSha256
                )
                  throw new ConsumerError("SOURCE_OBSOLETE");
                const implementation = resolveConsumerImplementation(
                  binding.renderer,
                );
                if (!implementation)
                  throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
                const snapshot = internalPlaySnapshotSchema.parse({
                  schemaVersion: "quizforge.internal-play-snapshot.v1",
                  purpose: "internal-test",
                  publicationApproved: false,
                  parent: binding.parent,
                  parentSnapshot: parent.snapshot,
                  renderer: binding.renderer,
                  mapping: implementation.descriptor.mapping,
                  mappingSha256: implementation.descriptor.mappingSha256,
                  resources: JSON.parse(source.evidence.assetSetText),
                  protocols: { ...CONSUMER_PROTOCOLS_V1 },
                });
                const created = await insertInternalPlay(
                  tx,
                  product,
                  binding,
                  snapshot,
                  actor.id,
                );
                await appendConsumerOperatorAudit(
                  tx,
                  actor,
                  credentials.requestId,
                  {
                    action: "internal_play_created",
                    kind: "play",
                    id: created.play.id,
                    revision: created.play.slot,
                  },
                );
                return createInternalPlayResultSchema.parse({
                  created: true,
                  play: created.play,
                });
              },
            );
          });
        },
      );
    },
    resolve(token, productInput, bindingInput) {
      return consumerServiceCall(owner, "resolve-play", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          binding = parseConsumer(
            createInternalPlayBindingSchema,
            bindingInput,
          );
        if (binding.parent.productId !== productId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            await readConsumerProduct(tx, productId);
            const old = await findInternalPlayOperation(
              tx,
              productId,
              binding.operationKey,
            );
            const original = {
              schemaVersion: "quizforge.internal-play-resolution.v1",
              binding,
              bindingSha256: await internalPlayBindingSha256(binding),
            };
            return verifyInternalPlayResolution(
              old
                ? {
                    ...original,
                    kind: same(old.play.binding, binding)
                      ? "applied"
                      : "operation-conflict",
                    play: old.play,
                  }
                : { ...original, kind: "unresolved" },
              binding,
            );
          }),
        );
      });
    },
    read(token, productInput, playInput) {
      return consumerServiceCall(owner, "read-play", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          playId = parseConsumer(consumerUuidSchema, playInput);
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            const play = await readInternalPlayById(tx, productId, playId);
            if (!play) throw new ConsumerError("NOT_FOUND");
            return play;
          }),
        );
      });
    },
    list(token, productInput) {
      return consumerServiceCall(owner, "list-plays", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput);
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            await readConsumerProduct(tx, productId);
            return internalPlayListSchema.parse({
              productId,
              versions: await listInternalPlayFacts(tx, productId),
            });
          }),
        );
      });
    },
  });
}
