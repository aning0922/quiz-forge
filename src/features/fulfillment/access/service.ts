import "server-only";
import {
  consumerIdSchema,
  consumerUuidSchema,
} from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { appendConsumerOperatorAudit } from "@/lib/auth/consumer-audit";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import {
  lockConsumerProduct,
  readConsumerProduct,
  readFixedInternalPlay,
} from "@/features/product/internal-play/repository";
import { accessKeyPlayImplementationAvailable } from "./implementation-availability";
import { readClaimMetadata } from "../consumer-session/repository";
import { readCompletionMetadata } from "@/features/report/persisted/repository";
import type { ConsumerRequestOwner } from "../consumer-flow/request-owner";
import type { AccessKeyService } from "../consumer-flow/service-contract";
import {
  consumerServiceCall,
  parseConsumer,
  operatorRead,
  operatorWrite,
  consumerReferenceShare,
  consumerDatabaseMoment,
  assertOperatorWriteCredentials,
} from "../consumer-flow/transaction";
import {
  issueAccessKeyResultSchema,
  verifyIssueAccessKeyResolution,
  verifyVoidUnusedAccessKeyResolution,
} from "../consumer-flow/operator-resolutions";
import {
  issueAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSchema,
  accessKeyCursorSchema,
  accessKeyListSchema,
  issueAccessKeyBindingSha256,
  voidUnusedAccessKeyBindingSha256,
  verifyAccessKeyDetail,
  type AccessKeyDetail,
  type VoidUnusedAccessKeyBinding,
} from "./contracts";
import {
  findKeyIssueOperation,
  findKeyVoidOperation,
  readKeyFact,
  listKeyIssueFacts,
  lockAccessKey,
  insertAccessKey,
  voidUnusedKey,
  type AccessKeyFact,
} from "./repository";
const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationRequestBytes);
async function details(
  tx: ConsumerTx,
  facts: readonly AccessKeyFact[],
): Promise<AccessKeyDetail[]> {
  const ids = facts.map((f) => f.issue.binding.keyId),
    claims = await readClaimMetadata(tx, ids),
    reports = await readCompletionMetadata(tx, ids),
    observedAt = await consumerDatabaseMoment(tx);
  return Promise.all(
    facts.map((f) => {
      const claim = claims.find((c) => c.keyId === f.issue.binding.keyId),
        completion = reports.find((r) => r.keyId === f.issue.binding.keyId);
      return verifyAccessKeyDetail({
        issue: f.issue,
        current: {
          observedAt,
          claim: claim
            ? { sessionId: claim.sessionId, claimedAt: claim.claimedAt }
            : null,
          completion: completion
            ? {
                reportId: completion.reportId,
                completedAt: completion.completedAt,
              }
            : null,
          voidReceipt: f.voidReceipt,
        },
      });
    }),
  );
}
async function oneDetail(tx: ConsumerTx, fact: AccessKeyFact) {
  const value = (await details(tx, [fact]))[0];
  if (!value) throw new ConsumerError("UNAVAILABLE");
  return value;
}
async function voidResolution(
  key: AccessKeyDetail,
  binding: VoidUnusedAccessKeyBinding,
) {
  const voided = key.current.voidReceipt;
  const kind = voided
    ? same(voided.binding, binding)
      ? "applied"
      : "voided-other"
    : key.current.claim
      ? "claimed"
      : "unresolved";
  return verifyVoidUnusedAccessKeyResolution(
    {
      kind,
      schemaVersion: "quizforge.access-key-void-resolution.v1",
      binding,
      bindingSha256: await voidUnusedAccessKeyBindingSha256(binding),
      key,
    },
    binding,
  );
}
/** Every method owns one request; credentials/raw Key are never persisted as metadata or returned here. */
export function createAccessKeyService(
  owner: ConsumerRequestOwner,
): AccessKeyService {
  return Object.freeze<AccessKeyService>({
    issue(credentials, productInput, bindingInput) {
      return consumerServiceCall(owner, "issue-key", async (c, observation) => {
        assertOperatorWriteCredentials(credentials);
        const productId = parseConsumer(consumerIdSchema, productInput),
          binding = parseConsumer(issueAccessKeyBindingSchema, bindingInput);
        if (binding.play.productId !== productId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorWrite(
            db,
            credentials,
            "access-key:issue",
            check,
            observation,
            async (tx, actor) => {
              await consumerReferenceShare(tx);
              const product = await lockConsumerProduct(tx, productId);
              const old = await findKeyIssueOperation(
                tx,
                productId,
                binding.operationKey,
              );
              if (old) {
                if (!same(old.issue.binding, binding))
                  throw new ConsumerError("OPERATION_CONFLICT");
                return issueAccessKeyResultSchema.parse({
                  created: false,
                  key: await oneDetail(tx, old),
                });
              }
              if (product.archivedAt !== null)
                throw new ConsumerError("PRODUCT_ARCHIVED");
              const play = await readFixedInternalPlay(tx, binding.play);
              if (!accessKeyPlayImplementationAvailable(play.snapshot))
                throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
              const created = await insertAccessKey(
                tx,
                product,
                binding,
                actor.id,
              );
              await appendConsumerOperatorAudit(
                tx,
                actor,
                credentials.requestId,
                {
                  action: "access_key_issued",
                  kind: "access-key",
                  id: binding.keyId,
                  revision: 1,
                },
              );
              return issueAccessKeyResultSchema.parse({
                created: true,
                key: await oneDetail(tx, created),
              });
            },
          ),
        );
      });
    },
    resolveIssue(token, productInput, bindingInput) {
      return consumerServiceCall(owner, "resolve-issue", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          binding = parseConsumer(issueAccessKeyBindingSchema, bindingInput);
        if (binding.play.productId !== productId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            await readConsumerProduct(tx, productId);
            const old = await findKeyIssueOperation(
              tx,
              productId,
              binding.operationKey,
            );
            const original = {
              schemaVersion: "quizforge.access-key-issue-resolution.v1",
              binding,
              bindingSha256: await issueAccessKeyBindingSha256(binding),
            };
            return verifyIssueAccessKeyResolution(
              old
                ? {
                    ...original,
                    kind: same(old.issue.binding, binding)
                      ? "applied"
                      : "operation-conflict",
                    key: await oneDetail(tx, old),
                  }
                : { ...original, kind: "unresolved" },
              binding,
            );
          }),
        );
      });
    },
    voidUnused(credentials, productInput, keyInput, bindingInput) {
      return consumerServiceCall(owner, "void-key", async (c, observation) => {
        assertOperatorWriteCredentials(credentials);
        const productId = parseConsumer(consumerIdSchema, productInput),
          keyId = parseConsumer(consumerUuidSchema, keyInput),
          binding = parseConsumer(
            voidUnusedAccessKeyBindingSchema,
            bindingInput,
          );
        if (binding.productId !== productId || binding.keyId !== keyId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorWrite(
            db,
            credentials,
            "access-key:void",
            check,
            observation,
            async (tx, actor) => {
              await consumerReferenceShare(tx);
              const key = await lockAccessKey(tx, { keyId });
              if (!key || key.issue.binding.play.productId !== productId)
                throw new ConsumerError("NOT_FOUND");
              if (key.issue.bindingSha256 !== binding.issueBindingSha256)
                throw new ConsumerError("OPERATION_CONFLICT");
              const observed = await oneDetail(tx, key);
              if (observed.current.voidReceipt || observed.current.claim)
                return voidResolution(observed, binding);
              const occupied = await findKeyVoidOperation(
                tx,
                productId,
                binding.operationKey,
              );
              if (occupied && occupied.issue.binding.keyId !== keyId)
                throw new ConsumerError("OPERATION_CONFLICT");
              const voided = await voidUnusedKey(tx, key, binding, actor.id);
              await appendConsumerOperatorAudit(
                tx,
                actor,
                credentials.requestId,
                {
                  action: "access_key_voided",
                  kind: "access-key",
                  id: keyId,
                  revision: 1,
                },
              );
              return voidResolution(await oneDetail(tx, voided), binding);
            },
          ),
        );
      });
    },
    resolveVoid(token, productInput, bindingInput) {
      return consumerServiceCall(owner, "resolve-void", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          binding = parseConsumer(
            voidUnusedAccessKeyBindingSchema,
            bindingInput,
          );
        if (binding.productId !== productId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            const key = await readKeyFact(tx, productId, binding.keyId);
            if (!key) throw new ConsumerError("NOT_FOUND");
            if (key.issue.bindingSha256 !== binding.issueBindingSha256)
              throw new ConsumerError("OPERATION_CONFLICT");
            const occupied = await findKeyVoidOperation(
              tx,
              productId,
              binding.operationKey,
            );
            if (occupied && occupied.issue.binding.keyId !== binding.keyId)
              throw new ConsumerError("OPERATION_CONFLICT");
            return voidResolution(await oneDetail(tx, key), binding);
          }),
        );
      });
    },
    read(token, productInput, keyInput) {
      return consumerServiceCall(owner, "read-key", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          keyId = parseConsumer(consumerUuidSchema, keyInput);
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            const key = await readKeyFact(tx, productId, keyId);
            if (!key) throw new ConsumerError("NOT_FOUND");
            return oneDetail(tx, key);
          }),
        );
      });
    },
    list(token, productInput, cursorInput) {
      return consumerServiceCall(owner, "list-keys", async (c) => {
        const productId = parseConsumer(consumerIdSchema, productInput),
          cursor =
            cursorInput === null
              ? null
              : parseConsumer(accessKeyCursorSchema, cursorInput);
        if (cursor && cursor.productId !== productId)
          throw new ConsumerError("INVALID_REQUEST");
        return c.sql((db, check) =>
          operatorRead(db, token, check, async (tx) => {
            await readConsumerProduct(tx, productId);
            const page = await listKeyIssueFacts(tx, productId, cursor);
            return accessKeyListSchema.parse({
              productId,
              keys: await details(tx, page.keys),
              nextCursor: page.nextCursor,
            });
          }),
        );
      });
    },
  });
}
