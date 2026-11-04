/** Display-only reason from an already verified session or exact operation observation. */
export type ConsumerReexchangeReason =
  "version-superseded" | "entitlement-completed";

export function consumerReexchangeReason(value?: { kind: string }) {
  return value?.kind === "version-superseded" ||
    value?.kind === "entitlement-completed"
    ? value.kind
    : undefined;
}

export const CONSUMER_REEXCHANGE_COPY = Object.freeze({
  "version-superseded":
    "题目版本已更新。请使用原兑换码重新进入；本页原操作记录仍会保留。",
  "entitlement-completed":
    "这个兑换资格已完成答题。请使用原兑换码重新进入，查看已保存的报告。",
  action: "使用原兑换码重新进入",
});
