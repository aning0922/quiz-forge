"use client";

import {
  Check,
  FileText,
  ShieldCheck,
  AlertTriangle,
  History,
} from "lucide-react";
import { useCallback, useLayoutEffect, useState } from "react";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import {
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/contracts";
import {
  internalReviewUrl,
  internalVersionsUrl,
  internalVersionUrl,
} from "@/features/product/internal-versions/urls";
import {
  readInternalReviewState,
  readInternalVersions,
  readInternalVersion,
} from "../internal-versions/client";
import { TargetFacts } from "../internal-versions/facts";
import { InternalRecoveryPanels } from "../internal-versions/pending-panel";
import { InternalWritePanel } from "../internal-versions/write-panel";
import { useInternalRead } from "../internal-versions/use-read";
import type { InternalOperation } from "../internal-versions/request";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import {
  RetainedTaskSurface,
  useWorkspaceSurfaces,
  type WorkspaceTaskState,
} from "./task-surfaces";
import styles from "./release-workbench.module.css";

const quiet: WorkspaceTaskState = {
  busy: false,
  pending: false,
  retained: false,
};
export function ReviewWorkbench({
  productId,
  session,
  currentTarget,
  visible,
  onChanged,
  onGoToTesting,
  onPreviewTarget,
  onInspectRevision,
}: {
  productId: string;
  session: StudioSessionDto;
  currentTarget?: RevisionTarget | undefined;
  visible: boolean;
  onChanged: () => void;
  onGoToTesting?: (() => void) | undefined;
  onPreviewTarget?: ((target: RevisionTarget) => void) | undefined;
  onInspectRevision?: ((target: RevisionTarget) => void) | undefined;
}) {
  const surfaces = useWorkspaceSurfaces();
  const [selection, setSelection] = useState<RevisionTarget | undefined>(
    currentTarget,
  );
  // Capture the first reliable fixed scope even when the initial summary is still loading.
  // Later summaries only produce a difference notice; they never replace this selection.
  if (!selection && currentTarget) setSelection(currentTarget);
  const target = selection ?? currentTarget;
  const [nonce, setNonce] = useState(0);
  const [versionId, setVersionId] = useState<string>();
  const [writeState, setWriteState] = useState(quiet);
  const [recoveries, setRecoveries] = useState<
    Partial<Record<InternalOperation, WorkspaceTaskState>>
  >({});
  const scope = target
    ? { productId, draftId: target.draftId, revision: target.revision }
    : undefined;
  const review = useInternalRead(
    scope ? internalReviewUrl(scope) : `review:none:${productId}`,
    async (signal) => {
      if (!scope || !target) return undefined;
      const value = await readInternalReviewState(scope, signal);
      if (!sameRevisionTarget(value.target, target))
        throw new StudioClientError("STUDIO_UNAVAILABLE");
      return value;
    },
  );
  const versions = useInternalRead(internalVersionsUrl(productId), (signal) =>
    readInternalVersions(productId, signal),
  );
  const detail = useInternalRead(
    versionId
      ? internalVersionUrl(productId, versionId)
      : `version:none:${productId}`,
    (signal) =>
      versionId
        ? readInternalVersion(productId, versionId, signal)
        : Promise.resolve(undefined),
  );
  const reportRecovery = useCallback(
    (operation: InternalOperation, state: WorkspaceTaskState) => {
      setRecoveries((old) => {
        const previous = old[operation];
        return previous?.busy === state.busy &&
          previous.pending === state.pending &&
          previous.retained === state.retained
          ? old
          : { ...old, [operation]: state };
      });
    },
    [],
  );
  const pending =
    writeState.pending ||
    Object.values(recoveries).some((state) => state.pending);
  const busy =
    writeState.busy || Object.values(recoveries).some((state) => state.busy);
  const report = surfaces.report;
  useLayoutEffect(
    () =>
      report("review", {
        busy,
        pending,
        retained: writeState.retained || pending,
        message: pending
          ? "审核或封存原请求仍保留，请继续核实并明确结束。"
          : writeState.message,
      }),
    [report, busy, pending, writeState],
  );
  function changed() {
    setNonce((value) => value + 1);
    review.refresh();
    versions.refresh();
    onChanged();
  }
  function selectCurrent() {
    if (
      !currentTarget ||
      !surfaces.canSwitch() ||
      busy ||
      pending ||
      writeState.retained
    )
      return;
    setSelection(currentTarget);
  }
  function openVersion(id: string) {
    if (!surfaces.canSwitch()) return;
    setVersionId(id);
    surfaces.open("version");
  }
  const value = review.value;
  const head =
    !!value && value.target.revision === value.observedCurrentRevision;
  const fixedCurrent =
    value &&
    versions.value?.versions.find((version) =>
      sameRevisionTarget(version.target, value.target),
    );
  function openReview() {
    if (!surfaces.canSwitch()) return;
    if (!selection && currentTarget) setSelection(currentTarget);
    surfaces.open("review");
  }
  function goTesting() {
    if (surfaces.canSwitch()) onGoToTesting?.();
  }
  const different =
    !!target && !!currentTarget && !sameRevisionTarget(target, currentTarget);
  return (
    <>
      <div hidden={!visible} className={styles.workbench}>
        <div className={styles.heading}>
          <div>
            <h2>审核与版本</h2>
            <p>先核对当前修订的真实条件，再决定是否固定；历史记录独立查看。</p>
          </div>
          <button onClick={() => surfaces.open("versions")}>
            <History size={18} aria-hidden="true" />
            历史固定版本
          </button>
        </div>
        <div className={styles.reviewColumns}>
          <section className={styles.panel}>
            <div className={styles.cardHeading}>
              <div>
                <h3>当前修订检查</h3>
                <p>
                  {target
                    ? `固定处理目标 r${target.revision}`
                    : "暂无可审核草稿"}
                </p>
              </div>
              <span
                className={`${styles.badge} ${value?.review && head ? styles.successTone : styles.warningTone}`}
              >
                {review.loading
                  ? "正在核对"
                  : value?.review && head
                    ? "已有匹配依据"
                    : "尚不具备封存条件"}
              </span>
            </div>
            {different && (
              <div className={styles.notice}>
                <p>
                  后台摘要已是 r{currentTarget.revision}，本任务仍绑定 r
                  {target.revision}。
                </p>
                <button
                  disabled={busy || pending || writeState.retained}
                  onClick={selectCurrent}
                >
                  明确改为核对 r{currentTarget.revision}
                </button>
                <p>请先处理旧确认或原请求，再切换目标。</p>
              </div>
            )}
            {review.loading && <p role="status">正在核对固定修订条件…</p>}
            {review.error && (
              <p role="alert" className={styles.notice}>
                {review.error} 原请求保持，不能据此判断没有审核依据。
              </p>
            )}
            {!target && (
              <div className={styles.empty}>
                <ShieldCheck size={30} aria-hidden="true" />
                <h3>尚无可审核的修订</h3>
                <p>先在内容制作完成草稿，再核对已有审核依据。</p>
              </div>
            )}
            {value && (
              <>
                <div className={styles.conditions}>
                  <div className={styles.condition}>
                    <Check size={20} aria-hidden="true" />
                    <div>
                      <strong>内容修订：r{value.target.revision}</strong>
                      <p>
                        {head
                          ? "已保存为不可变草稿，内容与素材可独立核对。"
                          : `历史固定目标；本次服务读取的当前修订是 r${value.observedCurrentRevision}。`}
                      </p>
                    </div>
                    <span className={`${styles.badge} ${styles.successTone}`}>
                      已存在
                    </span>
                  </div>
                  <div className={styles.condition}>
                    <ShieldCheck size={20} aria-hidden="true" />
                    <div>
                      <strong>此修订的审核依据</strong>
                      <p>
                        {value.review
                          ? value.review.facts.approval.kind ===
                            "synthetic-test"
                            ? "精确匹配的合成测试依据，不表示作者批准。"
                            : "已有精确匹配此目标的依据记录。"
                          : value.baseline
                            ? "已有登记基线，仍须核对并明确记录；登记不等于已记录。"
                            : `r${value.target.revision} 没有可直接使用的匹配依据，历史批准不能沿用。`}
                      </p>
                    </div>
                    <span
                      className={`${styles.badge} ${value.review ? styles.successTone : styles.warningTone}`}
                    >
                      {value.review
                        ? "匹配"
                        : value.baseline
                          ? "待记录"
                          : "未匹配"}
                    </span>
                  </div>
                  <div className={styles.condition}>
                    <FileText size={20} aria-hidden="true" />
                    <div>
                      <strong>此修订的固定内容版本</strong>
                      <p>
                        {!versions.value
                          ? "版本记录尚未可靠读取。"
                          : fixedCurrent
                            ? `已有固定内容第 ${fixedCurrent.slot} 版，历史和新草稿分别保留。`
                            : "需在依据匹配且能力可用时明确固定，不能覆盖历史内容。"}
                      </p>
                    </div>
                    <span className={styles.badge}>
                      {!versions.value
                        ? "待核实"
                        : fixedCurrent
                          ? "已固定"
                          : "未固定"}
                    </span>
                  </div>
                </div>
                {!head ? (
                  <p className={styles.notice}>
                    此目标已是历史修订，不能新记录或封存。
                  </p>
                ) : fixedCurrent ? (
                  <div className={styles.ready}>
                    <Check size={20} aria-hidden="true" />
                    <p>此准确修订已有固定内容，可进入内测发放选择已有版本。</p>
                  </div>
                ) : !value.review && !value.baseline ? (
                  <div className={styles.notice}>
                    <AlertTriangle size={20} aria-hidden="true" />
                    <p>
                      当前版本尚无可直接使用的批准依据。此界面不能自动生成或授予人工审批。
                    </p>
                  </div>
                ) : (
                  <p className={styles.hint}>
                    固定后新增不可变内测内容版本，不影响历史答题与报告。
                  </p>
                )}
              </>
            )}
            <div className={styles.actions}>
              {pending || writeState.retained ? (
                <button
                  className={styles.primary}
                  onClick={() => surfaces.open("review")}
                >
                  继续原审核与封存任务
                </button>
              ) : head && fixedCurrent ? (
                <button
                  className={styles.primary}
                  disabled={!onGoToTesting}
                  onClick={goTesting}
                >
                  进入内测发放
                </button>
              ) : head && (value?.review || value?.baseline) ? (
                <button className={styles.primary} onClick={openReview}>
                  {value.review ? "固定内测内容版本" : "核对并记录既有依据"}
                </button>
              ) : null}
              {target && onPreviewTarget && (
                <button
                  onClick={() => {
                    if (surfaces.canSwitch()) onPreviewTarget(target);
                  }}
                >
                  核对 r{target.revision} 内容
                </button>
              )}
              {!value?.review && (
                <button onClick={() => surfaces.open("versions")}>
                  查看历史审核
                </button>
              )}
            </div>
            <button
              className={styles.quietButton}
              disabled={review.loading || versions.loading}
              onClick={() => {
                review.refresh();
                versions.refresh();
              }}
            >
              重新读取条件
            </button>
          </section>
          <aside className={styles.panel}>
            <div className={styles.cardHeading}>
              <div>
                <h3>已固定的内测版本</h3>
                <p>历史固定版本不随最新草稿改变。</p>
              </div>
              {versions.value && (
                <span className={`${styles.badge} ${styles.infoTone}`}>
                  {versions.value.versions.length} 个
                </span>
              )}
            </div>
            {versions.loading && <p role="status">正在读取固定版本…</p>}
            {versions.error && <p role="alert">{versions.error}</p>}
            {versions.value?.versions.map((version) => (
              <div className={styles.versionRow} key={version.id}>
                <div>
                  <strong>内测内容版本 #{version.slot}</strong>
                  <p>来源草稿 r{version.target.revision} · 不可变</p>
                </div>
                <button onClick={() => openVersion(version.id)}>详情</button>
              </div>
            ))}
            {versions.value?.versions.length === 0 && (
              <div className={styles.empty}>
                <FileText size={28} aria-hidden="true" />
                <h3>暂无固定版本</h3>
                <p>只有精确目标满足既有审核条件后，才可固定内测内容。</p>
              </div>
            )}
            <p className={styles.boundaryNote}>
              内容检查、已有审核依据、固定内测内容与正式公开发布是不同事实。
            </p>
          </aside>
        </div>
      </div>
      <InternalWritePanel
        embedded
        receiptActions={{
          onOpenVersion: openVersion,
          onGoToTesting: onGoToTesting ? goTesting : undefined,
        }}
        productId={productId}
        state={value}
        versions={versions.value}
        session={session}
        nonce={nonce}
        onChanged={changed}
        onTaskState={setWriteState}
        renderSurface={(content) => (
          <RetainedTaskSurface id="review">
            <div className={styles.workbench}>
              {content}
              <InternalRecoveryPanels
                embedded
                receiptActions={{
                  onOpenVersion: openVersion,
                  onGoToTesting: onGoToTesting ? goTesting : undefined,
                }}
                productId={productId}
                session={session}
                nonce={nonce}
                onChanged={changed}
                onTaskState={reportRecovery}
              />
            </div>
          </RetainedTaskSurface>
        )}
      />
      <RetainedTaskSurface id="versions">
        <div className={styles.workbench}>
          <p>历史版本不授予当前新草稿审核或内测资格。</p>
          {versions.loading && <p role="status">正在读取固定版本…</p>}
          {versions.error && <p role="alert">{versions.error}</p>}
          {versions.value?.versions.map((version) => (
            <section className={styles.record} key={version.id}>
              <h3>
                固定内容第 {version.slot} 版 · 来源 r{version.target.revision}
              </h3>
              <p>
                {currentTarget
                  ? sameRevisionTarget(version.target, currentTarget)
                    ? "匹配本次摘要的当前完整目标"
                    : "历史固定来源，与当前草稿分开"
                  : "当前目标尚未可靠读取"}
              </p>
              <time dateTime={version.createdAt}>
                {directoryTime(version.createdAt)}
              </time>
              <button onClick={() => openVersion(version.id)}>
                查看固定版本详情
              </button>
            </section>
          ))}
          {versions.value?.versions.length === 0 && (
            <p>本次读取没有固定版本；不能据此清除原请求。</p>
          )}
        </div>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="version">
        <div className={styles.workbench}>
          {detail.loading && <p role="status">正在读取与核对固定快照…</p>}
          {detail.error && <p role="alert">{detail.error}</p>}
          {detail.value && (
            <>
              <h3>固定内容第 {detail.value.version.slot} 版</h3>
              <p>仅内部测试，未授予对外发布批准。</p>
              <p>
                来源修订 r{detail.value.snapshot.target.revision} · 固定于{" "}
                {directoryTime(detail.value.version.createdAt)}
              </p>
              <p>此版本保留当时的内容与素材，后续草稿不会改写它。</p>
              {onInspectRevision && (
                <button
                  onClick={() => {
                    if (surfaces.canSwitch())
                      onInspectRevision(detail.value!.snapshot.target);
                  }}
                >
                  查看来源修订
                </button>
              )}
              {onGoToTesting && (
                <button onClick={goTesting}>创建答题版本与发码</button>
              )}
              <TargetFacts target={detail.value.snapshot.target} />
              <TechnicalDetails label="固定快照完整技术详情">
                <pre className={styles.code}>
                  {JSON.stringify(detail.value.snapshot, null, 2)}
                </pre>
              </TechnicalDetails>
            </>
          )}
          <button onClick={() => surfaces.open("versions")}>
            返回版本列表
          </button>
        </div>
      </RetainedTaskSurface>
    </>
  );
}
