"use client";
import { useContentAuthority } from "../product-workspace/content-authority";
import { TechnicalDetails } from "../presentation/technical-details";
import { useEffect, useState } from "react";
import Link from "next/link";
import { previewPagePath } from "@/features/product/preview/urls";
import { z } from "zod";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import type { DraftApplicationDto } from "@/features/product/drafts/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { ReadOnlyNotice } from "../workspace/primitives";
import { useDraftRead } from "./use-read";
import {
  checkDraftRead,
  draftEndpoint,
  draftWorkspacePath,
  draftRevisionPath,
} from "./client";
import {
  applyFirstDraft,
  reconcileDraftPending,
  retryOriginalDraft,
} from "./flow";
import { readDraftPending, type DraftPendingEntry } from "./pending";
import { draftMessage } from "./message";
import {
  useContentTaskState,
  type ContentStateObserver,
} from "../product-workspace/content-task-state";
import styles from "../workspace/workspace.module.css";
const productState = z.object({
  id: z.string(),
  archivedAt: z.string().nullable(),
});
export function ApplyDraftPanel({
  validation,
  session,
  refreshing,
  embedded = false,
  onConfirmed,
  onState,
}: {
  validation: ValidationDto;
  session: StudioSessionDto;
  refreshing: boolean;
  embedded?: boolean;
  onConfirmed?: (value: DraftApplicationDto) => void;
  onState?: ContentStateObserver | undefined;
}) {
  const authority = useContentAuthority();
  const productId = validation.productId;
  const current = useDraftRead(draftEndpoint(productId), (value) =>
    checkDraftRead(value, productId),
  );
  const product = useDraftRead(
    `/api/studio/products/${encodeURIComponent(productId)}`,
    (value) => {
      const parsed = productState.parse(value);
      if (parsed.id !== productId) throw new Error("INVALID_PRODUCT");
      return parsed;
    },
  );
  const [pending, setPending] = useState<DraftPendingEntry>(),
    [storageReady, setStorageReady] = useState(false),
    [storageLoaded, setStorageLoaded] = useState(false),
    [writeDenied, setWriteDenied] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [application, setApplication] = useState<DraftApplicationDto>();
  function loadPending() {
    try {
      setPending(
        readDraftPending(sessionStorage).find(
          (entry) => entry.tuple.productId === productId,
        ),
      );
      setStorageReady(true);
    } catch (error) {
      authority.observe(error);
      setStorageReady(false);
      setMessage(draftMessage(error));
    } finally {
      setStorageLoaded(true);
    }
  }
  useEffect(() => {
    const timer = setTimeout(loadPending, 0);
    return () =>
      clearTimeout(timer); /* Component is keyed by the source tuple. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const operator =
    authority.canWrite() &&
    session.operator.role === "operator" &&
    !writeDenied;
  const blocked =
    busy ||
    refreshing ||
    current.loading ||
    product.loading ||
    !storageReady ||
    Boolean(current.error || product.error);
  const ready =
    validation.status === "ready" &&
    !validation.readOnly &&
    !validation.maintenanceRequired &&
    validation.candidateSha256 !== null;
  useContentTaskState(onState, {
    busy,
    pending: !!pending || confirm || !storageLoaded || !storageReady,
    retained: !!pending || confirm || !!application,
    message: pending ? "草稿创建原操作已保留，请先核实。" : undefined,
  });
  function adopt(next: DraftApplicationDto) {
    setApplication(next);
    if (authority.canWrite()) onConfirmed?.(next);
  }
  async function perform(action: "new" | "read" | "replay") {
    if (blocked || (action !== "read" && (!operator || !authority.canWrite())))
      return;
    setBusy(true);
    setMessage("");
    setConfirm(false);
    try {
      if (action === "read") {
        if (!pending) return;
        const result = await reconcileDraftPending(
          sessionStorage,
          pending.tuple,
        );
        if (result.kind === "empty")
          setMessage(
            "尚无匹配处理结果；原操作记录继续保留。这不能证明原操作未执行。可稍后再核对，或再次发送原草稿创建操作。",
          );
        else {
          adopt(result.application);
          setMessage("服务器已确认原操作的固定应用处理结果。");
          current.refresh();
        }
      } else {
        const tuple =
          action === "replay"
            ? pending?.tuple
            : ready
              ? {
                  productId,
                  sourceImportId: validation.importId,
                  sourceValidationId: validation.id,
                  idempotencyKey: crypto.randomUUID(),
                  expectedValidationStateRevision: validation.stateRevision,
                  expectedCandidateSha256: validation.candidateSha256!,
                  target: { kind: "new-draft" as const },
                }
              : undefined;
        if (!tuple) return;
        const result =
          action === "replay"
            ? await retryOriginalDraft(sessionStorage, tuple, session.csrfToken)
            : await applyFirstDraft(sessionStorage, tuple, session.csrfToken);
        adopt(result.application);
        setMessage(
          result.created
            ? "服务器已确认创建草稿修订 1。"
            : "服务器已确认原操作的固定应用处理结果。",
        );
        current.refresh();
      }
    } catch (error) {
      authority.observe(error);
      if (
        error instanceof StudioClientError &&
        ["CAPABILITY_DENIED", "UNAUTHENTICATED", "CSRF_REJECTED"].includes(
          error.code,
        )
      )
        setWriteDenied(true);
      setMessage(draftMessage(error));
    } finally {
      loadPending();
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="建立第一版草稿">
      <h2>建立第一版草稿</h2>
      <p className={styles.note}>
        将已归档内容应用为此工作区唯一草稿的不可变修订
        1。平台授权仍未审核，不可发布；此操作不评分、不生成报告。
      </p>
      <div className={styles.actions}>
        {!embedded && (
          <Link className={styles.link} href={draftWorkspacePath(productId)}>
            查看当前草稿
          </Link>
        )}
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={busy || refreshing || current.loading || product.loading}
          onClick={() => {
            loadPending();
            current.refresh();
            product.refresh();
          }}
        >
          刷新草稿与工作区状态
        </button>
      </div>
      {session.operator.role === "read-only" && <ReadOnlyNotice />}
      {writeDenied && (
        <p>
          当前会话或写入权限已失效，写操作已关闭。请重新登录核实；原操作记录仍保留。
        </p>
      )}
      {(current.loading || product.loading || !storageLoaded) && (
        <p role="status">正在核对工作区与本页操作记录…</p>
      )}
      {(current.error || product.error) && (
        <p role="alert" className={styles.error}>
          {current.error || product.error}
        </p>
      )}
      {pending ? (
        <section className={styles.compare} aria-label="待确认的原操作编号">
          <h3>此工作区有待确认请求</h3>
          <p>
            保留原操作编号
            与完整来源绑定。空查询、错误或会话失效均不会清除它。再次发送原操作仅使用下列原操作，不采用当前页面的新来源。
          </p>
          <p>
            操作目标：建立草稿修订 1；来源检查版本{" "}
            {pending.tuple.expectedValidationStateRevision}。
          </p>
          <TechnicalDetails label="原操作技术标识">
            {" "}
            <dl className={styles.facts}>
              <div>
                <dt>原操作编号</dt>
                <dd>{pending.tuple.idempotencyKey}</dd>
              </div>
              <div>
                <dt>原来源</dt>
                <dd>
                  {pending.tuple.sourceImportId}
                  <br />
                  {pending.tuple.sourceValidationId} / 修订{" "}
                  {pending.tuple.expectedValidationStateRevision}
                </dd>
              </div>
            </dl>
          </TechnicalDetails>
          <TechnicalDetails label="原操作校验摘要">
            <dl className={styles.facts}>
              <div>
                <dt>原候选 SHA-256</dt>
                <dd>{pending.tuple.expectedCandidateSha256}</dd>
              </div>
            </dl>
          </TechnicalDetails>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={blocked}
              onClick={() => void perform("read")}
            >
              查询上次草稿创建结果
            </button>
            {operator && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={blocked}
                onClick={() => void perform("replay")}
              >
                再次发送原草稿创建操作
              </button>
            )}
          </div>
        </section>
      ) : application ? (
        <p role="status">
          已确认草稿 {application.draftId} · 修订 {application.revision}。
        </p>
      ) : current.value?.kind === "draft" ? (
        <p>此工作区已有草稿，不能建立第二份草稿。</p>
      ) : product.value?.archivedAt ? (
        <p>工作区已归档，不能发起建立第一版草稿。</p>
      ) : !ready ? (
        <p>当前来源尚不符合建立第一版草稿条件。请先核实验证归档状态。</p>
      ) : (
        operator && (
          <>
            <p>
              来源验证修订 {validation.stateRevision}，候选 SHA-256：
              {validation.candidateSha256}
            </p>
            {confirm ? (
              <section
                className={styles.compare}
                aria-label="确认建立第一版草稿"
              >
                <p>
                  确认将上述来源应用为此工作区的首份草稿？创建后此批不提供编辑或删除操作。
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    disabled={blocked}
                    onClick={() => void perform("new")}
                  >
                    确认建立草稿修订 1
                  </button>
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    disabled={busy}
                    onClick={() => setConfirm(false)}
                  >
                    取消确认
                  </button>
                </div>
              </section>
            ) : (
              <button
                className={styles.button}
                disabled={blocked}
                onClick={() => setConfirm(true)}
              >
                建立第一版草稿
              </button>
            )}
          </>
        )
      )}
      {busy && <p role="status">正在核对或提交原操作…</p>}
      {application && !busy && !writeDenied && (
        <section className={styles.compare} aria-label="继续处理已确认草稿">
          <h3>继续处理修订 {application.revision}</h3>
          <p>
            以下入口固定到本次已确认的修订，原操作记录继续保留，后续不会自动提交。
          </p>
          {!embedded && (
            <div className={styles.actions}>
              <Link
                className={styles.link}
                href={draftRevisionPath(
                  productId,
                  application.draftId,
                  application.revision,
                )}
              >
                查看刚创建的内容与素材
              </Link>
              <Link
                className={`${styles.link} ${styles.secondary}`}
                href={previewPagePath(application)}
              >
                预览此固定修订
              </Link>
            </div>
          )}
        </section>
      )}
      {message && (
        <p role="status" className={styles.status}>
          {message}
        </p>
      )}
    </section>
  );
}
