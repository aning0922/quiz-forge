"use client";
import { TechnicalDetails } from "../presentation/technical-details";
import { useEffect, useRef, useState } from "react";
import type { StudioSessionDto } from "../contracts";
import type {
  AppendDraftApplication,
  DraftRevisionResolution,
} from "@/features/product/draft-revisions/contracts";
import { StudioClientError } from "../client";
import {
  readRevisionPending,
  hasExactRevisionPending,
  type RevisionPendingEntry,
} from "./pending";
import {
  resolvePendingRevision,
  retryAppendRevision,
  clearResolvedRevision,
  RevisionEpoch,
  type RevisionTicket,
} from "./flow";
import { revisionMessage } from "./message";
import { AppendBindingFacts, RevisionLinks } from "./primitives";
import styles from "../workspace/workspace.module.css";
import local from "./revisions.module.css";
export function RevisionPendingPanel({
  productId,
  session,
  refreshing,
  writeBlocked = false,
  onChanged,
}: {
  productId: string;
  session: StudioSessionDto;
  refreshing: boolean;
  writeBlocked?: boolean;
  onChanged: (application?: AppendDraftApplication) => void;
}) {
  const [epoch] = useState(() => new RevisionEpoch(productId)),
    [entry, setEntry] = useState<RevisionPendingEntry>(),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [message, setMessage] = useState("");
  const [evidence, setEvidence] = useState<{
    ticket: RevisionTicket;
    result: DraftRevisionResolution;
  }>();
  const active = useRef(true),
    controller = useRef<AbortController | undefined>(undefined);
  function readLocal() {
    epoch.invalidate();
    controller.current?.abort();
    setEvidence(undefined);
    try {
      setEntry(
        readRevisionPending(sessionStorage).find(
          (e) => e.tuple.productId === productId,
        ),
      );
      setLoaded(true);
    } catch (error) {
      setLoaded(false);
      setMessage(revisionMessage(error));
    }
  }
  useEffect(() => {
    active.current = true;
    const timer = setTimeout(readLocal, 0);
    return () => {
      clearTimeout(timer);
      active.current = false;
      epoch.invalidate();
      controller.current?.abort();
    };
    // Component is keyed by Product and recreated after a new POST.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, productId]);
  function reject(error: unknown) {
    if (
      error instanceof StudioClientError &&
      ["CAPABILITY_DENIED", "UNAUTHENTICATED", "CSRF_REJECTED"].includes(
        error.code,
      )
    ) {
      epoch.invalidate();
      setEvidence(undefined);
      setDenied(true);
    }
    setMessage(revisionMessage(error));
  }
  async function perform(replay: boolean) {
    if (
      !entry ||
      !loaded ||
      busy ||
      refreshing ||
      (replay &&
        (session.operator.role !== "operator" || denied || writeBlocked))
    )
      return;
    const ticket = epoch.begin(entry.tuple),
      request = new AbortController();
    controller.current?.abort();
    controller.current = request;
    setBusy(true);
    setMessage("");
    setEvidence(undefined);
    try {
      if (replay) {
        const result = await retryAppendRevision(
          sessionStorage,
          ticket.binding,
          session.csrfToken,
        );
        if (active.current && epoch.accepts(ticket)) {
          setMessage(
            `服务器已确认原操作的固定处理结果：修订 ${result.application.revision}。`,
          );
          readLocal();
          onChanged(result.application);
        }
      } else {
        const result = await resolvePendingRevision(
          sessionStorage,
          ticket.binding,
          session.csrfToken,
          request.signal,
        );
        if (
          active.current &&
          epoch.accepts(ticket) &&
          hasExactRevisionPending(sessionStorage, ticket.binding)
        )
          setEvidence({ ticket, result });
      }
    } catch (error) {
      if (active.current && epoch.accepts(ticket)) reject(error);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function clear() {
    if (
      !entry ||
      !evidence ||
      evidence.result.kind === "unresolved" ||
      busy ||
      refreshing
    )
      return;
    const { ticket, result } = evidence;
    setBusy(true);
    setMessage("");
    try {
      await clearResolvedRevision(
        sessionStorage,
        entry.tuple,
        result,
        () => active.current && epoch.accepts(ticket),
      );
      if (active.current) {
        readLocal();
        setMessage(
          "已精确解除本页原操作记录。请重新读取来源和当前基准，再明确确认新的请求。",
        );
        onChanged(result.kind === "applied" ? result.application : undefined);
      }
    } catch (error) {
      if (active.current) reject(error);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const result = evidence?.result;
  const needsAttention =
    !loaded ||
    !!entry ||
    busy ||
    denied ||
    writeBlocked ||
    !!evidence ||
    !!message;
  return (
    <section className={styles.panel} aria-label="草稿更新操作查询">
      <details
        open={needsAttention}
        className={
          needsAttention ? local.recoveryAttention : local.recoveryQuiet
        }
      >
        <summary>
          {needsAttention
            ? "更新草稿：上次操作待检查或处理"
            : "更新草稿：暂无待处理操作 · 查询"}
        </summary>
        <div className={local.recoveryBody}>
          <h2>草稿更新操作查询</h2>
          <p className={styles.note}>
            查询不会更新草稿。未找到结果或当前已有其他修订，都不能据此判断上次操作是否成功；请以原操作的处理结果为准。
          </p>
          {!loaded && (
            <p role="status">
              正在检查上次更新操作，请稍候；检查完成前不能重复提交。
            </p>
          )}
          {loaded && !entry && (
            <p>此浏览器会话没有此工作区的待确认追加请求。</p>
          )}
          {entry && (
            <>
              <p>
                此工作区有
                {entry.mayHaveBeenSent ? "可能已发送" : "尚未发送的准备"}
                操作。原内容来源与基准保持不变。
              </p>
              <p>
                操作目标：基于草稿修订 {entry.tuple.target.expectedRevision}{" "}
                更新；来源检查版本 {entry.tuple.expectedValidationStateRevision}
              </p>
              <TechnicalDetails label="查看原操作完整绑定">
                <AppendBindingFacts binding={entry.tuple} />
              </TechnicalDetails>
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={!loaded || busy || refreshing}
                  onClick={() => void perform(false)}
                >
                  查询上次草稿更新结果
                </button>
                {session.operator.role === "operator" &&
                  !denied &&
                  !writeBlocked && (
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      disabled={!loaded || busy || refreshing}
                      onClick={() => void perform(true)}
                    >
                      再次发送原草稿更新操作
                    </button>
                  )}
              </div>
            </>
          )}
          {denied && (
            <p className={styles.note}>
              当前身份或写入验证失效。写入口已关闭，原操作记录继续保留。
            </p>
          )}
          {result && (
            <div
              className={local.receipt}
              data-revision-resolution={result.kind}
            >
              {result.kind === "applied" ? (
                <>
                  <h3>原操作已应用</h3>
                  <p>
                    固定处理结果为修订 {result.application.revision}
                    。此处理结果不表示它仍是当前修订。
                  </p>
                  <RevisionLinks draft={result.application} />
                </>
              ) : result.kind === "unresolved" ? (
                <>
                  <h3>原操作仍未确认</h3>
                  <p>
                    核实时当前修订仍为 {result.observedCurrentRevision}
                    。未找到处理结果不能证明原操作未执行，本地操作记录继续保留。
                  </p>
                </>
              ) : result.kind === "not-applied-obsolete" ? (
                <>
                  <h3>原操作未应用，原基准已过期</h3>
                  <p>
                    核实时观察到修订 {result.observedCurrentRevision}
                    ，严格高于原基准 {result.base.revision}
                    。此原操作不能再按旧基准提交。
                  </p>
                </>
              ) : (
                <>
                  <h3>原操作未应用，来源已被消费</h3>
                  <p>
                    {result.proof.reason === "source-import"
                      ? "同一来源已被不可变处理结果消费。"
                      : "已核验的同一 manifest 已被不可变修订消费。"}
                    消费修订为 {result.proof.consumed.revision}
                    ；这不是本次操作的应用成功。
                  </p>
                  <RevisionLinks draft={result.proof.consumed} />
                  <TechnicalDetails label="查看固定消费来源">
                    <p>
                      来源使用操作编号：{result.proof.consumingIdempotencyKey}
                    </p>
                    <p>
                      来源：{result.proof.consumed.sourceImportId} /{" "}
                      {result.proof.consumed.sourceValidationId}
                    </p>
                    <p>
                      manifest：{result.proof.consumed.canonicalManifestSha256}
                    </p>
                  </TechnicalDetails>
                </>
              )}
              {result.kind !== "unresolved" && (
                <div
                  className={
                    result.kind === "applied" ? local.receiptActions : undefined
                  }
                >
                  <button
                    className={`${styles.button} ${styles.secondary}`}
                    disabled={busy || refreshing}
                    onClick={() => void clear()}
                  >
                    {result.kind === "applied"
                      ? "解除已确认成功的本地操作记录"
                      : "移除已失效原操作并重新准备"}
                  </button>
                </div>
              )}
            </div>
          )}
          {busy && <p role="status">正在核实或处理原操作…</p>}
          {message && (
            <p className={styles.status} role="status">
              {message}
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy || refreshing}
              onClick={readLocal}
            >
              重新检查本地更新记录
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
