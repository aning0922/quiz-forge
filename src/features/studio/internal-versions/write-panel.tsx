"use client";
import { useEffect, useRef, useState } from "react";
import type {
  InternalReviewState,
  InternalVersionList,
} from "@/features/product/internal-versions/contracts";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError } from "../client";
import { inspectInternalPreparation } from "./pending";
import {
  internalConfirmation,
  matchesInternalConfirmation,
  reviewRequestFromState,
  sealRequestFromState,
  INTERNAL_VERSION_DISCLOSURE,
  type InternalConfirmation,
} from "./view-state";
import {
  InternalOperationEpoch,
  applyInternalOperation,
  evidenceFromWrite,
  type InternalEvidence,
} from "./flow";
import { InternalEvidenceFacts } from "./pending-panel";
import { RequestFacts } from "./facts";
import { useInternalAuthority } from "./authority";
import { internalVersionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
export function InternalWritePanel({
  productId,
  state,
  versions,
  session,
  nonce,
  onChanged,
}: {
  productId: string;
  state?: InternalReviewState | undefined;
  versions?: InternalVersionList | undefined;
  session: StudioSessionDto;
  nonce: number;
  onChanged: () => void;
}) {
  const authority = useInternalAuthority(),
    [epoch] = useState(() => new InternalOperationEpoch(productId)),
    [confirmation, setConfirmation] = useState<InternalConfirmation>(),
    [renderer, setRenderer] = useState(""),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [available, setAvailable] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useState<InternalEvidence>();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      epoch.invalidate();
    };
  }, [epoch, session.csrfToken, session.operator.role]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        inspectInternalPreparation(sessionStorage, productId);
        setAvailable(true);
      } catch {
        setAvailable(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [productId, nonce]);
  const canWrite =
      session.operator.role === "operator" && !denied && !authority.isRevoked,
    head = !!state && state.target.revision === state.observedCurrentRevision,
    valid =
      !!confirmation &&
      matchesInternalConfirmation(confirmation, state, versions),
    capacity =
      versions?.productId === productId && versions.versions.length < 100;
  function prepare(seal: boolean) {
    if (!state || !canWrite || busy || !available) return;
    setMessage("");
    setResult(undefined);
    epoch.invalidate();
    try {
      inspectInternalPreparation(sessionStorage, productId);
      const choice = state.rendererChoices.find(
        (c) => c.renderer.entrySha256 === renderer,
      )?.renderer;
      const request = seal
        ? choice && versions
          ? sealRequestFromState(state, choice, crypto.randomUUID(), versions)
          : undefined
        : reviewRequestFromState(state, crypto.randomUUID());
      if (!request) throw Error("INTERNAL_SELECTION_REQUIRED");
      setConfirmation(internalConfirmation(request, state, versions));
    } catch (error) {
      setConfirmation(undefined);
      setMessage(internalVersionMessage(error));
    }
  }
  async function submit() {
    if (!confirmation || !valid || !canWrite || !available || busy) return;
    const ticket = epoch.begin(confirmation.request),
      authorityTicket = authority.capture(),
      current = () =>
        active.current &&
        epoch.accepts(ticket) &&
        authority.accepts(authorityTicket);
    setBusy(true);
    setMessage("");
    setResult(undefined);
    try {
      const value = await applyInternalOperation(
        sessionStorage,
        ticket.request,
        session.csrfToken,
        current,
      );
      if (current()) setResult(evidenceFromWrite(value));
    } catch (error) {
      const accepting = current();
      if (active.current) authority.observe(error);
      if (accepting) {
        if (
          error instanceof StudioClientError &&
          ["UNAUTHENTICATED", "CAPABILITY_DENIED", "CSRF_REJECTED"].includes(
            error.code,
          )
        ) {
          epoch.invalidate();
          setDenied(true);
        }
        setMessage(internalVersionMessage(error));
      }
    } finally {
      if (active.current) {
        setBusy(false);
        setAvailable(false);
        setConfirmation(undefined);
        onChanged(); // Reloads facts/anchors, never clears or retries an operation.
      }
    }
  }
  return (
    <section className={styles.panel} aria-label="记录与封存准备">
      <h2>记录与封存准备</h2>
      <p>{INTERNAL_VERSION_DISCLOSURE}</p>
      <p>
        记录仅登记服务器已有的固定基线证据。运营记录人与作者批准来源分开；合成测试不会成为作者批准。
      </p>
      {!canWrite && (
        <p role="status">
          {authority.isRevoked
            ? "本页授权已失效。请重新登录并重新打开本页；原请求锚点保留。"
            : "当前写入口关闭；仍可阅读历史事实和只读核实原请求。"}
        </p>
      )}
      {!available && (
        <p role="status">
          尚未可靠确认四类请求均无待确认锚点，新准备保持关闭。请先处理对应原请求核实区。
        </p>
      )}
      {!state && <p>本次修订事实尚未可靠读取。新确认不可用。</p>}
      {state && !head && (
        <p>
          此页是历史修订 {state.target.revision}；本次读取的当前 head 为{" "}
          {state.observedCurrentRevision}。不能记录或封存历史目标。
        </p>
      )}
      {state && head && !state.review && (
        <>
          {!state.baseline ? (
            <p>此修订没有精确匹配的已登记基线，不能新增作者批准。</p>
          ) : (
            <p>
              服务器登记基线：{state.baseline.id} / {state.baseline.version}
              。提交时仍将核对真实内容、素材与既有证据。
            </p>
          )}
          <button
            className={styles.button}
            disabled={!canWrite || !available || busy || !state.baseline}
            onClick={() => prepare(false)}
          >
            准备记录既有基线
          </button>
        </>
      )}
      {state?.review && head && (
        <>
          {!versions && <p>内测版本容量尚未可靠读取，封存准备保持关闭。</p>}
          {versions && !capacity && (
            <p>100 个不可删除的内测槽位已满，不能新建封存请求。</p>
          )}
          {!state.engine && <p>没有可用的固定评分引擎身份。</p>}
          <label className={styles.field}>
            服务器提供的固定渲染器
            <select
              className={styles.select}
              value={renderer}
              disabled={!canWrite || busy}
              onChange={(event) => {
                epoch.invalidate();
                setConfirmation(undefined);
                setRenderer(event.target.value);
              }}
            >
              <option value="">请明确选择</option>
              {state.rendererChoices.map((choice) => (
                <option
                  key={choice.renderer.entrySha256}
                  value={choice.renderer.entrySha256}
                >
                  {choice.renderer.id} / {choice.renderer.version} · 仅内部预览
                </option>
              ))}
            </select>
          </label>
          <button
            className={styles.button}
            disabled={
              !canWrite ||
              !available ||
              busy ||
              !capacity ||
              !state.engine ||
              !state.rendererChoices.some(
                (c) => c.renderer.entrySha256 === renderer,
              )
            }
            onClick={() => prepare(true)}
          >
            准备封存固定内测版本
          </button>
        </>
      )}
      {confirmation && (
        <section className={styles.compare} aria-label="确认固定原请求">
          <h3>
            确认
            {confirmation.request.operation === "review"
              ? "记录既有基线"
              : "封存固定内测版本"}
          </h3>
          <p>
            目标修订 {confirmation.request.tuple.target.revision}
            ；确认后会先持久化完整原请求再发送。不会自动换用新 head 或最新实现。
          </p>
          <RequestFacts request={confirmation.request} />
          {!valid && (
            <p role="alert">
              读取已更新或失败，原确认已失效。请依据新读取重新准备。
            </p>
          )}
          <div className={styles.actions}>
            <button
              className={styles.button}
              disabled={!valid || !canWrite || !available || busy}
              onClick={() => void submit()}
            >
              确认并发送此固定请求
            </button>
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy}
              onClick={() => {
                epoch.invalidate();
                setConfirmation(undefined);
              }}
            >
              取消尚未发送的确认
            </button>
          </div>
        </section>
      )}
      {result && !authority.isRevoked && (
        <InternalEvidenceFacts evidence={result} />
      )}
      {result && !authority.isRevoked && (
        <p>
          成功回执已核验，原锚点仍保留。请在对应原请求核实区明确解除；不会自动进入下一步。
        </p>
      )}
      {busy && <p role="status">正在发送固定请求；请等待或保留原锚点核实…</p>}
      {message && (
        <p className={styles.status} role="status">
          {message}
        </p>
      )}
    </section>
  );
}
