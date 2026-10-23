"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { useEffect, useState } from "react";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { readDraftPending, type DraftPendingEntry } from "./pending";
import { reconcileDraftPending, retryOriginalDraft } from "./flow";
import { draftMessage } from "./message";
import styles from "../workspace/workspace.module.css";
import draftStyles from "./drafts.module.css";
/** The Product workspace can reconcile the original tuple even when its source page changed. */
export function DraftPendingPanel({
  productId,
  session,
  refreshing,
  onConfirmed,
}: {
  productId: string;
  session: StudioSessionDto;
  refreshing: boolean;
  onConfirmed: () => void;
}) {
  const [entry, setEntry] = useState<DraftPendingEntry>(),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [writeDenied, setWriteDenied] = useState(false),
    [message, setMessage] = useState("");
  function read() {
    try {
      setEntry(
        readDraftPending(sessionStorage).find(
          (item) => item.tuple.productId === productId,
        ),
      );
      setReady(true);
    } catch (error) {
      setReady(false);
      setMessage(draftMessage(error));
    }
  }
  useEffect(() => {
    const timer = setTimeout(read, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  async function perform(replay: boolean) {
    if (
      !entry ||
      !ready ||
      busy ||
      refreshing ||
      (replay && (session.operator.role !== "operator" || writeDenied))
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      if (replay) {
        await retryOriginalDraft(
          sessionStorage,
          entry.tuple,
          session.csrfToken,
        );
        setMessage("服务器已确认原操作的固定应用处理结果。");
        onConfirmed();
      } else {
        const result = await reconcileDraftPending(sessionStorage, entry.tuple);
        if (result.kind === "empty")
          setMessage(
            "尚无匹配处理结果；原操作记录继续保留。这不能证明原操作未执行。",
          );
        else {
          setMessage("服务器已确认原操作的固定应用处理结果。");
          onConfirmed();
        }
      }
    } catch (error) {
      if (
        error instanceof StudioClientError &&
        ["CAPABILITY_DENIED", "UNAUTHENTICATED", "CSRF_REJECTED"].includes(
          error.code,
        )
      )
        setWriteDenied(true);
      setMessage(draftMessage(error));
    } finally {
      read();
      setBusy(false);
    }
  }
  const needsAttention = !ready || !!entry || busy || writeDenied || !!message;
  return (
    <section className={styles.panel} aria-label="草稿创建操作查询">
      <details
        open={needsAttention}
        className={
          needsAttention
            ? draftStyles.recoveryAttention
            : draftStyles.recoveryQuiet
        }
      >
        <summary>
          {needsAttention
            ? "建立草稿：上次操作待检查或处理"
            : "建立草稿：暂无待处理操作 · 查询"}
        </summary>
        <div className={draftStyles.recoveryBody}>
          <h2>草稿创建操作查询</h2>
          {!ready && (
            <p>正在检查上次草稿操作，请稍候；检查完成前不能重复提交。</p>
          )}
          {ready && !entry && (
            <p>此浏览器会话未保存此工作区的待确认应用请求。</p>
          )}
          {entry && (
            <>
              <p>
                此工作区有待确认请求。查询为空、一次错误或当前已有草稿都不会清除原
                操作记录；只有完整匹配的成功处理结果才能结束此记录。
              </p>
              <p>
                操作目标：建立草稿修订 1；来源检查版本{" "}
                {entry.tuple.expectedValidationStateRevision}。
              </p>
              <TechnicalDetails label="原操作技术标识">
                {" "}
                <dl className={styles.facts}>
                  <div>
                    <dt>原操作编号</dt>
                    <dd>{entry.tuple.idempotencyKey}</dd>
                  </div>
                  <div>
                    <dt>原来源</dt>
                    <dd>
                      {entry.tuple.sourceImportId}
                      <br />
                      {entry.tuple.sourceValidationId} / 修订{" "}
                      {entry.tuple.expectedValidationStateRevision}
                    </dd>
                  </div>
                </dl>
              </TechnicalDetails>
              <TechnicalDetails label="原操作校验摘要">
                <dl className={styles.facts}>
                  <div>
                    <dt>原候选 SHA-256</dt>
                    <dd>{entry.tuple.expectedCandidateSha256}</dd>
                  </div>
                </dl>
              </TechnicalDetails>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={!ready || busy || refreshing}
                  onClick={() => void perform(false)}
                >
                  查询上次草稿创建结果
                </button>
                {session.operator.role === "operator" && !writeDenied && (
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    disabled={!ready || busy || refreshing}
                    onClick={() => void perform(true)}
                  >
                    再次发送原草稿创建操作
                  </button>
                )}
              </div>
            </>
          )}
          {busy && <p role="status">正在查询上次操作结果…</p>}
          {message && <p role="status">{message}</p>}
          <div className={`${styles.actions} ${draftStyles.separatedActions}`}>
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy || refreshing}
              onClick={read}
            >
              重新检查本地草稿操作记录
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
