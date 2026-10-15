"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import type { DraftApplicationDto } from "@/features/product/drafts/contracts";
import type { StudioSessionDto } from "../contracts";
import { ReadOnlyNotice } from "../workspace/primitives";
import { useDraftRead } from "./use-read";
import { checkDraftRead, draftEndpoint, draftWorkspacePath } from "./client";
import {
  applyFirstDraft,
  reconcileDraftPending,
  retryOriginalDraft,
} from "./flow";
import { readDraftPending, type DraftPendingEntry } from "./pending";
import { draftMessage } from "./message";
import styles from "../workspace/workspace.module.css";
const productState = z.object({
  id: z.string(),
  archivedAt: z.string().nullable(),
});
export function ApplyDraftPanel({
  validation,
  session,
  refreshing,
}: {
  validation: ValidationDto;
  session: StudioSessionDto;
  refreshing: boolean;
}) {
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
      setStorageReady(false);
      setMessage(draftMessage(error));
    }
  }
  useEffect(() => {
    const timer = setTimeout(loadPending, 0);
    return () =>
      clearTimeout(timer); /* Component is keyed by the source tuple. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  const operator = session.operator.role === "operator";
  const blocked =
    busy ||
    refreshing ||
    current.loading ||
    product.loading ||
    !storageReady ||
    Boolean(current.error || product.error);
  const ready =
    validation.status === "ready" &&
    !validation.maintenanceRequired &&
    validation.candidateSha256 !== null;
  async function perform(action: "new" | "read" | "replay") {
    if (blocked || (!operator && action !== "read")) return;
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
            "尚无匹配回执；原 key 继续保留。这不能证明原请求未执行。可稍后再核对，或明确按原 key 重放。",
          );
        else {
          setApplication(result.application);
          setMessage("服务器已确认原 key 的固定应用回执。");
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
        setApplication(result.application);
        setMessage(
          result.created
            ? "服务器已确认创建草稿修订 1。"
            : "服务器已确认原 key 的固定应用回执。",
        );
        current.refresh();
      }
    } catch (error) {
      setMessage(draftMessage(error));
    } finally {
      loadPending();
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="首次草稿应用">
      <h2>首次草稿应用</h2>
      <p className={styles.note}>
        将已归档的合成内容应用为此工作区唯一草稿的不可变修订
        1。平台授权仍未审核，不可发布；此操作不评分、不生成报告。
      </p>
      <Link className={styles.link} href={draftWorkspacePath(productId)}>
        查看服务器草稿
      </Link>
      {!operator && <ReadOnlyNotice />}
      {(current.loading || product.loading || !storageReady) && (
        <p role="status">正在核对工作区与本页请求锚点…</p>
      )}
      {(current.error || product.error) && (
        <p role="alert" className={styles.error}>
          {current.error || product.error}
        </p>
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
      {pending ? (
        <section className={styles.compare} aria-label="待确认的原 key">
          <h3>此工作区有待确认请求</h3>
          <p>
            保留原 key
            与完整来源绑定。空查询、错误或会话失效均不会清除它。重放仅使用下列原请求，不采用当前页面的新来源。
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>原 key</dt>
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
            <div>
              <dt>原候选 SHA-256</dt>
              <dd>{pending.tuple.expectedCandidateSha256}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={blocked}
              onClick={() => void perform("read")}
            >
              核对原 key 回执
            </button>
            {operator && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={blocked}
                onClick={() => void perform("replay")}
              >
                明确按原 key 重放
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
        <p>工作区已归档，不能发起首次草稿应用。</p>
      ) : !ready ? (
        <p>当前来源尚不符合首次草稿应用条件。请先核实验证归档状态。</p>
      ) : (
        operator && (
          <>
            <p>
              来源验证修订 {validation.stateRevision}，候选 SHA-256：
              {validation.candidateSha256}
            </p>
            {confirm ? (
              <section className={styles.compare} aria-label="确认首次草稿应用">
                <p>
                  确认将上述来源应用为此工作区的首份草稿？创建后此批不提供编辑或删除操作。
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.button}
                    disabled={blocked}
                    onClick={() => void perform("new")}
                  >
                    确认应用为草稿修订 1
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
                应用为首次草稿
              </button>
            )}
          </>
        )
      )}
      {busy && <p role="status">正在核对或提交原请求…</p>}
      {message && (
        <p role="status" className={styles.status}>
          {message}
        </p>
      )}
    </section>
  );
}
