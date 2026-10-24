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
import {
  revisionTargetSchema,
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import type { PreviewScope } from "@/features/product/preview/contracts";
import { FixedRevisionPreviewPage } from "../preview/page";
import { RevisionHistoryPanel } from "../draft-revisions/history";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { previewSelectionStatus } from "./preview-hub";
import { useInternalAuthority } from "../internal-versions/authority";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { useProductWorkspaceContext } from "./context";
import { ContentTask } from "./content-task";
import { ContentWorkbench } from "./content-workbench";
import { ContentRecords } from "./content-records";
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
export type TaskTab = (typeof tabs)[number]["id"];
const taskLabels: Record<string, string> = {
  content: "内容制作",
  review: "审核与版本",
  play: "创建答题版本",
  issue: "发放访问码",
  void: "作废访问码",
};
type PreviewLaunch = {
  target: RevisionTarget;
  scope: PreviewScope;
  key: string;
};

export function ProductTaskWorkspace({
  session,
  initialTask = "content",
}: {
  session: StudioSessionDto;
  initialTask?: TaskTab;
}) {
  return (
    <ProductTaskSurfaces>
      <Workspace session={session} initialTask={initialTask} />
    </ProductTaskSurfaces>
  );
}

function Workspace({
  session,
  initialTask,
}: {
  session: StudioSessionDto;
  initialTask: TaskTab;
}) {
  const workspace = useProductWorkspaceContext();
  const authority = useInternalAuthority();
  const surfaces = useWorkspaceSurfaces();
  const [tab, setTab] = useState<TaskTab>(initialTask);
  const [selection, setSelection] = useState<RevisionTarget>();
  const [launched, setLaunched] = useState<PreviewLaunch>();
  const [switchPreview, setSwitchPreview] = useState<RevisionTarget>();
  const [historyScope, setHistoryScope] = useState<RevisionTarget>();
  const [contentSource, setContentSource] = useState<string>();
  const [contentRun, setContentRun] = useState(0);
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
  const selected = selection ?? launched?.target ?? current;
  function switchTab(next: TaskTab) {
    if (!surfaces.canSwitch()) return;
    if (surfaces.active && !surfaces.close()) return;
    setTab(next);
  }
  function choosePreview(target: RevisionTarget) {
    if (!surfaces.canSwitch()) return;
    setSelection(revisionTargetSchema.parse(target));
    setSwitchPreview(undefined);
    switchTab("preview");
  }
  function launchPreview(target: RevisionTarget, confirmedSwitch = false) {
    if (authority.isRevoked || !surfaces.canSwitch()) return;
    const exact = revisionTargetSchema.parse(target);
    if (
      launched &&
      !sameRevisionTarget(launched.target, exact) &&
      !confirmedSwitch
    ) {
      setSwitchPreview(exact);
      choosePreview(exact);
      setSwitchPreview(exact);
      return;
    }
    if (!launched || !sameRevisionTarget(launched.target, exact)) {
      setLaunched({
        target: exact,
        scope: { productId, draftId: exact.draftId, revision: exact.revision },
        key: JSON.stringify([productId, exact]),
      });
    }
    setSelection(exact);
    setSwitchPreview(undefined);
    surfaces.open("preview");
  }
  function openRevisions() {
    if (!surfaces.canSwitch()) return;
    const target = current ?? selected;
    if (!historyScope && target) setHistoryScope(target);
    surfaces.open("revisions");
  }
  function observeHistoryFailure(error: unknown) {
    const wasRevoked = authority.isRevoked;
    authority.observe(error);
    if (!wasRevoked && authority.isRevoked) invalidateCurrentStudioAuthority();
  }
  function continueSource(importId: string) {
    if (!surfaces.canSwitch()) return;
    const state = surfaces.states.content;
    if (!state?.retained && !state?.pending && !state?.busy) {
      setContentSource(importId);
      setContentRun((n) => n + 1);
    }
    surfaces.open("content");
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
              <strong>{taskLabels[id] ?? "保留的任务"} · </strong>
              {state?.message ||
                "本页保留着尚未结束的任务，关闭浮层不会丢失原输入。"}
            </p>
            <button
              onClick={() => surfaces.open(id as keyof typeof surfaces.states)}
            >
              继续{taskLabels[id] ?? "原任务"}
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
          onPreview={launchPreview}
        />
      </div>
      <div hidden={tab !== "preview"}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>预览体验</h2>
            <p>默认体验当前草稿，历史修订按需选择；开始后固定本次目标。</p>
          </div>
          <button onClick={openRevisions}>历史修订</button>
        </div>
        <div className={styles.columns}>
          <section className={styles.panel}>
            {selected ? (
              <>
                <h2>固定修订 r{selected.revision}</h2>
                <StatusBadge
                  status={previewSelectionStatus(
                    { productId, target: selected },
                    productId,
                    value,
                  )}
                />
                <p>
                  在大视图中打开真实封面、题目、结果与报告，收起后保留本页的临时体验进度。
                </p>
                <div className={styles.actions}>
                  <button
                    className={styles.primary}
                    disabled={authority.isRevoked}
                    onClick={() => launchPreview(selected)}
                  >
                    体验 r{selected.revision} 完整流程
                  </button>
                  <button onClick={openRevisions}>选择其他修订</button>
                </div>
                {switchPreview && (
                  <section className={styles.notice} role="status">
                    <p>
                      将从 r{launched?.target.revision} 切换到 r
                      {switchPreview.revision}
                      ，旧预览的临时答案与结果会重置。内容导入任务和历史记录保持。
                    </p>
                    <div className={styles.actions}>
                      <button
                        onClick={() => launchPreview(switchPreview, true)}
                      >
                        确认切换并开始 r{switchPreview.revision}
                      </button>
                      <button onClick={() => setSwitchPreview(undefined)}>
                        保留原预览
                      </button>
                    </div>
                  </section>
                )}
                {current && !sameRevisionTarget(selected, current) && (
                  <button onClick={() => choosePreview(current)}>
                    选择当前 r{current.revision}
                  </button>
                )}
              </>
            ) : (
              <>
                <h2>还没有可预览的内容</h2>
                <p>先完成内容包接收、检查并形成首稿。</p>
                <button onClick={() => switchTab("content")}>去处理内容</button>
              </>
            )}
          </section>
          <aside className={styles.panel}>
            <h2>体验中核对什么</h2>
            <ul className={styles.previewChecklist}>
              <li>
                <strong>封面与答题</strong>
                <p>查看实际内容、素材与操作反馈。</p>
              </li>
              <li>
                <strong>结果与报告</strong>
                <p>由原固定修订预览服务生成，保持同一目标。</p>
              </li>
              <li>
                <strong>海报</strong>
                <p>沿用已有预览导出能力；不产生正式消费者报告。</p>
              </li>
            </ul>
            <p>预览不会自动登记人工验收或授予批准。</p>
          </aside>
        </div>
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
          key={contentRun}
          productId={productId}
          session={session}
          initialImportId={contentSource}
          onChanged={read.refresh}
          onState={reportContent}
          onPreview={launchPreview}
        />
      </RetainedTaskSurface>
      <RetainedTaskSurface id="history">
        <div className={styles.history}>
          <p>记录属于各自固定对象，不以最近时间把不同来源拼为同一任务。</p>
          <h3>当前草稿</h3>
          <p>{current ? `r${current.revision}` : "暂无可确认的草稿"}</p>
          {current && <button onClick={openRevisions}>查看内容修订记录</button>}
          <h3>接收与检查</h3>
          <button onClick={() => surfaces.open("imports")}>
            查看接收与检查记录
          </button>
          <h3>历史固定版本</h3>
          <p>
            {presentation?.historicalNote || "当前摘要没有历史固定版本代表项。"}
          </p>
          <Link href={`${base}/internal-versions`}>查看完整版本记录</Link>
        </div>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="imports">
        <ContentRecords productId={productId} onContinue={continueSource} />
      </RetainedTaskSurface>
      <RetainedTaskSurface id="revisions">
        {historyScope ? (
          <RevisionHistoryPanel
            productId={productId}
            draftId={historyScope.draftId}
            currentRevision={current?.revision ?? historyScope.revision}
            onSelect={choosePreview}
            onFailure={observeHistoryFailure}
          />
        ) : (
          <p>尚无可读取的草稿修订。</p>
        )}
      </RetainedTaskSurface>
      <RetainedTaskSurface id="preview">
        {launched && (
          <FixedRevisionPreviewPage
            key={launched.key}
            scope={launched.scope}
            session={session}
            authority={authority}
            embedded
          />
        )}
      </RetainedTaskSurface>
    </div>
  );
}
