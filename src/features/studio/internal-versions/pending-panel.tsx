"use client";
import { useEffect, useRef, useState } from "react";
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
import { RequestFacts, ReviewFacts, VersionReceiptFacts } from "./facts";
import { internalVersionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
export function InternalEvidenceFacts({
  evidence,
}: {
  evidence: InternalEvidence;
}) {
  const result = evidence.value;
  if (evidence.operation === "review" && evidence.value.kind === "recorded")
    return (
      <>
        <h3>原请求已记录</h3>
        <ReviewFacts review={evidence.value.review} />
      </>
    );
  if (evidence.operation === "seal" && evidence.value.kind === "sealed")
    return (
      <>
        <h3>原请求已封存</h3>
        <VersionReceiptFacts version={evidence.value.version} />
      </>
    );
  if (result.kind === "unresolved")
    return (
      <>
        <h3>原请求仍未确认</h3>
        <p>
          本次核实时当前修订为 {result.observedCurrentRevision}
          。未找到回执不能证明原请求未执行；锚点继续保留。
        </p>
      </>
    );
  if (
    result.kind === "not-recorded-obsolete" ||
    result.kind === "not-sealed-obsolete"
  )
    return (
      <>
        <h3>原请求未生效，目标已过期</h3>
        <p>
          服务器严格核实当前修订 {result.observedCurrentRevision} 高于原目标{" "}
          {result.binding.target.revision}，原 key 没有固定回执。
        </p>
      </>
    );
  if (
    evidence.operation === "review" &&
    evidence.value.kind === "not-recorded-target-used"
  )
    return (
      <>
        <h3>原请求未记录，固定目标已被另一 key 记录</h3>
        <p>以下为另一请求的回执，不是本原 key 的成功。</p>
        <ReviewFacts review={evidence.value.consumed} />
      </>
    );
  if (
    evidence.operation === "seal" &&
    evidence.value.kind === "not-sealed-target-used"
  )
    return (
      <>
        <h3>原请求未封存，固定快照已被另一 key 占用</h3>
        <p>以下为另一请求的版本，不是本原 key 的成功。</p>
        <VersionReceiptFacts version={evidence.value.consumed} />
      </>
    );
  return (
    <>
      <h3>原请求未封存，100 个固定槽位已满</h3>
      <p>
        这是服务器核实原 key
        不存在且容量已永久占满的严格证据。解除本地锚点不会恢复封存容量。
      </p>
    </>
  );
}
export function InternalPendingPanel({
  productId,
  operation,
  session,
  onChanged,
}: {
  productId: string;
  operation: InternalOperation;
  session: StudioSessionDto;
  onChanged: () => void;
}) {
  const label = operation === "review" ? "基线记录" : "内测封存",
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
      result: InternalEvidence;
    }>();
  const active = useRef(true),
    controller = useRef<AbortController | undefined>(undefined);
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
      !loaded ||
      busy ||
      (replay && (denied || session.operator.role !== "operator"))
    )
      return;
    const ticket = epoch.begin(entry.request),
      current = () => active.current && epoch.accepts(ticket),
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
      if (current()) setEvidence({ ticket, result });
    } catch (error) {
      if (current()) reject(error);
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
      denied
    )
      return;
    const { ticket, result } = evidence,
      current = () => active.current && epoch.accepts(ticket);
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
          "已精确解除本原请求锚点。请重新读取服务器事实，重新确认并生成新 key；不会自动发送下一请求。",
        );
        onChanged();
      }
    } catch (error) {
      if (current()) reject(error);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label={`${label}原请求核实`}>
      <h2>{label}原请求核实</h2>
      <p className={styles.note}>
        此区域只依赖稳定工作区 ID
        与本浏览器原请求。详情读取失败也可只读核实；普通错误和空查询都不能清除锚点。
      </p>
      {!loaded && <p role="status">尚未可靠读取此原请求桶；新准备保持关闭。</p>}
      {loaded && !entry && <p>此浏览器会话没有此工作区的待确认{label}请求。</p>}
      {entry && (
        <>
          <p>
            {entry.mayHaveBeenSent ? "可能已发送" : "尚未发送的准备"}；原
            key、目标和依赖保持不变。
          </p>
          <RequestFacts request={entry.request} />
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={busy || !loaded}
              onClick={() => void perform(false)}
            >
              核实{label}原请求
            </button>
            {session.operator.role === "operator" && !denied && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy || !loaded}
                onClick={() => void perform(true)}
              >
                明确按原{label}请求重放
              </button>
            )}
          </div>
        </>
      )}
      {denied && (
        <p role="alert">当前身份或写验证已失效。写入口关闭，原锚点继续保留。</p>
      )}
      {evidence && (
        <div data-internal-resolution={evidence.result.value.kind}>
          <InternalEvidenceFacts evidence={evidence.result} />
          {evidence.result.value.kind !== "unresolved" && (
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy || denied}
              onClick={() => void clear()}
            >
              依核实证据解除本原请求锚点
            </button>
          )}
        </div>
      )}
      {busy && <p role="status">正在核实或处理原请求…</p>}
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
        重新读取{label}锚点
      </button>
    </section>
  );
}
export function InternalRecoveryPanels({
  productId,
  session,
  nonce = 0,
  onChanged = () => {},
}: {
  productId: string;
  session: StudioSessionDto;
  nonce?: number;
  onChanged?: () => void;
}) {
  return (
    <>
      <InternalPendingPanel
        key={`review/${productId}/${nonce}`}
        operation="review"
        productId={productId}
        session={session}
        onChanged={onChanged}
      />
      <InternalPendingPanel
        key={`seal/${productId}/${nonce}`}
        operation="seal"
        productId={productId}
        session={session}
        onChanged={onChanged}
      />
    </>
  );
}
