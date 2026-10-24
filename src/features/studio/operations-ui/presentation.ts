import {
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import type { Observation, ProductOperations } from "../operations/contracts";

export type PresentationStatus = {
  label: string;
  tone: "neutral" | "info" | "success" | "warning";
};
export type ProductPresentation = {
  content: PresentationStatus;
  review: PresentationStatus;
  testing: PresentationStatus;
  primary: { label: string; href: string; reason: string };
  previewHref: string | null;
  historicalNote: string | null;
};
const status = (
  label: string,
  tone: PresentationStatus["tone"],
): PresentationStatus => ({ label, tone });
const matches = <T extends { target: RevisionTarget }>(
  observation: Observation<T>,
  target: RevisionTarget,
) =>
  observation.state === "present" &&
  sameRevisionTarget(observation.value.target, target);

function contentStatus(value: ProductOperations): PresentationStatus {
  const { draft, reception, validation } = value.content;
  if (draft.state === "present")
    return status(`当前草稿 r${draft.value.target.revision}`, "info");
  if (draft.state !== "none") return status("内容待核实", "warning");
  if (validation.latest.state === "present") {
    const item = validation.latest.value;
    if (
      reception.latest.state === "present" &&
      reception.latest.value.id !== item.importId
    )
      return status("不同来源待核对", "warning");
    if (item.storageCondition !== "clean")
      return status("检查记录待核实", "warning");
    const labels = {
      validating: "内容检查中",
      validated: "检查已完成",
      archiving: "素材封存中",
      ready: "检查就绪 · 待建草稿",
      rejected: "内容检查未通过",
      "retryable-failed": "内容检查需恢复",
    } as const;
    return status(
      labels[item.status],
      item.status === "rejected" || item.status === "retryable-failed"
        ? "warning"
        : "info",
    );
  }
  if (validation.latest.state !== "none")
    return status("检查状态待核实", "warning");
  if (reception.latest.state === "present") {
    const item = reception.latest.value;
    if (item.storageCondition !== "clean")
      return status("接收记录待核实", "warning");
    const labels = {
      "awaiting-upload": "等待上传内容",
      receiving: "正在接收内容",
      received: "内容待检查",
      "retryable-failed": "内容接收需恢复",
      rejected: "内容接收未通过",
    } as const;
    return status(
      labels[item.status],
      item.status === "rejected" || item.status === "retryable-failed"
        ? "warning"
        : "info",
    );
  }
  return reception.latest.state === "none"
    ? status("尚无内容", "neutral")
    : status("接收状态待核实", "warning");
}

/** Read-only labels and navigation. These facts never authorize or construct a business write. */
export function productPresentation(
  value: ProductOperations,
): ProductPresentation {
  const base = `/studio/products/${encodeURIComponent(value.directory.id)}`;
  const draft = value.content.draft;
  const target = draft.state === "present" ? draft.value.target : null;
  const currentReview = target && matches(value.review.current, target);
  const currentVersion =
    target &&
    value.versions.currentCount > 0 &&
    matches(value.versions.current, target);
  const currentTesting =
    currentVersion &&
    value.testing.currentCount > 0 &&
    target &&
    matches(value.testing.current, target);
  const uncertain =
    (draft.state !== "present" && draft.state !== "none") ||
    (target && value.review.current.state !== "none" && !currentReview) ||
    (target && value.versions.currentCount > 0 && !currentVersion);
  const review = !target
    ? status(
        draft.state === "none" ? "暂无草稿" : "审核待核实",
        draft.state === "none" ? "neutral" : "warning",
      )
    : currentReview
      ? status(`r${target.revision} 有审核依据`, "success")
      : value.review.current.state === "none"
        ? status(`r${target.revision} 待核对审核`, "warning")
        : status("审核待核实", "warning");
  const testing = currentTesting
    ? status(`r${target!.revision} 有答题版本`, "success")
    : currentVersion
      ? status(`r${target!.revision} 已有固定版`, "info")
      : value.testing.historicalCount > 0
        ? status("仅有历史内测", "neutral")
        : value.testing.current.state === "indeterminate"
          ? status("内测状态待核实", "warning")
          : status("尚无当前内测", "neutral");
  let primary: ProductPresentation["primary"];
  if (value.directory.archivedAt)
    primary = {
      label: "查看测评",
      href: base,
      reason: "测评已归档，查看现有信息与历史记录。",
    };
  else if (uncertain)
    primary = {
      label: "核实当前状态",
      href: base,
      reason: "当前事实尚无法准确关联，请先核实摘要与原记录。",
    };
  else if (!target)
    primary = {
      label: "处理内容",
      href: `${base}/content`,
      reason: "尚无当前草稿，先处理内容包接收、检查与草稿。",
    };
  else if (!currentReview)
    primary = {
      label: "核对当前修订",
      href: `${base}/drafts/${target.draftId}/revisions/${target.revision}/internal-review`,
      reason: `当前 r${target.revision} 尚无精确匹配的审核依据。`,
    };
  else if (!currentVersion)
    primary = {
      label: "审核与版本",
      href: `${base}/internal-versions`,
      reason: `当前 r${target.revision} 有审核依据，尚无匹配固定版。`,
    };
  else
    primary = {
      label: "管理内测",
      href: `${base}/consumer-access`,
      reason: `查看与 r${target.revision} 关联的答题版本及内测记录。`,
    };
  const historical: string[] = [];
  for (const [label, count, observation] of [
    ["历史审核", value.review.historicalCount, value.review.latestHistorical],
    ["历史固定版", value.versions.historicalCount, value.versions.historical],
    ["历史内测", value.testing.historicalCount, value.testing.historical],
  ] as const)
    if (count > 0)
      historical.push(
        `${label}${observation.state === "present" ? ` r${observation.value.target.revision}` : ` ${count} 项`}`,
      );
  return {
    content: contentStatus(value),
    review,
    testing,
    primary,
    previewHref: target
      ? `${base}/drafts/${target.draftId}/revisions/${target.revision}/preview`
      : null,
    historicalNote: historical.length ? historical.join(" · ") : null,
  };
}
