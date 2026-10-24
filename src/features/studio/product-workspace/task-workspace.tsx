"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  FileText,
  Eye,
  ShieldCheck,
  Ticket,
  History,
  Settings,
  RefreshCw,
} from "lucide-react";
import type { StudioSessionDto } from "../contracts";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { previewPagePath } from "@/features/product/preview/urls";
import { useInternalAuthority } from "../internal-versions/authority";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { useProductWorkspaceContext } from "./context";
import { ContentTask } from "./content-task";
import { ContentWorkbench } from "./content-workbench";
import {
  ProductTaskSurfaces,
  RetainedTaskSurface,
  useWorkspaceSurfaces,
  type WorkspaceTaskState,
} from "./task-surfaces";
import styles from "./task-workspace.module.css";

const tabs = [
  { id: "content", label: "内容制作", icon: FileText },
  { id: "preview", label: "预览体验", icon: Eye },
  { id: "review", label: "审核与版本", icon: ShieldCheck },
  { id: "testing", label: "内测发放", icon: Ticket },
] as const;
type TaskTab = (typeof tabs)[number]["id"];

export function ProductTaskWorkspace({
  session,
}: {
  session: StudioSessionDto;
}) {
  return (
    <ProductTaskSurfaces>
      <Workspace session={session} />
    </ProductTaskSurfaces>
  );
}

function Workspace({ session }: { session: StudioSessionDto }) {
  const workspace = useProductWorkspaceContext();
  const authority = useInternalAuthority();
  const surfaces = useWorkspaceSurfaces();
  const [tab, setTab] = useState<TaskTab>("content");
  const [selection, setSelection] = useState<RevisionTarget>();
  const report = surfaces.report;
  const reportContent = useCallback(
    (state: WorkspaceTaskState) => report("content", state),
    [report],
  );
  if (!workspace) return <p role="alert">请从测评管理重新进入工作区。</p>;
  const { productId, read } = workspace;
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const value = read.value;
  const presentation = value ? productPresentation(value) : undefined;
  const current =
    value?.content.draft.state === "present"
      ? value.content.draft.value.target
      : undefined;
  const selected = selection ?? current;
  function switchTab(next: TaskTab) {
    if (!surfaces.canSwitch()) return;
    if (surfaces.active && !surfaces.close()) return;
    setTab(next);
  }
  function choosePreview(target: RevisionTarget) {
    if (!surfaces.canSwitch()) return;
    setSelection(target);
    switchTab("preview");
  }
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>测评工作区 / 内容制作与内测</p>
          <div className={styles.titleRow}>
            <h1>{value?.directory.title ?? "正在读取测评"}</h1>
            {presentation && <StatusBadge status={presentation.review} />}
          </div>
          <p className={styles.subtitle}>
            当前内容：
            {current
              ? `草稿 r${current.revision}`
              : value?.content.draft.state === "none"
                ? "尚无草稿"
                : "待读取核实"}
            {presentation?.historicalNote && (
              <> · {presentation.historicalNote}</>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <button onClick={() => surfaces.open("history")}>
            <History size={18} aria-hidden="true" />
            记录与历史
          </button>
          <Link href={`${base}/settings`}>
            <Settings size={18} aria-hidden="true" />
            基本设置
          </Link>
        </div>
      </header>
      <div className={styles.observation}>
        <p>
          {session.operator.role === "read-only"
            ? "当前为只读身份"
            : "当前仅用于内部测试"}
        </p>
        <button onClick={read.refresh} disabled={read.loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {read.loading ? "正在读取…" : "刷新当前状态"}
        </button>
      </div>
      {read.error && (
        <p role="alert" className={styles.notice}>
          当前状态读取失败，已保留任务不会被替换。{read.error}
        </p>
      )}
      {authority.isRevoked && (
        <section className={styles.notice} role="alert">
          <p>当前页权限已失效，原文件、输入与未确认操作保留，新写入已停止。</p>
          <a href="/studio/login" target="_blank" rel="noopener">
            在新标签重新登录
          </a>
          <p>重新登录不会恢复本页旧权限，请保留原记录在新工作区核实。</p>
        </section>
      )}
      <nav className={styles.tabs} aria-label="测评内部任务">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => switchTab(id)}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      {Object.entries(surfaces.states)
        .filter(([, state]) => state?.pending || state?.retained)
        .map(([id, state]) => (
          <section key={id} className={styles.retained} role="status">
            <p>
              {state?.message ||
                "本页保留着尚未结束的任务，关闭浮层不会丢失原输入。"}
            </p>
            <button
              onClick={() => surfaces.open(id as keyof typeof surfaces.states)}
            >
              继续原任务
            </button>
          </section>
        ))}
      <div hidden={tab !== "content"}>
        <ContentWorkbench
          value={value}
          loading={read.loading}
          error={read.error}
          taskState={surfaces.states.content}
          readOnly={session.operator.role !== "operator" || authority.isRevoked}
          onOpenTask={() => surfaces.open("content")}
          onOpenHistory={() => surfaces.open("history")}
          onPreview={choosePreview}
        />
      </div>
      <div hidden={tab !== "preview"} className={styles.panel}>
        <h2>预览体验</h2>
        {selected ? (
          <>
            <p>
              当前选择固定修订 r{selected.revision}，开始后不会随最新草稿变化。
            </p>
            <Link
              className={styles.primary}
              href={previewPagePath({ productId, ...selected })}
              target="_blank"
              rel="noopener"
            >
              打开 r{selected.revision} 完整预览
            </Link>
          </>
        ) : (
          <>
            <p>还没有可预览的内容。</p>
            <button onClick={() => switchTab("content")}>去处理内容</button>
          </>
        )}
      </div>
      <div hidden={tab !== "review"} className={styles.panel}>
        <h2>审核与版本</h2>
        <p>审核记录必须与准确修订匹配，历史批准不会沿用到新的草稿。</p>
        <Link href={`${base}/internal-versions`}>进入现有审核与版本操作</Link>
      </div>
      <div hidden={tab !== "testing"} className={styles.panel}>
        <h2>内测发放</h2>
        <p>基于真实固定版本创建答题版本，再明确发放访问码。</p>
        <Link href={`${base}/consumer-access`}>进入现有内测记录</Link>
      </div>
      <RetainedTaskSurface id="content">
        <ContentTask
          productId={productId}
          session={session}
          onChanged={read.refresh}
          onState={reportContent}
          onPreview={choosePreview}
        />
      </RetainedTaskSurface>
      <RetainedTaskSurface id="history">
        <div className={styles.history}>
          <p>记录属于各自固定对象，不以最近时间把不同来源拼为同一任务。</p>
          <h3>当前草稿</h3>
          <p>{current ? `r${current.revision}` : "暂无可确认的草稿"}</p>
          {current && (
            <button onClick={() => choosePreview(current)}>
              选择当前修订预览
            </button>
          )}
          <h3>接收与检查</h3>
          <Link href={`${base}/imports`}>查看完整接收记录与原请求恢复</Link>
          <h3>历史固定版本</h3>
          <p>
            {presentation?.historicalNote || "当前摘要没有历史固定版本代表项。"}
          </p>
          <Link href={`${base}/internal-versions`}>查看完整版本记录</Link>
        </div>
      </RetainedTaskSurface>
    </div>
  );
}
