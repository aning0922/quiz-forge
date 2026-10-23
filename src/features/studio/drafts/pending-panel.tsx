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
        setMessage("服务器已确认原 key 的固定应用回执。");
        onConfirmed();
      } else {
        const result = await reconcileDraftPending(sessionStorage, entry.tuple);
        if (result.kind === "empty")
          setMessage("尚无匹配回执；原 key 继续保留。这不能证明原请求未执行。");
        else {
          setMessage("服务器已确认原 key 的固定应用回执。");
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
  return (
    <section className={styles.panel} aria-label="原 key 核实">
      <h2>原 key 核实</h2>
      {!ready && <p>尚未可靠读取本页请求锚点，写操作保持关闭。</p>}
      {ready && !entry && <p>此浏览器会话未保存此工作区的待确认应用请求。</p>}
      {entry && (
        <>
          <p>
            此工作区有待确认请求。查询为空、一次错误或当前已有草稿都不会清除原
            key；只有完整匹配的成功回执才能解除锚点。
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>原 key</dt>
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
          <TechnicalDetails label="原请求校验摘要">
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
              核对原 key 回执
            </button>
            {session.operator.role === "operator" && !writeDenied && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={!ready || busy || refreshing}
                onClick={() => void perform(true)}
              >
                明确按原 key 重放
              </button>
            )}
          </div>
        </>
      )}
      {busy && <p role="status">正在核对原请求…</p>}
      {message && <p role="status">{message}</p>}
      <div className={`${styles.actions} ${draftStyles.separatedActions}`}>
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={busy || refreshing}
          onClick={read}
        >
          重新读取本页请求锚点
        </button>
      </div>
    </section>
  );
}
