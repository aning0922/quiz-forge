"use client";
import { StudioPageHeader } from "../presentation/page-header";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
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
    <dl className={styles.facts}>
      <div>
        <dt>Key ID</dt>
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
      <div>
        <dt>固定内测版本</dt>
        <dd>
          <code>{value.issue.binding.play.playVersionId}</code>
        </dd>
      </div>
    </dl>
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
        <h3>原请求仍未确认</h3>
        <p>尚未取得最终事实。原请求继续保留，不能把未查到记录解释为未执行。</p>
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
            ? "原 Key 发放已记录"
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
            ? "未作废：Key 已领取"
            : "此 Key 已由另一请求作废"}
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
    <section className={styles.panel} aria-label="消费者内测原请求核对">
      <h2>本标签保留的原请求</h2>
      <p>
        {pending.kind === "play"
          ? "创建内测版本"
          : pending.kind === "issue"
            ? "发放访问 Key"
            : "未领取作废"}{" "}
        · {pending.mayHaveBeenSent ? "可能已发送" : "发送前已保存"}
      </p>
      {pending.kind === "issue" && (
        <p>
          {pending.hasRaw
            ? "原文只保管在本标签，核实原发放后可显式复制或下载私密链接。服务器不能恢复原文。"
            : "原文已不在本标签，不能恢复私密链接或重放发放。仍可核对原请求。"}
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
          核对原请求
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
              重放原请求
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
            我已核对服务器事实；清除本标签记录不撤销服务器结果。
            {pending.hasRaw && "清除后不能再次恢复私密链接，请先妥善保存。"}
          </label>
          <button
            disabled={!active || !acknowledged}
            onClick={() => {
              void controller.finish();
            }}
          >
            确认结束并清除本标签记录
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
  const canWrite = state.session?.operator.role === "operator",
    ready = state.phase === "ready";
  const pendingKey = state.evidence?.value.binding.operationKey ?? "original";
  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="消费者内测与访问 Key"
          description="先选择已封存父版本创建固定答题版本，再为该版本发放访问 Key。原请求未确认时先核实。"
        />
        <div
          onClickCapture={(event) => {
            const link =
              event.target instanceof Element
                ? event.target.closest("a[href]")
                : null;
            if (link && event.currentTarget.contains(link)) controller.revoke();
          }}
        >
          <StudioWorkflowNav productId={scope.productId} current="keys" />
        </div>
        <p>
          从已封存的父版本固定消费者体验。内测不等于发布，不包含支付、公开分享或消费者答案查看。
        </p>
        <nav className={styles.actions}>
          <Link
            href={`/studio/products/${scope.productId}`}
            onClick={controller.revoke}
          >
            返回测评工作区
          </Link>
          <Link
            href={`/studio/products/${scope.productId}/internal-versions`}
            onClick={controller.revoke}
          >
            已封存的父版本
          </Link>
          <button
            onClick={() => {
              setVoidId(null);
              void controller.refresh();
            }}
          >
            重新读取与核对身份
          </button>
        </nav>
      </section>
      {state.phase === "lost" ? (
        <section className={styles.panel}>
          <h2>请重新验证运营身份</h2>
          <p>
            页面已停止接纳旧请求、复制或下载。原操作仍保留在原运营员的本标签记录中。
          </p>
          <Link href="/studio/login" onClick={controller.revoke}>
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
              正在核对身份与原请求，请稍候。
            </p>
          )}
          {state.notice === "unavailable" && (
            <p role="alert" className={styles.notice}>
              暂时无法完成本次操作。已有的本标签记录不会自动清除，请重新读取后核对。
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
              当前运营身份为只读，可查看记录与核对原请求，不能创建、发放、作废或复制私密链接。
            </p>
          )}
          {state.pending && (
            <PendingPanel
              key={pendingKey}
              controller={controller}
              state={state}
            />
          )}
          <section className={styles.panel}>
            <h2>创建固定消费者内测版本</h2>
            <p>
              父版本、评分与展示实现固定后不会随草稿变动。请选择具体父版本。
            </p>
            <fieldset disabled={!canWrite || !ready} className={styles.form}>
              <label>
                已封存的父版本
                <select
                  value={versionId}
                  onChange={(e) => setVersionId(e.target.value)}
                >
                  <option value="">请选择父版本</option>
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
                创建消费者内测版本
              </button>
            </fieldset>
            {ready && state.versions.length === 0 && (
              <p>当前尚无可选择的已封存父版本。</p>
            )}
          </section>
          <section className={styles.panel}>
            <h2>发放访问 Key</h2>
            <p>
              原文在浏览器生成，只在本标签保管。服务器只保存独立摘要；期限从实际首次发放起算，重放不续期。
            </p>
            <fieldset disabled={!canWrite || !ready} className={styles.form}>
              <label>
                固定内测版本
                <select
                  value={playId}
                  onChange={(e) => setPlayId(e.target.value)}
                >
                  <option value="">请选择内测版本</option>
                  {state.plays.map((p) => (
                    <option key={p.id} value={p.id}>
                      内测第 {p.slot} 版 · {time(p.createdAt)}
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
                生成并发放一枚访问 Key
              </button>
            </fieldset>
          </section>
          <section className={styles.panel}>
            <h2>服务器 Key 记录</h2>
            <p>
              按服务器最新观察区分未领取、已领取、到期、作废及已完成。完成后的原链接只读查看同一份报告。
            </p>
            <p>
              此列表只有安全元数据，不含原文、消费者答案或报告正文。空页不证明某次发放未执行。
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
                            仅可作废尚未领取的 Key。服务器将重新核对是否已领取。
                          </p>
                          <div className={styles.actions}>
                            <button
                              disabled={!ready}
                              onClick={() => {
                                setVoidId(null);
                                void controller.voidKey(id);
                              }}
                            >
                              确认作废未领取 Key
                            </button>
                            <button
                              disabled={!ready}
                              onClick={() => setVoidId(null)}
                            >
                              保留此 Key
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button disabled={!ready} onClick={() => setVoidId(id)}>
                          作废此未领取 Key
                        </button>
                      ))}
                  </li>
                );
              })}
            </ol>
            {ready && state.keys.length === 0 && <p>此页没有 Key 记录。</p>}
            {state.nextCursor && (
              <button
                disabled={!["ready", "pending"].includes(state.phase)}
                onClick={() => {
                  setVoidId(null);
                  void controller.nextKeys();
                }}
              >
                读取下一页 Key
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
