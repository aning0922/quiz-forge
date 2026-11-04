import "server-only";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { digestToken } from "@/lib/security/p2a-tokens";
import { consumerIdSchema } from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import type { ConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import {
  consumerServiceCall,
  operatorRead,
  operatorWrite,
  parseConsumer,
  assertOperatorWriteCredentials,
} from "@/features/fulfillment/consumer-flow/transaction";
import {
  fixedConsumerExecution,
  verifyConsumerExecutionIo,
} from "@/features/fulfillment/consumer-flow/fixed-execution";
import { readConsumerFixedSource } from "@/features/quizpack/consumer-fixed-source";
import { activatePolicyProduct } from "@/features/fulfillment/consumer-session/policy-repository";
import {
  readConsumerProduct,
  readFixedInternalPlay,
  readConsumerParent,
  assertConsumerParentSource,
} from "./repository";
import { observeActivation } from "./activation-repository";
import {
  activateConsumerProductBindingSchema,
  type ActivateConsumerProductBinding,
  type ConsumerActivationResolution,
} from "./activation-contracts";

export interface ConsumerActivationService {
  activate(
    credentials: StudioWriteCredentials,
    productId: string,
    binding: ActivateConsumerProductBinding,
  ): Promise<ConsumerActivationResolution>;
  resolve(
    sessionToken: string | null,
    productId: string,
    binding: ActivateConsumerProductBinding,
  ): Promise<ConsumerActivationResolution>;
}
function scope(product: string, input: unknown) {
  const productId = parseConsumer(consumerIdSchema, product),
    binding = parseConsumer(activateConsumerProductBindingSchema, input);
  if (binding.productId !== productId)
    throw new ConsumerError("INVALID_REQUEST");
  return binding;
}
async function preflight(
  tx: ConsumerTx,
  binding: ActivateConsumerProductBinding,
) {
  const prior = await observeActivation(tx, binding);
  if (prior.kind === "operation-conflict")
    throw new ConsumerError("OPERATION_CONFLICT");
  if (prior.kind === "applied") return { kind: "existing" as const, prior };
  const product = await readConsumerProduct(tx, binding.productId);
  if (product.archivedAt !== null) throw new ConsumerError("PRODUCT_ARCHIVED");
  const play = await readFixedInternalPlay(tx, binding),
    parent = await readConsumerParent(tx, play.snapshot.parent);
  if (
    !sameConsumerFact(parent.snapshot, play.snapshot.parentSnapshot, 512 * 1024)
  )
    throw new ConsumerError("SOURCE_OBSOLETE");
  await assertConsumerParentSource(tx, parent, true);
  const source = await readConsumerFixedSource(tx, parent.snapshot),
    presentation =
      play.snapshot.schemaVersion === "quizforge.internal-play-snapshot.v2"
        ? play.snapshot.presentation
        : undefined;
  fixedConsumerExecution(
    parent.snapshot,
    play.snapshot.renderer,
    source,
    presentation,
  );
  return { kind: "new" as const, play, source, presentation };
}
export function createConsumerActivationService(
  owner: ConsumerRequestOwner,
): ConsumerActivationService {
  return Object.freeze<ConsumerActivationService>({
    activate(credentials, productId, input) {
      return consumerServiceCall(
        owner,
        "activate-play",
        async (c, observation) => {
          assertOperatorWriteCredentials(credentials);
          const binding = scope(productId, input);
          const before = await c.sql((db, check) =>
            operatorRead(
              db,
              credentials.sessionToken,
              check,
              (tx) => preflight(tx, binding),
              "version:seal-internal",
            ),
          );
          if (before.kind === "existing") return before.prior;
          return c.io(async (io) => {
            const checked = await operatorRead(
              io.db,
              credentials.sessionToken,
              io.checkpoint,
              (tx) => preflight(tx, binding),
              "version:seal-internal",
            );
            if (checked.kind === "existing") return checked.prior;
            await verifyConsumerExecutionIo(
              io,
              checked.play.snapshot.parentSnapshot,
              checked.play.snapshot.renderer,
              checked.source,
              checked.presentation,
            );
            return operatorWrite(
              io.db,
              credentials,
              "version:seal-internal",
              io.checkpoint,
              observation,
              async (tx) => {
                const final = await preflight(tx, binding);
                if (final.kind === "existing") return final.prior;
                const {
                    canonicalContentText: checkedContent,
                    assetSetText: checkedAssets,
                    ...checkedFacts
                  } = checked.source.evidence,
                  {
                    canonicalContentText: finalContent,
                    assetSetText: finalAssets,
                    ...finalFacts
                  } = final.source.evidence;
                if (
                  !sameConsumerFact(checked.play, final.play, 512 * 1024) ||
                  checkedContent !== finalContent ||
                  checkedAssets !== finalAssets ||
                  !sameConsumerFact(checkedFacts, finalFacts, 512 * 1024)
                )
                  throw new ConsumerError("SOURCE_OBSOLETE");
                await activatePolicyProduct(
                  tx,
                  binding,
                  digestToken(credentials.sessionToken!, "session")!,
                  credentials.requestId,
                );
                const result = await observeActivation(tx, binding);
                if (result.kind !== "applied")
                  throw new ConsumerError("UNAVAILABLE");
                return result;
              },
            );
          });
        },
      );
    },
    resolve(token, productId, input) {
      return consumerServiceCall(owner, "resolve-activation", (c) => {
        const binding = scope(productId, input);
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            await readConsumerProduct(tx, productId);
            return observeActivation(tx, binding);
          }),
        );
      });
    },
  });
}
