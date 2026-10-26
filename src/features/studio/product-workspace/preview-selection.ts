import {
  revisionTargetSchema,
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import type { ProductOperations } from "../operations/contracts";
import type { PresentationStatus } from "../operations-ui/presentation";

export type PreviewSelection = { productId: string; target: RevisionTarget };
export function selectPreviewTarget(
  productId: string,
  target: RevisionTarget,
): PreviewSelection {
  return { productId, target: revisionTargetSchema.parse(target) };
}
/** Classify a retained selection against fresh facts; never replace its immutable target. */
export function previewSelectionStatus(
  selection: PreviewSelection,
  productId: string,
  value: ProductOperations | undefined,
): PresentationStatus {
  if (
    selection.productId !== productId ||
    (value && value.directory.id !== productId)
  )
    return { label: "所选测评不一致，请重新选择", tone: "warning" };
  if (!value)
    return { label: "所选修订保留 · 当前归属待核实", tone: "warning" };
  const draft = value.content.draft;
  if (draft.state !== "present" && draft.state !== "none")
    return { label: "所选修订保留 · 当前归属待核实", tone: "warning" };
  if (
    draft.state === "present" &&
    sameRevisionTarget(selection.target, draft.value.target)
  )
    return { label: "当前草稿修订", tone: "info" };
  if (
    value.versions.historical.state === "present" &&
    sameRevisionTarget(selection.target, value.versions.historical.value.target)
  )
    return { label: "历史固定版本的来源修订", tone: "neutral" };
  return { label: "保留的固定修订 · 非当前已确认草稿", tone: "neutral" };
}
