import "server-only";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";
import {
  readActivationOperation,
  readPolicyHead,
} from "@/features/fulfillment/consumer-session/policy-repository";
import {
  consumerProductHeadSchema,
  verifyConsumerProductActivationReceipt,
  consumerProductActivationBindingText,
  verifyConsumerActivationResolution,
  type ActivateConsumerProductBinding,
} from "./activation-contracts";

export async function decodeActivationReceipt(row: Record<string, unknown>) {
  if (
    typeof row.receipt_text !== "string" ||
    row.receipt_text.length > 8192 ||
    (await consumerTextSha256(row.receipt_text)) !== row.receipt_sha256
  )
    throw new ConsumerError("UNAVAILABLE");
  const receipt = await verifyConsumerProductActivationReceipt(
    JSON.parse(row.receipt_text),
  );
  if (
    consumerCanonicalText(receipt, 8192) !== row.receipt_text ||
    receipt.binding.expectedGeneration !== row.expected_generation ||
    receipt.id !== row.id ||
    receipt.binding.productId !== row.product_id ||
    receipt.binding.operationKey !== row.operation_key ||
    receipt.bindingSha256 !== row.binding_sha256 ||
    consumerProductActivationBindingText(receipt.binding) !==
      row.binding_text ||
    receipt.generation !== row.generation ||
    receipt.binding.playVersionId !== row.play_version_id ||
    receipt.binding.playSnapshotSha256 !== row.play_snapshot_sha256 ||
    receipt.activatedBy !== row.activated_by
  )
    throw new ConsumerError("UNAVAILABLE");
  return receipt;
}
export async function observeActivation(
  tx: ConsumerTx,
  binding: ActivateConsumerProductBinding,
) {
  const row = await readActivationOperation(
      tx,
      binding.productId,
      binding.operationKey,
    ),
    head = await readPolicyHead(tx, binding.productId);
  const receipt = row ? await decodeActivationReceipt(row) : null;
  return verifyConsumerActivationResolution(
    {
      schemaVersion: "quizforge.consumer-product-activation-resolution.v1",
      binding,
      bindingSha256: await consumerTextSha256(
        consumerProductActivationBindingText(binding),
      ),
      kind: receipt
        ? consumerProductActivationBindingText(receipt.binding) ===
          consumerProductActivationBindingText(binding)
          ? "applied"
          : "operation-conflict"
        : "unresolved",
      receipt,
      head: head
        ? consumerProductHeadSchema.parse({
            productId: head.product_id,
            generation: head.generation,
            playVersionId: head.play_version_id,
            playSnapshotSha256: head.play_snapshot_sha256,
          })
        : null,
    },
    binding,
  );
}
