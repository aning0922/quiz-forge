"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { Eye, ArrowRight } from "lucide-react";
import {
  revisionTargetSchema,
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import type { ProductOperations } from "../operations/contracts";
import { previewPagePath } from "@/features/product/preview/urls";
import { StatusBadge } from "../operations-ui/status-badge";
import type { PresentationStatus } from "../operations-ui/presentation";
import { TechnicalDetails } from "../presentation/technical-details";
import { useProductWorkspaceContext } from "./context";
import { draftRevisionPath } from "../drafts/client";
import styles from "./hubs.module.css";

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
export function ProductPreviewHub() {
  const workspace = useProductWorkspaceContext();
  const [selection, setSelection] = useState<PreviewSelection | null>(null);
  const groupId = useId();
  if (!workspace)
    return <p role="alert">未取得测评工作区，请返回测评管理重新进入。</p>;
  const { productId, read } = workspace;
  const base = `/studio/products/${encodeURIComponent(productId)}`,
    value = read.value;
  const draft = value?.content.draft,
    historical = value?.versions.historical;
  const choices: {
    label: string;
    description: string;
    target: RevisionTarget;
  }[] = [];
  if (draft?.state === "present")
    choices.push({
      label: `当前草稿 r${draft.value.target.revision}`,
      description: "来自本次摘要观察的当前修订。",
      target: draft.value.target,
    });
  if (
    historical?.state === "present" &&
    !choices.some((choice) =>
      sameRevisionTarget(choice.target, historical.value.target),
    )
  )
    choices.push({
      label: `历史固定版来源 r${historical.value.target.revision}`,
      description: "核对历史内容，不切换已有答题版本。",
      target: historical.value.target,
    });
  const selected = selection?.productId === productId ? selection : null;
  if (
    selected &&
    !choices.some((choice) =>
      sameRevisionTarget(choice.target, selected.target),
    )
  )
    choices.push({
      label: `保留所选修订 r${selected.target.revision}`,
      description: "不在本次摘要代表项中；选择仍保持原完整目标。",
      target: selected.target,
    });
  return (
    <div className={styles.hub}>
      {read.loading && (
        <p role="status" className={styles.notice}>
          正在读取修订摘要，已选固定目标保持不变…
        </p>
      )}
      {read.error && (
        <p role="alert" className={styles.error}>
          修订摘要暂不可用，请重新读取或核实原记录。已选目标保留，当前归属无法判定。
        </p>
      )}
      <div className={`${styles.columns} ${styles.evenColumns}`}>
        <section className={styles.panel} aria-label="选择固定修订">
          <div className={styles.sectionHead}>
            <h2>选择固定修订</h2>
            <StatusBadge status={{ label: "只读体验", tone: "info" }} />
          </div>
          <p className={styles.intro}>
            明确选择一个固定对象，再从右侧打开真实预览。摘要刷新不会替你换成新草稿。
          </p>
          {choices.length ? (
            <fieldset className={styles.choices}>
              <legend className={styles.choiceLegend}>可选择的修订</legend>
              {choices.map((choice) => (
                <label
                  className={styles.choice}
                  key={JSON.stringify(choice.target)}
                >
                  <input
                    type="radio"
                    name={groupId}
                    checked={
                      !!selected &&
                      sameRevisionTarget(selected.target, choice.target)
                    }
                    onChange={() =>
                      setSelection(
                        selectPreviewTarget(productId, choice.target),
                      )
                    }
                  />
                  <span>
                    <strong>{choice.label}</strong>
                    <span className={styles.muted}>{choice.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : !read.loading && !read.error ? (
            <div className={styles.empty}>
              <h3>
                {draft?.state === "none"
                  ? "尚无可选择的草稿"
                  : "修订暂不可判定"}
              </h3>
              <p>先在内容与素材中核对来源，明确形成草稿后再选择。</p>
              <Link className={styles.textLink} href={`${base}/content`}>
                进入内容与素材
              </Link>
            </div>
          ) : null}
          <Link className={styles.textLink} href={`${base}/draft`}>
            查看完整修订历史 <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
        <section className={styles.panel} aria-label="所选修订与真实体验入口">
          <div className={styles.sectionHead}>
            <h2>所选修订与体验入口</h2>
          </div>
          {selected ? (
            <>
              <div className={styles.revisionCard}>
                <Eye size={28} aria-hidden="true" />
                <h3>固定修订 r{selected.target.revision}</h3>
                <StatusBadge
                  status={previewSelectionStatus(selected, productId, value)}
                />
              </div>
              <p>
                将打开此修订的真实消费者预览。能否渲染仍由原固定预览接口核验。
              </p>
              <Link
                className={styles.primary}
                href={previewPagePath({ productId, ...selected.target })}
              >
                打开 r{selected.target.revision} 体验预览
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
              <Link
                className={styles.textLink}
                href={draftRevisionPath(
                  productId,
                  selected.target.draftId,
                  selected.target.revision,
                )}
              >
                先核对此修订内容
              </Link>
              <TechnicalDetails label="所选完整目标">
                <dl className={styles.technicalFacts}>
                  <dt>草稿编号</dt>
                  <dd>{selected.target.draftId}</dd>
                  <dt>内容 SHA-256</dt>
                  <dd>{selected.target.canonicalContentSha256}</dd>
                  <dt>素材集 SHA-256</dt>
                  <dd>{selected.target.assetSetSha256}</dd>
                  <dt>Manifest SHA-256</dt>
                  <dd>{selected.target.canonicalManifestSha256}</dd>
                </dl>
              </TechnicalDetails>
            </>
          ) : (
            <div className={styles.empty}>
              <Eye size={32} aria-hidden="true" />
              <h3>尚未选择修订</h3>
              <p>
                请先从左侧选择当前或历史固定修订，再打开对应的题目、结果与实际画面。
              </p>
            </div>
          )}
          <p className={styles.caption}>
            打开预览不登记“已人工体验”，也不自动形成审核依据、消费者报告或公开发布资格。
          </p>
        </section>
      </div>
    </div>
  );
}
