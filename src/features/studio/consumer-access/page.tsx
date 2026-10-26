"use client";
import { useStudioAccountOwner } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  RetainedTaskSurface,
  RetainedTaskActions,
  useWorkspaceSurfaces,
} from "../product-workspace/task-surfaces";
import { useStudioLeaveProtection } from "../navigation-boundary";
import {
  useInternalAuthority,
  type InternalProductAuthority,
} from "../internal-versions/authority";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { AccessKeyDetail } from "@/features/fulfillment/access/contracts";
import {
  StudioConsumerControllerV1,
  type StudioConsumerStateV1,
} from "./controller";
import type { StudioConsumerScopeV1 } from "./pending";
import styles from "./consumer-access.module.css";
import {
  invalidateCurrentStudioAuthority,
  subscribeStudioAuthorityInvalidation,
} from "../authority-events";
const time = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
function keyStatus(key: AccessKeyDetail) {
  if (key.current.completion) return "已完成 · 原链接只读报告";
  if (key.current.voidReceipt) return "未领取已作废";
  const expired =
    Date.parse(key.issue.expiresAt) <= Date.parse(key.current.observedAt);
  return key.current.claim
    ? expired
      ? "已领取 · 答题期限已到"
      : "已领取"
    : expired
      ? "未领取 · 已到期"
      : "未领取";
}
function KeyFacts({
  value,
  compact = false,
}: {
  value: AccessKeyDetail;
  compact?: boolean;
}) {
  if (compact)
    return (
      <>
        <div className={styles.detailIdentity}>
          <strong>安全编号 …{value.issue.binding.keyId.slice(-8)}</strong>
          <span>{keyStatus(value)}</span>
        </div>
        <p>有效至 {time(value.issue.expiresAt)}</p>
        <TechnicalDetails label="原操作安全记录技术标识">
          <p>访问码编号：{value.issue.binding.keyId}</p>
          <p>答题版本：{value.issue.binding.play.playVersionId}</p>
        </TechnicalDetails>
      </>
    );
  return (
    <>
      <dl className={styles.facts}>
        <div>
          <dt>访问码编号</dt>
          <dd>
            <code>{value.issue.binding.keyId}</code>
          </dd>
        </div>
        <div>
          <dt>当前记录</dt>
          <dd>{keyStatus(value)}</dd>
        </div>
        <div>
          <dt>实际发放时间（UTC+8）</dt>
          <dd>{time(value.issue.issuedAt)}</dd>
        </div>
        <div>
          <dt>答题期限（UTC+8）</dt>
          <dd>{time(value.issue.expiresAt)}</dd>
        </div>
      </dl>
      <TechnicalDetails label="答题版本技术标识">
        <dl className={styles.facts}>
          <div>
            <dt>答题版本标识</dt>
            <dd>
              <code>{value.issue.binding.play.playVersionId}</code>
            </dd>
          </div>
        </dl>
      </TechnicalDetails>
    </>
  );
}
function EvidenceFacts({
  evidence,
  compact = false,
}: {
  evidence: NonNullable<StudioConsumerStateV1["evidence"]>;
  compact?: boolean;
}) {
  if (evidence.value.kind === "unresolved")
    return (
      <>
        <h3>原操作仍未确认</h3>
        <p>尚未取得最终事实。原操作继续保留，不能把未查到记录解释为未执行。</p>
      </>
    );
  if (evidence.kind === "play")
    return (
      <>
        <h3>
          {evidence.value.kind === "applied"
            ? "原内测版本已创建"
            : "操作标识已绑定另一请求"}
        </h3>
        {"play" in evidence.value && (
          <p>服务器内测版本：第 {evidence.value.play.slot} 版。</p>
        )}
      </>
    );
  if (evidence.kind === "issue")
    return (
      <>
        <h3>
          {evidence.value.kind === "applied"
            ? "上次访问码发放已记录"
            : "操作标识已绑定另一发放请求"}
        </h3>
        {"key" in evidence.value && (
          <KeyFacts value={evidence.value.key} compact={compact} />
        )}
      </>
    );
  return (
    <>
      <h3>
        {evidence.value.kind === "applied"
          ? "原未领取作废已记录"
          : evidence.value.kind === "claimed"
            ? "未作废：访问码已领取"
            : "此访问码已由另一操作作废"}
      </h3>
      <KeyFacts value={evidence.value.key} compact={compact} />
    </>
  );
}
function issueDisclosureState(evidence: StudioConsumerStateV1["evidence"]) {
  const appliedKey =
    evidence?.kind === "issue" && evidence.value.kind === "applied"
      ? evidence.value.key
      : null;
  const usable =
    appliedKey !== null &&
    !appliedKey.current.voidReceipt &&
    (appliedKey.current.completion !== null ||
      Date.parse(appliedKey.issue.expiresAt) >
        Date.parse(appliedKey.current.observedAt));
  const terminal = evidence !== null && evidence.value.kind !== "unresolved";
  const unavailableReason = !terminal
    ? null
    : usable
      ? null
      : appliedKey?.current.voidReceipt
        ? "已核实此访问码已作废，原协议不允许披露私密链接。请核对后明确结束本地记录。"
        : appliedKey
          ? "已核实此访问码已过期且未完成，原协议不允许披露私密链接。请核对后明确结束本地记录。"
          : "已核实原发放请求存在明确冲突，不能从此原操作披露私密链接。请核对服务器事实后明确结束本地记录。";
  return { usable, unavailableReason };
}
function PendingPanel({
  controller,
  state,
  onFinished,
  requireSecretSave = false,
  surfaceId,
}: {
  controller: StudioConsumerControllerV1;
  state: StudioConsumerStateV1;
  onFinished?: (() => void) | undefined;
  requireSecretSave?: boolean;
  surfaceId?: "play" | "issue" | "void";
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [disclosed, setDisclosed] = useState(false);
  const pending = state.pending!,
    evidence = state.evidence,
    active = state.phase === "pending",
    operator = roleHasCapability(
      state.session?.operator.role,
      pending.kind === "play"
        ? "version:seal-internal"
        : pending.kind === "void"
          ? "access-key:void"
          : "access-key:issue",
    );
  const terminal = evidence !== null && evidence.value.kind !== "unresolved";
  const { usable, unavailableReason } = issueDisclosureState(evidence);
  const mustSave = requireSecretSave && pending.hasRaw && operator && usable;
  async function copy() {
    await controller.exposeSecret(async (link, current) => {
      if (!current() || !navigator.clipboard?.writeText)
        throw Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
    }, "copied");
    if (controller.getSnapshot().notice === "copied") setDisclosed(true);
  }
  async function download() {
    await controller.exposeSecret(async (link, current) => {
      if (!current()) return;
      const url = URL.createObjectURL(
        new Blob([link + "\n"], { type: "text/plain;charset=utf-8" }),
      );
      try {
        if (!current()) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = "quizforge-private-access.txt";
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    }, "exported");
    if (controller.getSnapshot().notice === "exported") setDisclosed(true);
  }
  const finishAction = (
    <button
      className={surfaceId ? styles.primaryButton : undefined}
      disabled={!active || !acknowledged || (mustSave && !disclosed)}
      onClick={() => {
        void controller.finish().then(() => {
          if (
            controller.getSnapshot().phase === "ready" &&
            !controller.getSnapshot().pending
          )
            onFinished?.();
        });
      }}
    >
      确认结束并清除当前标签页记录
    </button>
  );
  const resultActions = (
    <>
      <div className={`${styles.page} ${styles.footerActions}`}>
        {(!surfaceId || !terminal) && (
          <button
            disabled={!active}
            onClick={() => {
              void controller.recover();
            }}
          >
            查询上次操作结果
          </button>
        )}
        {!terminal &&
          operator &&
          (pending.kind !== "issue" || pending.hasRaw) && (
            <button
              disabled={!active}
              onClick={() => {
                void controller.recover(true);
              }}
            >
              再次发送原操作
            </button>
          )}
        {operator && pending.kind === "issue" && pending.hasRaw && usable && (
          <>
            <button
              disabled={!active}
              onClick={() => {
                void copy();
              }}
            >
              复制私密访问链接
            </button>
            <button
              disabled={!active}
              onClick={() => {
                void download();
              }}
            >
              下载私密链接文件
            </button>
          </>
        )}
      </div>
      {surfaceId && terminal && finishAction}
    </>
  );
  return (
    <section
      className={surfaceId ? styles.resultStage : styles.panel}
      aria-label="答题内测原操作核对"
    >
      {!surfaceId && <h2>当前标签页保留的原操作</h2>}
      <p>
        {pending.kind === "play"
          ? "创建内测版本"
          : pending.kind === "issue"
            ? "发放访问码"
            : "未领取作废"}{" "}
        ·{" "}
        {terminal
          ? "已取得服务器处理结果"
          : pending.mayHaveBeenSent
            ? "可能已发送"
            : "发送前已保存"}
      </p>
      {pending.kind === "issue" && (!surfaceId || !terminal) && (
        <p>
          {pending.hasRaw
            ? "原文只保管在当前标签页，核实原发放后可显式复制或下载私密链接。服务器不能恢复原文。"
            : "原文已不在当前标签页，不能恢复私密链接或再次发送原操作发放。仍可查询上次操作结果。"}
        </p>
      )}
      {evidence && <EvidenceFacts evidence={evidence} compact={!!surfaceId} />}
      {surfaceId ? (
        <RetainedTaskActions id={surfaceId}>
          {resultActions}
        </RetainedTaskActions>
      ) : (
        resultActions
      )}
      {mustSave && !disclosed && !surfaceId && (
        <p role="status">
          请先通过本次原操作复制或下载私密链接并妥善保存，再核对结束。
        </p>
      )}
      {requireSecretSave &&
        pending.kind === "issue" &&
        terminal &&
        unavailableReason && <p role="status">{unavailableReason}</p>}
      {requireSecretSave &&
        pending.kind === "issue" &&
        terminal &&
        usable &&
        !operator && (
          <p role="status">
            当前身份没有凭证披露权限；请核对服务器事实后明确结束本地记录。
          </p>
        )}
      {terminal && (
        <div className={styles.acknowledgment}>
          <label>
            <input
              type="checkbox"
              disabled={!active}
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            我已核对服务器事实；清除当前标签页记录不撤销服务器结果。
            {pending.hasRaw &&
              (mustSave || !requireSecretSave
                ? "清除后不能再次恢复私密链接，请先妥善保存。"
                : "清除后会移除当前标签页保管的原文，服务器结果保持不变。")}
          </label>
          {!surfaceId && finishAction}
        </div>
      )}
    </section>
  );
}
export function StudioConsumerAccessPageV1({
  scope,
  renderer,
  embedded = false,
  visible = true,
  onChanged,
  workspaceAuthority,
  onGoToReview,
}: {
  scope: StudioConsumerScopeV1;
  renderer: ConsumerRendererIdentity;
  embedded?: boolean;
  visible?: boolean;
  onChanged?: (() => void) | undefined;
  workspaceAuthority?: InternalProductAuthority | undefined;
  onGoToReview?: (() => void) | undefined;
}) {
  const owner = useStudioAccountOwner();
  const { origin, instanceId, issuerId, productId } = scope;
  const { id: rendererId, version: rendererVersion, entrySha256 } = renderer;
  const controller = useMemo(() => {
    void owner?.generation;
    return new StudioConsumerControllerV1(
      { origin, instanceId, issuerId, productId },
      {
        kind: "consumer-renderer",
        id: rendererId,
        version: rendererVersion,
        entrySha256,
      },
      {
        getItem: (k) => sessionStorage.getItem(k),
        setItem: (k, v) => sessionStorage.setItem(k, v),
        removeItem: (k) => sessionStorage.removeItem(k),
      },
    );
  }, [
    origin,
    instanceId,
    issuerId,
    productId,
    rendererId,
    rendererVersion,
    entrySha256,
    owner?.generation,
  ]);
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => {
    if (state.phase === "lost" && owner && !owner.revoked)
      invalidateCurrentStudioAuthority();
  }, [state.phase, owner]);
  const [versionId, setVersionId] = useState(""),
    [playId, setPlayId] = useState(""),
    [duration, setDuration] = useState(604800),
    [voidId, setVoidId] = useState<string | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeStudioAuthorityInvalidation(controller.revoke);
    const observeWorkspace = () => {
      if (
        workspaceAuthority?.isRevoked ||
        (workspaceAuthority && workspaceAuthority.productId !== scope.productId)
      )
        controller.revoke();
    };
    const unsubscribeWorkspace =
      workspaceAuthority?.subscribe(observeWorkspace);
    const visibility = () => {
      if (document.hidden) controller.revoke();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", controller.revoke);
    if (
      workspaceAuthority?.isRevoked ||
      (workspaceAuthority && workspaceAuthority.productId !== scope.productId)
    )
      controller.revoke();
    else void controller.refresh();
    return () => {
      unsubscribe();
      unsubscribeWorkspace?.();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", controller.revoke);
      controller.dispose();
    };
  }, [controller, workspaceAuthority, scope.productId]);
  const createTask = useRef<HTMLDetailsElement>(null);
  const issueTask = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (state.pending?.kind === "play" && createTask.current)
      createTask.current.open = true;
    if (state.pending?.kind === "issue" && issueTask.current)
      issueTask.current.open = true;
  }, [state.pending?.kind]);
  const canWrite = roleHasCapability(
      state.session?.operator.role,
      "access-key:issue",
    ),
    canCreatePlay = roleHasCapability(
      state.session?.operator.role,
      "version:seal-internal",
    ),
    ready = state.phase === "ready";
  const pendingKey = state.evidence?.value.binding.operationKey ?? "original";
  const notified = useRef<string | undefined>(undefined);
  useEffect(() => {
    const evidence = state.evidence;
    if (!embedded || !evidence || evidence.value.kind !== "applied") return;
    const key = evidence.value.binding.operationKey;
    if (notified.current !== key) {
      notified.current = key;
      onChanged?.();
    }
  }, [embedded, state.evidence, onChanged]);
  if (embedded)
    return (
      <ConsumerTaskView
        controller={controller}
        state={state}
        visible={visible}
        versionId={versionId}
        setVersionId={setVersionId}
        playId={playId}
        setPlayId={setPlayId}
        duration={duration}
        setDuration={setDuration}
        voidId={voidId}
        setVoidId={setVoidId}
        onGoToReview={onGoToReview}
      />
    );
  return (
    <div className={styles.page}>
      <header className={styles.pageHeading}>
        <StudioPageHeader
          title="内测记录"
          description="查看这款测评的答题版本与访问码，按需继续内测操作。"
        />

        <button
          onClick={() => {
            setVoidId(null);
            void controller.refresh();
          }}
        >
          重新读取与核对身份
        </button>
      </header>
      {state.phase === "lost" ? (
        <section className={styles.panel}>
          <h2>请重新验证运营身份</h2>
          <p>
            页面已停止接纳旧请求、复制或下载。原操作仍保留在原运营员的当前标签页记录中。
          </p>
          <Link
            className={styles.actionLink}
            href="/studio/login"
            onClick={(event) => {
              if (studioSameTabLink(event)) controller.revoke();
            }}
          >
            返回运营登录
          </Link>
        </section>
      ) : (
        <>
          {state.phase === "loading" && (
            <p role="status" className={styles.notice}>
              正在核对当前运营身份与服务器记录。
            </p>
          )}
          {state.phase === "working" && (
            <p role="status" className={styles.notice}>
              正在核对身份与原操作，请稍候。
            </p>
          )}
          {state.notice === "unavailable" && (
            <p role="alert" className={styles.notice}>
              暂时无法完成本次操作。已有的当前标签页记录不会自动清除，请重新读取后核对。
            </p>
          )}
          {state.notice === "copied" && (
            <p role="status" className={styles.notice}>
              私密访问链接已复制，请勿公开分享。
            </p>
          )}
          {state.notice === "exported" && (
            <p role="status" className={styles.notice}>
              已触发私密链接文件下载，请确认已妥善保存。
            </p>
          )}
          {state.session?.operator.role === "read-only" && (
            <p className={styles.notice}>
              当前运营身份为只读，可查看记录与查询上次操作结果，不能创建、发放、作废或复制私密链接。
            </p>
          )}
          {state.pending && (
            <PendingPanel
              key={pendingKey}
              controller={controller}
              state={state}
            />
          )}
          <div className={styles.recordsGrid}>
            <section className={styles.panel}>
              <h2>访问码记录</h2>
              <p className={styles.intro}>
                当前页显示安全编号与使用状态；空页不证明某次发放未执行。
              </p>
              <ol className={styles.keys}>
                {state.keys.map((key) => {
                  const id = key.issue.binding.keyId;
                  return (
                    <li key={id}>
                      <KeyFacts value={key} />
                      {canWrite &&
                        !key.current.claim &&
                        !key.current.voidReceipt &&
                        (voidId === id ? (
                          <div>
                            <p>
                              作废后，此访问码不能再用于领取答题。仅能作废尚未领取的访问码；服务器会再次确认，已领取的访问码不会被此操作作废。
                            </p>
                            <div className={styles.actions}>
                              <button
                                disabled={!ready}
                                onClick={() => {
                                  setVoidId(null);
                                  void controller.voidKey(id);
                                }}
                              >
                                确认作废未领取访问码
                              </button>
                              <button
                                disabled={!ready}
                                onClick={() => setVoidId(null)}
                              >
                                保留此访问码
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            disabled={!ready}
                            onClick={() => setVoidId(id)}
                          >
                            作废此未领取访问码
                          </button>
                        ))}
                    </li>
                  );
                })}
              </ol>
              {ready && state.keys.length === 0 && <p>此页没有访问码记录。</p>}
              {state.nextCursor && (
                <button
                  disabled={!["ready", "pending"].includes(state.phase)}
                  onClick={() => {
                    setVoidId(null);
                    void controller.nextKeys();
                  }}
                >
                  读取下一页访问码
                </button>
              )}
            </section>
            <aside className={styles.sideTasks}>
              <section className={styles.panel}>
                <h2>已有答题版本</h2>
                <ul className={styles.playList}>
                  {state.plays.map((play) => {
                    const parent = state.versions.find(
                      (version) =>
                        version.id === play.binding.parent.versionId &&
                        version.snapshotSha256 ===
                          play.binding.parent.snapshotSha256,
                    );
                    return (
                      <li key={play.id}>
                        <strong>答题第 {play.slot} 版</strong>
                        <span>
                          {parent
                            ? `来源修订 r${parent.target.revision} · 固定内容第 ${parent.slot} 版`
                            : "来源版本请核实"}
                        </span>
                        <time dateTime={play.createdAt}>
                          {time(play.createdAt)}
                        </time>
                      </li>
                    );
                  })}
                </ul>
                {ready && state.plays.length === 0 && (
                  <p className={styles.intro}>
                    尚无答题版本，可从已固定的内测内容开始创建。
                  </p>
                )}
                <Link
                  className={styles.actionLink}
                  href={`/studio/products/${scope.productId}?task=review&panel=versions`}
                  onClick={(event) => {
                    if (studioSameTabLink(event)) controller.revoke();
                  }}
                >
                  查看固定内容版本
                </Link>
              </section>
              <details ref={issueTask} className={styles.primaryTask}>
                <summary>发放访问码</summary>
                <div className={styles.taskBody}>
                  <p>
                    私密访问链接只由当前标签页保管，服务器不能找回原文。请及时复制或下载并妥善保存。有效期从首次发放起算，再次发送同一操作不会延长期限。
                  </p>
                  <fieldset
                    disabled={!canWrite || !ready}
                    className={styles.form}
                  >
                    <label>
                      答题版本
                      <select
                        value={playId}
                        onChange={(e) => setPlayId(e.target.value)}
                      >
                        <option value="">请选择答题版本</option>
                        {state.plays.map((p) => (
                          <option key={p.id} value={p.id}>
                            答题第 {p.slot} 版 · {time(p.createdAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      答题有效期
                      <select
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      >
                        <option value={86400}>1 天</option>
                        <option value={604800}>7 天</option>
                        <option value={2592000}>30 天</option>
                      </select>
                    </label>
                    <button
                      disabled={!playId}
                      onClick={() => {
                        void controller.issueKey(playId, duration);
                      }}
                    >
                      生成并发放一枚访问码
                    </button>
                  </fieldset>
                  {ready && state.plays.length === 0 && (
                    <p className={styles.notice}>
                      还没有答题版本。请先展开“创建答题版本”，选择固定内测内容版本，再发放访问码。
                    </p>
                  )}
                </div>
              </details>
              <details ref={createTask} className={styles.task}>
                <summary>创建答题版本</summary>
                <div className={styles.taskBody}>
                  <p>
                    答题版本会固定本次使用的内容、评分和画面，不随后续草稿变化。请选择已固定的内测内容版本。
                  </p>
                  <fieldset
                    disabled={!canCreatePlay || !ready}
                    className={styles.form}
                  >
                    <label>
                      固定内测内容版本
                      <select
                        value={versionId}
                        onChange={(e) => setVersionId(e.target.value)}
                      >
                        <option value="">请选择固定内测内容版本</option>
                        {state.versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            第 {v.slot} 版 · 草稿修订 {v.target.revision}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      disabled={!versionId}
                      onClick={() => {
                        void controller.createPlay(versionId);
                      }}
                    >
                      创建答题版本
                    </button>
                  </fieldset>
                  {ready && state.versions.length === 0 && (
                    <div className={styles.notice}>
                      <p>
                        尚无固定内测内容版本。请先预览草稿、记录已有审核依据，并固定内测内容。
                      </p>
                      <Link
                        className={styles.actionLink}
                        href={`/studio/products/${scope.productId}?task=review&panel=versions`}
                        onClick={(event) => {
                          if (studioSameTabLink(event)) controller.revoke();
                        }}
                      >
                        前往审核依据与内容版本
                      </Link>
                    </div>
                  )}
                </div>
              </details>
              <p className={styles.boundary}>
                仅限内部测试；私密访问链接需在发放后妥善保存，无法从记录中找回。
              </p>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

type ConsumerTaskProps = {
  controller: StudioConsumerControllerV1;
  state: StudioConsumerStateV1;
  visible: boolean;
  versionId: string;
  setVersionId: Dispatch<SetStateAction<string>>;
  playId: string;
  setPlayId: Dispatch<SetStateAction<string>>;
  duration: number;
  setDuration: Dispatch<SetStateAction<number>>;
  voidId: string | null;
  setVoidId: Dispatch<SetStateAction<string | null>>;
  onGoToReview?: (() => void) | undefined;
};
/** The controller and all form selections live outside retained portal surfaces. */
function ConsumerTaskView({
  controller,
  state,
  visible,
  versionId,
  setVersionId,
  playId,
  setPlayId,
  duration,
  setDuration,
  voidId,
  setVoidId,
  onGoToReview,
}: ConsumerTaskProps) {
  const surfaces = useWorkspaceSurfaces();
  const authority = useInternalAuthority();
  const [action, setAction] = useState<"play" | "issue" | "void" | null>(null);
  const [keyDetail, setKeyDetail] = useState<AccessKeyDetail>();
  const report = surfaces.report;
  const { usable, unavailableReason } = issueDisclosureState(state.evidence);
  const kind = state.pending?.kind ?? action;
  const working = state.phase === "working";
  const ready = state.phase === "ready";
  const canWrite =
    roleHasCapability(state.session?.operator.role, "access-key:issue") &&
    !authority.isRevoked;
  const canCreatePlay =
    roleHasCapability(state.session?.operator.role, "version:seal-internal") &&
    !authority.isRevoked;
  useStudioLeaveProtection({
    dirty: !!versionId || !!playId || !!voidId,
    pending: working || !!state.pending,
  });
  useLayoutEffect(() => {
    for (const id of ["play", "issue", "void"] as const) {
      const pending = state.pending?.kind === id;
      report(id, {
        busy: working && kind === id,
        pending,
        retained: pending || (state.phase === "lost" && action === id),
        message: pending
          ? id === "issue"
            ? "原发码请求及当前标签页凭证仍保留，请核实并妥善保存后明确结束。"
            : "原内测操作仍保留，请查询原请求并明确结束。"
          : state.phase === "lost"
            ? "权限已失效，原请求仍保留，不能继续旧披露。"
            : undefined,
        blockCloseReason:
          pending && id === "issue" && state.pending?.hasRaw
            ? (unavailableReason ??
              (usable &&
              roleHasCapability(
                state.session?.operator.role,
                "access-key:issue",
              )
                ? "私密链接仍由当前标签页保管。请先复制或下载并妥善保存，再明确结束当前记录。"
                : "原发码请求仍保留。请先核实服务器事实，再按可用操作明确结束本地记录。"))
            : undefined,
      });
    }
  }, [
    report,
    state.pending,
    state.phase,
    state.session?.operator.role,
    working,
    kind,
    action,
    usable,
    unavailableReason,
  ]);
  function open(id: "play" | "issue" | "void") {
    if (!surfaces.canSwitch()) return;
    setAction(id);
    surfaces.open(id);
  }
  function inspect(key: AccessKeyDetail) {
    if (!surfaces.canSwitch()) return;
    setKeyDetail(key);
    surfaces.open("key");
  }
  const original = (id: "play" | "issue" | "void") =>
    state.pending?.kind === id ? (
      <PendingPanel
        key={state.evidence?.value.binding.operationKey ?? "original"}
        controller={controller}
        state={state}
        requireSecretSave
        surfaceId={id}
        onFinished={() => {
          const latest = controller.getSnapshot();
          if (latest.phase !== "ready" || latest.pending) return;
          if (id === "play") setVersionId("");
          if (id === "issue") setPlayId("");
          if (id === "void") setVoidId(null);
          setAction(null);
          report(id, { busy: false, pending: false, retained: false });
          surfaces.close();
        }}
      />
    ) : null;
  const lost = state.phase === "lost" || authority.isRevoked;
  return (
    <>
      <div hidden={!visible} className={styles.page}>
        <div className={styles.embeddedHeading}>
          <div>
            <h2>内测发放</h2>
            <p>先查看已有答题版本和安全记录，短操作在任务中完成。</p>
          </div>
          <div className={styles.actions}>
            <button
              disabled={!canCreatePlay || !ready}
              onClick={() => open("play")}
            >
              创建答题版本
            </button>
            <button
              className={styles.primaryButton}
              disabled={!canWrite || !ready || !state.plays.length}
              onClick={() => open("issue")}
            >
              发放访问码
            </button>
          </div>
        </div>
        {lost && (
          <div className={styles.notice} role="alert">
            <h3>请重新验证运营身份</h3>
            <p>
              已停止旧请求与凭证披露，原标签页请求保持。重新登录不自动重放。
            </p>
            <a href="/studio/login" target="_blank" rel="noopener">
              在新标签重新登录
            </a>
          </div>
        )}
        {state.phase === "loading" && (
          <p role="status">正在读取身份与安全记录…</p>
        )}
        {working && <p role="status">正在处理同一原操作，请等待…</p>}
        {state.notice === "unavailable" && (
          <p className={styles.notice} role="alert">
            本次读取或操作未完成，原请求保留，请继续原任务核实。
          </p>
        )}
        {state.session?.operator.role === "read-only" && (
          <p>
            当前只读，可查看安全记录及查询原请求，不能创建、发放、作废或复制私密链接。
          </p>
        )}
        {(ready ||
          (state.phase === "pending" && state.notice !== "unavailable")) && (
          <div className={styles.readStats} aria-label="本次读取范围">
            <div>
              <span>已读答题版本</span>
              <strong>{state.plays.length}</strong>
            </div>
            <div>
              <span>本页访问码记录</span>
              <strong>{state.keys.length}</strong>
            </div>
            <div>
              <span>本页已完成记录</span>
              <strong>
                {
                  state.keys.filter((key) => key.current.completion !== null)
                    .length
                }
              </strong>
            </div>
          </div>
        )}
        <section className={styles.panel}>
          <div className={styles.embeddedHeading}>
            <div>
              <h3>已发放访问码</h3>
              <p>只显示安全元数据，不能从历史记录恢复私密原链接。</p>
            </div>
            <button
              disabled={working || !!state.pending}
              onClick={() => void controller.refresh()}
            >
              刷新记录
            </button>
          </div>
          <div className={styles.safeTableWrap}>
            <table className={styles.safeTable}>
              <caption>本次读取的访问码记录，不代表全量统计</caption>
              <thead>
                <tr>
                  <th>安全编号</th>
                  <th>答题版本</th>
                  <th>使用状态</th>
                  <th>发放时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.keys.map((key) => {
                  const play = state.plays.find(
                    (play) => play.id === key.issue.binding.play.playVersionId,
                  );
                  return (
                    <tr key={key.issue.binding.keyId}>
                      <td>
                        <span
                          className={styles.safeId}
                          title={key.issue.binding.keyId}
                        >
                          …{key.issue.binding.keyId.slice(-8)}
                        </span>
                      </td>
                      <td>{play ? `答题版本 #${play.slot}` : "版本需核实"}</td>
                      <td>
                        <span
                          className={`${styles.statusTag} ${key.current.completion ? styles.completeTag : key.current.voidReceipt ? styles.voidTag : key.current.claim ? styles.claimedTag : ""}`}
                        >
                          {keyStatus(key)}
                        </span>
                      </td>
                      <td>
                        <time dateTime={key.issue.issuedAt}>
                          {time(key.issue.issuedAt)}
                        </time>
                      </td>
                      <td>
                        <button onClick={() => inspect(key)}>查看详情</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className={styles.mobileKeys}>
            {state.keys.map((key) => {
              const play = state.plays.find(
                (play) => play.id === key.issue.binding.play.playVersionId,
              );
              return (
                <li key={key.issue.binding.keyId}>
                  <div className={styles.embeddedHeading}>
                    <strong>
                      安全编号 …{key.issue.binding.keyId.slice(-8)}
                    </strong>
                    <span className={styles.statusTag}>{keyStatus(key)}</span>
                  </div>
                  <p>
                    {play ? `答题版本 #${play.slot}` : "版本需核实"} ·{" "}
                    {time(key.issue.issuedAt)}
                  </p>
                  <button onClick={() => inspect(key)}>查看详情</button>
                </li>
              );
            })}
          </ul>
          {ready && !state.keys.length && (
            <div className={styles.empty}>
              <h3>还没有本次可见的访问码记录</h3>
              <p>
                {state.plays.length
                  ? "可基于已有答题版本明确发放一枚测试码。"
                  : "先选择固定内测内容，创建答题版本后再发码。"}
              </p>
              {(state.plays.length ? canWrite : canCreatePlay) && (
                <button
                  className={styles.primaryButton}
                  onClick={() => open(state.plays.length ? "issue" : "play")}
                >
                  {state.plays.length ? "开始发放访问码" : "开始创建答题版本"}
                </button>
              )}
            </div>
          )}
          {state.nextCursor && (
            <button
              disabled={!["ready", "pending"].includes(state.phase) || working}
              onClick={() => void controller.nextKeys()}
            >
              读取下一页访问码
            </button>
          )}
          <p className={styles.rangeNote}>
            本页 {state.keys.length} 条 ·
            完成数仅来自本页返回记录，不是全量参与统计。
          </p>
          <section className={styles.playSection}>
            <h3>已有答题版本</h3>
            <ul className={styles.recordList}>
              {state.plays.map((play) => {
                const parent = state.versions.find(
                  (version) =>
                    version.id === play.binding.parent.versionId &&
                    version.snapshotSha256 ===
                      play.binding.parent.snapshotSha256,
                );
                return (
                  <li key={play.id}>
                    <div>
                      <strong>答题第 {play.slot} 版</strong>
                      <p>
                        {parent
                          ? `来源修订 r${parent.target.revision} · 固定内容第 ${parent.slot} 版`
                          : "来源版本需核实"}
                      </p>
                      <time dateTime={play.createdAt}>
                        {time(play.createdAt)}
                      </time>
                    </div>
                    <button
                      disabled={!canWrite || !ready}
                      onClick={() => {
                        if (!surfaces.canSwitch()) return;
                        setPlayId(play.id);
                        open("issue");
                      }}
                    >
                      为此版本发码
                    </button>
                  </li>
                );
              })}
            </ul>
            {ready && !state.plays.length && (
              <p>尚无答题版本。固定内容版本不会自动变为答题版本。</p>
            )}
          </section>
        </section>
      </div>
      <RetainedTaskSurface id="play">
        <div className={styles.page}>
          <div hidden={state.pending?.kind === "play"}>
            <p className={styles.taskIntro}>
              选择已固定的内容，生成独立的答题版本。后续草稿不会改变它。
            </p>
            <fieldset
              className={styles.form}
              disabled={!canCreatePlay || !ready}
            >
              <label>
                固定内测内容版本
                <select
                  value={versionId}
                  onChange={(event) => setVersionId(event.target.value)}
                >
                  <option value="">请选择固定内测内容版本</option>
                  {state.versions.map((version) => (
                    <option value={version.id} key={version.id}>
                      第 {version.slot} 版 · 来源修订 r{version.target.revision}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
            {!state.versions.length && (
              <div className={styles.notice}>
                <p>尚无可靠读取的固定内容版本。请先核对审核依据与固定条件。</p>
                {onGoToReview && (
                  <button
                    onClick={() => {
                      if (surfaces.canSwitch()) onGoToReview();
                    }}
                  >
                    前往审核与版本
                  </button>
                )}
              </div>
            )}
          </div>
          {original("play")}
        </div>
        <RetainedTaskActions id="play" visible={!state.pending}>
          <button
            className={styles.primaryButton}
            disabled={
              !canCreatePlay ||
              !ready ||
              !state.versions.some((version) => version.id === versionId)
            }
            onClick={() => {
              setAction("play");
              void controller.createPlay(versionId);
            }}
          >
            确认创建答题版本
          </button>
        </RetainedTaskActions>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="issue">
        <div className={styles.page}>
          <div hidden={state.pending?.kind === "issue"}>
            <fieldset className={styles.form} disabled={!canWrite || !ready}>
              <label>
                答题版本
                <select
                  value={playId}
                  onChange={(event) => setPlayId(event.target.value)}
                >
                  <option value="">请选择答题版本</option>
                  {state.plays.map((play) => (
                    <option value={play.id} key={play.id}>
                      答题第 {play.slot} 版 · {time(play.createdAt)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                答题有效期
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                >
                  <option value={86400}>1 天</option>
                  <option value={604800}>7 天</option>
                  <option value={2592000}>30 天</option>
                </select>
              </label>
            </fieldset>
            <p className={styles.notice}>
              一次发放一枚访问码。私密链接只由当前标签页保管；发放后请复制或下载保存，服务器不能找回。
            </p>
          </div>
          {original("issue")}
          {state.notice === "copied" && (
            <p role="status">私密链接已复制，请妥善保存。</p>
          )}
          {state.notice === "exported" && (
            <p role="status">已触发下载，请确认文件已妥善保存。</p>
          )}
        </div>
        <RetainedTaskActions id="issue" visible={!state.pending}>
          <button
            className={styles.primaryButton}
            disabled={
              !canWrite ||
              !ready ||
              !state.plays.some((play) => play.id === playId)
            }
            onClick={() => {
              setAction("issue");
              void controller.issueKey(playId, duration);
            }}
          >
            确认生成并发放一枚访问码
          </button>
        </RetainedTaskActions>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="key">
        <div className={styles.page}>
          {keyDetail && (
            <>
              <div className={styles.detailIdentity}>
                <strong>
                  安全编号 …{keyDetail.issue.binding.keyId.slice(-8)}
                </strong>
                <span className={styles.statusTag}>{keyStatus(keyDetail)}</span>
              </div>
              <section className={styles.detailSection}>
                <h3>所属答题内容</h3>
                <p>
                  {(() => {
                    const play = state.plays.find(
                      (item) =>
                        item.id === keyDetail.issue.binding.play.playVersionId,
                    );
                    const parent =
                      play &&
                      state.versions.find(
                        (version) =>
                          version.id === play.binding.parent.versionId &&
                          version.snapshotSha256 ===
                            play.binding.parent.snapshotSha256,
                      );
                    return play
                      ? `答题版本 #${play.slot}${parent ? ` · 来源修订 r${parent.target.revision}` : " · 来源版本需核实"}`
                      : "此页未读取到对应答题版本，完整绑定可在下方核对。";
                  })()}
                </p>
              </section>
              <section className={styles.detailSection}>
                <h3>发放与期限</h3>
                <dl className={styles.facts}>
                  <div>
                    <dt>发放时间</dt>
                    <dd>{time(keyDetail.issue.issuedAt)}</dd>
                  </div>
                  <div>
                    <dt>答题期限</dt>
                    <dd>{time(keyDetail.issue.expiresAt)}</dd>
                  </div>
                </dl>
              </section>
              <section className={styles.detailSection}>
                <h3>当前可用情况</h3>
                <p>
                  {keyDetail.current.completion
                    ? "已完成，原私密链接只读同一份报告。"
                    : keyDetail.current.voidReceipt
                      ? "已作废，不能再领取。"
                      : keyDetail.current.claim
                        ? "已领取，不能按未领取作废。"
                        : "尚未领取，提交作废时服务器会再次核对。"}
                </p>
                <p className={styles.boundary}>
                  观察于 {time(keyDetail.current.observedAt)}
                  ；此安全详情不含私密链接原文。
                </p>
              </section>
              <TechnicalDetails label="安全记录完整技术标识">
                <p>访问码编号：{keyDetail.issue.binding.keyId}</p>
                <p>商品：{keyDetail.issue.binding.play.productId}</p>
                <p>答题版本：{keyDetail.issue.binding.play.playVersionId}</p>
              </TechnicalDetails>
              {canWrite &&
                !keyDetail.current.claim &&
                !keyDetail.current.voidReceipt && (
                  <button
                    className={styles.dangerButton}
                    onClick={() => {
                      if (!surfaces.canSwitch()) return;
                      setVoidId(keyDetail.issue.binding.keyId);
                      open("void");
                    }}
                  >
                    作废此未领取访问码
                  </button>
                )}
            </>
          )}
        </div>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="void">
        <div className={styles.page}>
          <div hidden={state.pending?.kind === "void"}>
            <div className={styles.notice}>
              <strong>安全编号 …{voidId?.slice(-8) ?? "未选择"}</strong>
              <p>
                作废后无法再领取答题。服务器会再次检查；已领取或已完成的记录不能按未领取作废。
              </p>
              <TechnicalDetails label="目标安全记录完整编号">
                <p>{voidId ?? "未选择"}</p>
              </TechnicalDetails>
            </div>
          </div>
          {original("void")}
        </div>
        <RetainedTaskActions id="void" visible={!state.pending}>
          <button
            className={styles.dangerButton}
            disabled={!canWrite || !ready || !voidId}
            onClick={() => {
              if (!voidId) return;
              setAction("void");
              void controller.voidKey(voidId);
            }}
          >
            确认作废未领取访问码
          </button>
        </RetainedTaskActions>
      </RetainedTaskSurface>
    </>
  );
}
