"use client";

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
}: {
  productId: string;
  session: StudioSessionDto;
  currentTarget?: RevisionTarget | undefined;
  visible: boolean;
  onChanged: () => void;
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
  const different =
    !!target && !!currentTarget && !sameRevisionTarget(target, currentTarget);
  return (
    <>
      <div hidden={!visible} className={styles.workbench}>
        <div className={styles.heading}>
          <div>
            <h2>审核与版本</h2>
            <p>核对精确修订与已有依据，固定内容与历史分别保留。</p>
          </div>
          <button onClick={() => surfaces.open("versions")}>
            历史固定版本
          </button>
        </div>
        <section className={styles.panel}>
          <h3>
            {target ? `固定处理目标 r${target.revision}` : "尚无可审核修订"}
          </h3>
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
              <p>请先取消未发送确认或核实原请求，不能直接借用新目标。</p>
            </div>
          )}
          {review.loading && <p role="status">正在核对固定修订条件…</p>}
          {review.error && (
            <p role="alert">
              {review.error} 原请求保持，不能据此判断没有审核依据。
            </p>
          )}
          {!target && <p>请先完成内容制作；已有原请求可继续核实。</p>}
          {value && (
            <>
              <p>
                本次服务读取的当前修订：r{value.observedCurrentRevision}
                ；处理目标：r{value.target.revision}。
              </p>
              {!head && (
                <p className={styles.notice}>
                  此目标已是历史修订，不能新记录或封存。
                </p>
              )}
              <div className={styles.facts}>
                <p>内容目标：r{value.target.revision}，完整身份已核对。</p>
                <p>
                  审核依据：
                  {value.review
                    ? "此目标已有记录"
                    : value.baseline
                      ? "有既有登记基线，仍需明确记录"
                      : "没有可直接使用的匹配依据，不能代为批准"}
                </p>
                <p>
                  固定版本：
                  {versions.value
                    ? `${versions.value.versions.length} 个已有固定记录（含历史）`
                    : "尚未可靠读取"}
                </p>
              </div>
            </>
          )}
          <div className={styles.actions}>
            <button
              className={styles.primary}
              onClick={() => {
                if (!surfaces.canSwitch()) return;
                if (!selection && currentTarget) setSelection(currentTarget);
                surfaces.open("review");
              }}
            >
              {value?.review
                ? "核对并固定内测内容"
                : "核对已有审核依据与原请求"}
            </button>
            <button
              disabled={review.loading || versions.loading}
              onClick={() => {
                review.refresh();
                versions.refresh();
              }}
            >
              重新读取条件
            </button>
          </div>
        </section>
      </div>
      <InternalWritePanel
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
