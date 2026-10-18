import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  internalPlayReceiptSchema,
  internalPlayBindingSha256,
  type CreateInternalPlayBinding,
} from "@/features/product/internal-play/contracts";
import {
  createInternalPlayResultSchema,
  issueAccessKeyResultSchema,
} from "@/features/fulfillment/consumer-flow/operator-resolutions";
import {
  verifyAccessKeyDetail,
  type IssueAccessKeyBinding,
} from "@/features/fulfillment/access/contracts";
export async function checkPlayReceiptV1(input: unknown) {
  const value = internalPlayReceiptSchema.parse(input);
  if ((await internalPlayBindingSha256(value.binding)) !== value.bindingSha256)
    throw Error("PLAY_MISMATCH");
  return value;
}
export async function checkPlayCreatedV1(
  input: unknown,
  status: number,
  binding: CreateInternalPlayBinding,
) {
  const value = createInternalPlayResultSchema.parse(input);
  await checkPlayReceiptV1(value.play);
  if (
    status !== (value.created ? 201 : 200) ||
    !sameConsumerFact(value.play.binding, binding, L.playRequestBytes)
  )
    throw Error("PLAY_MISMATCH");
  return value;
}
export async function checkKeyIssuedV1(
  input: unknown,
  status: number,
  binding: IssueAccessKeyBinding,
) {
  const value = issueAccessKeyResultSchema.parse(input);
  await verifyAccessKeyDetail(value.key);
  if (
    status !== (value.created ? 201 : 200) ||
    !sameConsumerFact(value.key.issue.binding, binding, L.operationRequestBytes)
  )
    throw Error("KEY_MISMATCH");
  return value;
}
