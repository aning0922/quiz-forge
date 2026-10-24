"use client";
import { studioSameTabLink } from "../navigation-boundary";
import { TechnicalDetails } from "../presentation/technical-details";
import { StudioPageHeader } from "../presentation/page-header";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { AccessKeyDetail } from "@/features/fulfillment/access/contracts";
import {
  StudioConsumerControllerV1,
  type StudioConsumerStateV1,
} from "./controller";
import type { StudioConsumerScopeV1 } from "./pending";
import styles from "./consumer-access.module.css";
import { subscribeStudioAuthorityInvalidation } from "../authority-events";
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
function KeyFacts({ value }: { value: AccessKeyDetail }) {
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
}: {
  evidence: NonNullable<StudioConsumerStateV1["evidence"]>;
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
        {"key" in evidence.value && <KeyFacts value={evidence.value.key} />}
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
      <KeyFacts value={evidence.value.key} />
    </>
  );
}
function PendingPanel({
  controller,
  state,
}: {
  controller: StudioConsumerControllerV1;
  state: StudioConsumerStateV1;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const pending = state.pending!,
    evidence = state.evidence,
    active = state.phase === "pending",
    operator = state.session?.operator.role === "operator";
  const terminal = evidence !== null && evidence.value.kind !== "unresolved";
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
  async function copy() {
    await controller.exposeSecret(async (link, current) => {
      if (!current() || !navigator.clipboard?.writeText)
        throw Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
    }, "copied");
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
  }
  return (
    <section className={styles.panel} aria-label="答题内测原操作核对">
      <h2>当前标签页保留的原操作</h2>
      <p>
        {pending.kind === "play"
          ? "创建内测版本"
          : pending.kind === "issue"
            ? "发放访问码"
            : "未领取作废"}{" "}
        · {pending.mayHaveBeenSent ? "可能已发送" : "发送前已保存"}
      </p>
      {pending.kind === "issue" && (
        <p>
          {pending.hasRaw
            ? "原文只保管在当前标签页，核实原发放后可显式复制或下载私密链接。服务器不能恢复原文。"
            : "原文已不在当前标签页，不能恢复私密链接或再次发送原操作发放。仍可查询上次操作结果。"}
        </p>
      )}
      {evidence && <EvidenceFacts evidence={evidence} />}
      <div className={styles.actions}>
        <button
          disabled={!active}
          onClick={() => {
            void controller.recover();
          }}
        >
          查询上次操作结果
        </button>
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
            {pending.hasRaw && "清除后不能再次恢复私密链接，请先妥善保存。"}
          </label>
          <button
            disabled={!active || !acknowledged}
            onClick={() => {
              void controller.finish();
            }}
          >
            确认结束并清除当前标签页记录
          </button>
        </div>
      )}
    </section>
  );
}
export function StudioConsumerAccessPageV1({
  scope,
  renderer,
}: {
  scope: StudioConsumerScopeV1;
  renderer: ConsumerRendererIdentity;
}) {
  const [controller] = useState(
    () =>
      new StudioConsumerControllerV1(scope, renderer, {
        getItem: (k) => sessionStorage.getItem(k),
        setItem: (k, v) => sessionStorage.setItem(k, v),
        removeItem: (k) => sessionStorage.removeItem(k),
      }),
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [versionId, setVersionId] = useState(""),
    [playId, setPlayId] = useState(""),
    [duration, setDuration] = useState(604800),
    [voidId, setVoidId] = useState<string | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeStudioAuthorityInvalidation(controller.revoke);
    const visibility = () => {
      if (document.hidden) controller.revoke();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", controller.revoke);
    void controller.refresh();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", controller.revoke);
      controller.dispose();
    };
  }, [controller]);
  const createTask = useRef<HTMLDetailsElement>(null);
  const issueTask = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (state.pending?.kind === "play" && createTask.current)
      createTask.current.open = true;
    if (state.pending?.kind === "issue" && issueTask.current)
      issueTask.current.open = true;
  }, [state.pending?.kind]);
  const canWrite = state.session?.operator.role === "operator",
    ready = state.phase === "ready";
  const pendingKey = state.evidence?.value.binding.operationKey ?? "original";
  return (
    <div className={styles.page}>
      <header className={styles.pageHeading}>
        <StudioPageHeader
          title="内测记录"
          description="查看这款测评的答题版本与访问码，按需继续内测操作。"
        />
        <div
          onClickCapture={(event) => {
            if (studioSameTabLink(event)) controller.revoke();
          }}
        >
          <StudioWorkflowNav productId={scope.productId} current="keys" />
        </div>
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
                  href={`/studio/products/${scope.productId}/internal-versions`}
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
                    disabled={!canWrite || !ready}
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
                        href={`/studio/products/${scope.productId}/internal-versions`}
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
