"use client";
import {
  useOwnedStudioSession,
  useStudioRecoveryReset,
} from "../accounts/session-owner";
import { ownedPendingStorage } from "../accounts/owned-storage";
import { roleHasCapability } from "@/lib/auth/role-policy";
import { TechnicalDetails } from "../presentation/technical-details";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStudioLeaveProtection } from "../navigation-boundary";
import {
  RetainedTaskActions,
  type WorkspaceTaskState,
} from "../product-workspace/task-surfaces";
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
import { RequestFacts, type VersionReceiptActions } from "./facts";
import local from "./internal-versions.module.css";
import { useInternalAuthority } from "./authority";
import { internalVersionMessage } from "./message";
import styles from "../workspace/workspace.module.css";
export function InternalWritePanel({
  productId,
  state,
  versions,
  session: initialSession,
  nonce,
  onChanged,
  onTaskState,
  renderSurface,
  embedded = false,
  receiptActions,
}: {
  embedded?: boolean;
  receiptActions?: VersionReceiptActions | undefined;
  productId: string;
  state?: InternalReviewState | undefined;
  versions?: InternalVersionList | undefined;
  session: StudioSessionDto;
  nonce: number;
  onChanged: () => void;
  onTaskState?: ((state: WorkspaceTaskState) => void) | undefined;
  renderSurface?: ((content: ReactNode) => ReactNode) | undefined;
}) {
  const session = useOwnedStudioSession(initialSession);
  const authority = useInternalAuthority(),
    [epoch] = useState(() => new InternalOperationEpoch(productId)),
    [confirmation, setConfirmation] = useState<InternalConfirmation>(),
    [renderer, setRenderer] = useState(""),
    [busy, setBusy] = useState(false),
    [denied, setDenied] = useState(false),
    [available, setAvailable] = useState(false),
    [preparationChecked, setPreparationChecked] = useState(false),
    [message, setMessage] = useState(""),
    [result, setResult] = useState<InternalEvidence>();
  const active = useRef(true);
  useStudioRecoveryReset(() => {
    setDenied(false);
    setConfirmation(undefined);
    setResult(undefined);
    epoch.invalidate();
  });
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
        inspectInternalPreparation(
          ownedPendingStorage(sessionStorage, session.operator.id),
          productId,
        );
        setAvailable(true);
      } catch {
        setAvailable(false);
      } finally {
        setPreparationChecked(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [productId, nonce, session.operator.id]);
  const canWrite =
      roleHasCapability(session.operator.role, "review:record-baseline") &&
      !denied &&
      !authority.isRevoked,
    head = !!state && state.target.revision === state.observedCurrentRevision,
    valid =
      !!confirmation &&
      matchesInternalConfirmation(confirmation, state, versions),
    capacity =
      versions?.productId === productId && versions.versions.length < 100;
  const pending = preparationChecked && !available;
  useStudioLeaveProtection({
    dirty: !!confirmation || !!renderer,
    pending: busy || pending,
  });
  useLayoutEffect(() => {
    onTaskState?.({
      busy,
      pending,
      retained: !!confirmation || pending || busy,
      message: pending
        ? "审核或封存有原操作待核实，请继续原任务。"
        : confirmation
          ? "保留了此固定修订的尚未发送确认。"
          : "核对与固定内测内容",
    });
  }, [busy, pending, confirmation, onTaskState]);
  function prepare(seal: boolean) {
    if (!state || !canWrite || busy || !available) return;
    setMessage("");
    setResult(undefined);
    epoch.invalidate();
    try {
      inspectInternalPreparation(
        ownedPendingStorage(sessionStorage, session.operator.id),
        productId,
      );
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
        ownedPendingStorage(sessionStorage, session.operator.id),
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
  const compact = (
    <section
      className={local.embeddedTask}
      aria-label="记录审核依据与固定内容版本"
    >
      <div className={local.targetCard}>
        <strong>本次目标：修订 r{state?.target.revision ?? "尚未读取"}</strong>
        <p>
          {state?.review
            ? "将内容、素材、评分与所选预览样式固定为一个内测版本。"
            : "只登记已经存在的审核依据，不产生新的作者批准。"}
        </p>
      </div>
      {!canWrite && <p role="status">当前写入口关闭，原操作记录保持。</p>}
      {!state && <p>修订事实尚未可靠读取，新确认不可用。</p>}
      {state && !head && (
        <p>
          此任务绑定历史修订 r{state.target.revision}；不能记录或封存历史目标。
        </p>
      )}
      {state && head && !state.review && (
        <p>
          {state.baseline
            ? "已有匹配的登记基线，提交时仍会核对内容、素材及既有证据。"
            : "此修订尚无匹配审核依据。请先完成内容与素材审核，此页面不能代为批准。"}
        </p>
      )}
      <div hidden={!!confirmation || !!result}>
        {state?.review && head && (
          <>
            <label className={styles.field}>
              内测预览样式
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
                {state.rendererChoices.map((choice, index) => (
                  <option
                    key={choice.renderer.entrySha256}
                    value={choice.renderer.entrySha256}
                  >
                    样式 {index + 1} · 版本 {choice.renderer.version} ·
                    仅内测预览
                  </option>
                ))}
              </select>
            </label>
            {!versions && <p>版本容量尚未可靠读取，封存准备保持关闭。</p>}
            {versions && !capacity && <p>100 个固定槽位已满，不能新增。</p>}
            {!state.engine && <p>没有可用的固定评分引擎身份。</p>}
          </>
        )}
      </div>
      {confirmation && (
        <div className={local.targetCard} aria-label="确认固定原操作">
          <h3>
            确认
            {confirmation.request.operation === "review"
              ? "记录已有审核依据"
              : "固定内测内容版本"}
          </h3>
          <p>确认后先保存完整原请求，再发送；不会改用最新修订。</p>
          <RequestFacts request={confirmation.request} />
          {!valid && (
            <p role="alert">读取已更新或失败，原确认已失效。请重新准备。</p>
          )}
        </div>
      )}
      {result && !authority.isRevoked && (
        <>
          <InternalEvidenceFacts
            evidence={result}
            receiptActions={receiptActions}
          />
          <p>原操作记录仍保留，请在下方核实区明确结束后继续。</p>
        </>
      )}
      {!available && preparationChecked && !result && (
        <p role="status">请先核实下方原操作记录，新准备保持关闭。</p>
      )}
      {busy && <p role="status">正在发送固定请求，请等待结果…</p>}
      {message && <p role="status">{message}</p>}
      <RetainedTaskActions id="review" visible={available && !!state && head}>
        {result ? (
          <button
            className={`${styles.button} ${styles.secondary}`}
            onClick={() => setResult(undefined)}
          >
            返回本修订准备
          </button>
        ) : confirmation ? (
          <>
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
            <button
              className={styles.button}
              disabled={!valid || !canWrite || !available || busy}
              onClick={() => void submit()}
            >
              确认并发送此固定请求
            </button>
          </>
        ) : state?.review ? (
          <button
            className={styles.button}
            disabled={
              !canWrite ||
              busy ||
              !capacity ||
              !state.engine ||
              !state.rendererChoices.some(
                (c) => c.renderer.entrySha256 === renderer,
              )
            }
            onClick={() => prepare(true)}
          >
            准备固定内测内容版本
          </button>
        ) : (
          <button
            className={styles.button}
            disabled={!canWrite || busy || !state?.baseline}
            onClick={() => prepare(false)}
          >
            准备记录已有审核依据
          </button>
        )}
      </RetainedTaskActions>
    </section>
  );
  const content = embedded ? (
    compact
  ) : (
    <section className={styles.panel} aria-label="记录审核依据与固定内容版本">
      <h2>记录审核依据与固定内容版本</h2>
      <p>{INTERNAL_VERSION_DISCLOSURE}</p>
      <p>
        这里只记录已有的审核依据，不产生新的批准。测试示例不能替代作者的内容与素材审核。
      </p>
      {!canWrite && (
        <p role="status">
          {authority.isRevoked
            ? "本页授权已失效。请重新登录并重新打开本页；原操作记录保留。"
            : "当前写入口关闭；仍可阅读历史事实和只读核实原操作。"}
        </p>
      )}
      {!available && (
        <p role="status">
          尚未可靠确认四类请求均无待确认本地操作记录，新准备保持关闭。请先处理对应原操作核实区。
        </p>
      )}
      {!state && <p>本次修订事实尚未可靠读取。新确认不可用。</p>}
      {state && !head && (
        <p>
          此页是历史修订 {state.target.revision}；本次读取的当前修订 为{" "}
          {state.observedCurrentRevision}。不能记录或封存历史目标。
        </p>
      )}
      {state && head && !state.review && (
        <>
          {!state.baseline ? (
            <p>
              此修订尚无匹配的已登记审核依据，暂不能记录。请先完成所需的内容与素材审核；此页面不能代为批准。
            </p>
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
            准备记录已有审核依据
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
            内测预览样式
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
              {state.rendererChoices.map((choice, index) => (
                <option
                  key={choice.renderer.entrySha256}
                  value={choice.renderer.entrySha256}
                >
                  样式 {index + 1} · 版本 {choice.renderer.version} · 仅内测预览
                </option>
              ))}
            </select>
          </label>
          <TechnicalDetails label="预览样式技术标识">
            {state.rendererChoices.map((choice) => (
              <p key={choice.renderer.entrySha256}>
                {choice.renderer.id} / {choice.renderer.version}
              </p>
            ))}
          </TechnicalDetails>
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
            准备固定内测内容版本
          </button>
        </>
      )}
      {confirmation && (
        <section className={styles.compare} aria-label="确认固定原操作">
          <h3>
            确认
            {confirmation.request.operation === "review"
              ? "记录已有审核依据"
              : "固定内测内容版本"}
          </h3>
          <p>
            目标修订 {confirmation.request.tuple.target.revision}
            ；确认后会先持久化完整原操作再发送。不会自动换用新修订 或最新实现。
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
        <InternalEvidenceFacts
          evidence={result}
          receiptActions={receiptActions}
        />
      )}
      {result && !authority.isRevoked && (
        <p>
          成功处理结果已核验，原操作记录仍保留。请在对应原操作核实区明确解除；不会自动进入下一步。
        </p>
      )}
      {busy && (
        <p role="status">正在发送固定请求；请等待或保留原操作记录核实…</p>
      )}
      {message && (
        <p className={styles.status} role="status">
          {message}
        </p>
      )}
    </section>
  );
  return renderSurface ? renderSurface(content) : content;
}
