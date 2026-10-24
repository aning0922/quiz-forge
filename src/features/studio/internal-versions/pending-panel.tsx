"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceTaskState } from "../product-workspace/task-surfaces";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { readInternalPending } from "./pending";
import {
  freezeInternalRequest,
  type InternalOperation,
  type InternalRequest,
} from "./request";
import {
  InternalOperationEpoch,
  resolveInternalPending,
  retryInternalOperation,
  clearConfirmedInternalPending,
  evidenceFromWrite,
  type InternalEvidence,
  type InternalOperationTicket,
} from "./flow";
import {
  useInternalAuthority,
  type InternalAuthorityTicket,
} from "./authority";
import { RequestFacts, ReviewFacts, VersionReceiptFacts } from "./facts";
import { internalVersionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
import local from "./internal-versions.module.css";
export function InternalEvidenceFacts({
  evidence,
}: {
  evidence: InternalEvidence;
}) {
  const result = evidence.value;
  if (evidence.operation === "review" && evidence.value.kind === "recorded")
    return (
      <>
        <h3>原操作已记录</h3>
        <ReviewFacts review={evidence.value.review} />
      </>
    );
  if (evidence.operation === "seal" && evidence.value.kind === "sealed")
    return (
      <>
        <h3>原操作已封存</h3>
        <VersionReceiptFacts version={evidence.value.version} />
      </>
    );
  if (result.kind === "unresolved")
    return (
      <>
        <h3>原操作仍未确认</h3>
        <p>
          本次核实时当前修订为 {result.observedCurrentRevision}
          。未找到处理结果不能证明原操作未执行；本地操作记录继续保留。
        </p>
      </>
    );
  if (
    result.kind === "not-recorded-obsolete" ||
    result.kind === "not-sealed-obsolete"
  )
    return (
      <>
        <h3>原操作未生效，目标已过期</h3>
        <p>
          服务器严格核实当前修订 {result.observedCurrentRevision} 高于原目标{" "}
          {result.binding.target.revision}，原操作没有固定处理结果。
        </p>
      </>
    );
  if (
    evidence.operation === "review" &&
    evidence.value.kind === "not-recorded-target-used"
  )
    return (
      <>
        <h3>原操作未记录，固定目标已被另一操作 记录</h3>
        <p>这是其他操作的处理结果，不表示本次操作成功。</p>
        <ReviewFacts review={evidence.value.consumed} />
      </>
    );
  if (
    evidence.operation === "seal" &&
    evidence.value.kind === "not-sealed-target-used"
  )
    return (
      <>
        <h3>原操作未封存，固定快照已被另一操作 占用</h3>
        <p>这是其他操作创建的版本，不表示本次操作成功。</p>
        <VersionReceiptFacts version={evidence.value.consumed} />
      </>
    );
  return (
    <>
      <h3>原操作未封存，100 个固定槽位已满</h3>
      <p>
        这是服务器核实原操作编号
        不存在且容量已永久占满的严格证据。解除本地操作记录不会恢复封存容量。
      </p>
    </>
  );
}
export function InternalPendingPanel({
  productId,
  operation,
  session,
  onChanged,
  onTaskState,
}: {
  productId: string;
  operation: InternalOperation;
  session: StudioSessionDto;
  onChanged: () => void;
  onTaskState?:
    | ((operation: InternalOperation, state: WorkspaceTaskState) => void)
    | undefined;
}) {
  const authority = useInternalAuthority(),
    label = operation === "review" ? "审核依据记录" : "内容版本固定",
    [epoch] = useState(() => new InternalOperationEpoch(productId)),
    [entry, setEntry] = useState<{
      request: InternalRequest;
      mayHaveBeenSent: boolean;
    }>(),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [message, setMessage] = useState(""),
    [evidence, setEvidence] = useState<{
      ticket: InternalOperationTicket;
      authorityTicket: InternalAuthorityTicket;
      result: InternalEvidence;
    }>();
  const active = useRef(true),
    controller = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => {
    onTaskState?.(operation, {
      busy,
      pending: !!entry || !loaded,
      retained: !!entry || !loaded,
      message: !loaded
        ? "原操作记录尚未可靠核实。"
        : entry
          ? "保留原审核或封存请求，请核对后明确结束。"
          : undefined,
    });
  }, [operation, busy, entry, loaded, onTaskState]);
  function readLocal() {
    epoch.invalidate();
    controller.current?.abort();
    setEvidence(undefined);
    setMessage("");
    try {
      const found =
        operation === "review"
          ? readInternalPending(sessionStorage, "review")
              .filter((e) => e.tuple.productId === productId)
              .map((e) => ({
                request: freezeInternalRequest({
                  operation: "review",
                  tuple: e.tuple,
                }),
                mayHaveBeenSent: e.mayHaveBeenSent,
              }))[0]
          : readInternalPending(sessionStorage, "seal")
              .filter((e) => e.tuple.productId === productId)
              .map((e) => ({
                request: freezeInternalRequest({
                  operation: "seal",
                  tuple: e.tuple,
                }),
                mayHaveBeenSent: e.mayHaveBeenSent,
              }))[0];
      setEntry(found);
      setLoaded(true);
    } catch (error) {
      setEntry(undefined);
      setLoaded(false);
      setMessage(internalVersionMessage(error));
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
    // Remounted by stable Product/operation and a local-write nonce, never by detail GET success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch, productId, operation, session.csrfToken, session.operator.role]);
  function reject(error: unknown) {
    authority.observe(error);
    if (
      error instanceof StudioClientError &&
      ["UNAUTHENTICATED", "CAPABILITY_DENIED", "CSRF_REJECTED"].includes(
        error.code,
      )
    ) {
      epoch.invalidate();
      setEvidence(undefined);
      setDenied(true);
    }
    setMessage(internalVersionMessage(error));
  }
  async function perform(replay: boolean) {
    if (
      !entry ||
      authority.isRevoked ||
      !loaded ||
      busy ||
      (replay && (denied || session.operator.role !== "operator"))
    )
      return;
    const ticket = epoch.begin(entry.request),
      authorityTicket = authority.capture(),
      current = () =>
        active.current &&
        epoch.accepts(ticket) &&
        authority.accepts(authorityTicket),
      abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setEvidence(undefined);
    setMessage("");
    try {
      const result = replay
        ? evidenceFromWrite(
            await retryInternalOperation(
              sessionStorage,
              ticket.request,
              session.csrfToken,
              current,
            ),
          )
        : await resolveInternalPending(
            sessionStorage,
            ticket.request,
            session.csrfToken,
            abort.signal,
            current,
          );
      if (current()) setEvidence({ ticket, authorityTicket, result });
    } catch (error) {
      const accepting = current();
      if (active.current) authority.observe(error);
      if (accepting) reject(error);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function clear() {
    if (
      !entry ||
      !evidence ||
      evidence.result.value.kind === "unresolved" ||
      busy ||
      denied ||
      authority.isRevoked
    )
      return;
    const { ticket, result, authorityTicket } = evidence,
      current = () =>
        active.current &&
        epoch.accepts(ticket) &&
        authority.accepts(authorityTicket);
    setBusy(true);
    setMessage("");
    try {
      await clearConfirmedInternalPending(
        sessionStorage,
        ticket.request,
        result,
        current,
      );
      if (current()) {
        readLocal();
        setMessage(
          "已精确解除本原操作记录。请重新读取服务器事实，重新确认下一次操作；不会自动提交。",
        );
        onChanged();
      }
    } catch (error) {
      const accepting = current();
      if (active.current) authority.observe(error);
      if (accepting) reject(error);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const needsAttention =
    !loaded ||
    !!entry ||
    busy ||
    denied ||
    authority.isRevoked ||
    !!evidence ||
    !!message;
  return (
    <section className={styles.panel} aria-label={`${label}操作查询`}>
      <details
        open={needsAttention}
        className={
          needsAttention ? local.recoveryAttention : local.recoveryQuiet
        }
      >
        <summary>
          {needsAttention
            ? `${label}：上次操作待检查或处理`
            : `${label}：暂无待处理操作 · 查询`}
        </summary>
        <div className={local.recoveryBody}>
          <h2>{label}操作查询</h2>
          <p className={styles.note}>
            这里查询本商品保留的上次操作。商品详情暂时不可用时仍可查询；查询失败或未找到结果时，原操作记录继续保留。
          </p>
          {!loaded && (
            <p role="status">
              正在检查上次操作，请稍候；检查完成前不能继续提交。
            </p>
          )}
          {loaded && !entry && (
            <p>此浏览器会话没有此工作区的待确认{label}请求。</p>
          )}
          {entry && (
            <>
              <p>
                {entry.mayHaveBeenSent ? "可能已发送" : "尚未发送的准备"}
                ；原操作、内容目标和依赖保持不变。
              </p>
              <RequestFacts request={entry.request} />
              <div className={styles.actions}>
                <button
                  className={styles.button}
                  disabled={busy || !loaded || authority.isRevoked}
                  onClick={() => void perform(false)}
                >
                  查询{label}结果
                </button>
                {session.operator.role === "operator" &&
                  !denied &&
                  !authority.isRevoked && (
                    <button
                      className={`${styles.button} ${styles.secondary}`}
                      disabled={busy || !loaded || authority.isRevoked}
                      onClick={() => void perform(true)}
                    >
                      再次发送原{label}操作
                    </button>
                  )}
              </div>
            </>
          )}
          {(denied || authority.isRevoked) && (
            <p role="alert">
              本页授权已失效。写入、核实与清理入口已关闭；原操作记录保留，请重新登录并重新打开本页。
            </p>
          )}
          {evidence && !authority.isRevoked && (
            <div data-internal-resolution={evidence.result.value.kind}>
              <InternalEvidenceFacts evidence={evidence.result} />
              {evidence.result.value.kind !== "unresolved" && (
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  disabled={busy || denied || authority.isRevoked}
                  onClick={() => void clear()}
                >
                  确认处理结果并结束此操作记录
                </button>
              )}
            </div>
          )}
          {busy && <p role="status">正在核实或处理原操作…</p>}
          {message && (
            <p className={styles.status} role="status">
              {message}
            </p>
          )}
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={busy}
            onClick={readLocal}
          >
            重新检查{label}操作记录
          </button>
        </div>
      </details>
    </section>
  );
}
export function InternalRecoveryPanels({
  productId,
  session,
  nonce = 0,
  onChanged = () => {},
  onTaskState,
}: {
  productId: string;
  session: StudioSessionDto;
  nonce?: number;
  onChanged?: () => void;
  onTaskState?:
    | ((operation: InternalOperation, state: WorkspaceTaskState) => void)
    | undefined;
}) {
  return (
    <>
      <InternalPendingPanel
        key={`review/${productId}/${nonce}`}
        operation="review"
        productId={productId}
        session={session}
        onChanged={onChanged}
        onTaskState={onTaskState}
      />
      <InternalPendingPanel
        key={`seal/${productId}/${nonce}`}
        operation="seal"
        productId={productId}
        session={session}
        onChanged={onChanged}
        onTaskState={onTaskState}
      />
    </>
  );
}
