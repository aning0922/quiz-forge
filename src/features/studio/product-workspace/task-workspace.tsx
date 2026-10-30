"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Eye,
  ShieldCheck,
  Ticket,
  History,
  Settings,
  RefreshCw,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import type { StudioSessionDto } from "../contracts";
import type { StudioConsumerScopeV1 } from "../consumer-access/pending";
import type { StudioConsumerRenderers } from "../consumer-access/controller";
import { StudioConsumerAccessPageV1 } from "../consumer-access/page";
import { ReviewWorkbench } from "./review-workbench";
import {
  revisionTargetSchema,
  sameRevisionTarget,
  type RevisionTarget,
} from "@/features/product/internal-versions/identity-contracts";
import Link from "next/link";
import {
  checkDraftRevision,
  checkedDraftFetch,
  draftRevisionEndpoint,
} from "../drafts/client";
import { useInternalRead } from "../internal-versions/use-read";
import type { WorkspaceQuery } from "./routes";
import { WorkspaceAside } from "./aside";
import type { PreviewScope } from "@/features/product/preview/contracts";
import { CurrentFixedRevisionPreviewPage } from "../preview/current-page";
import { RevisionHistoryPanel } from "../draft-revisions/history";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { previewSelectionStatus } from "./preview-selection";
import { useInternalAuthority } from "../internal-versions/authority";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { useProductWorkspaceContext } from "./context";
import { ContentTask } from "./content-task";
import { ContentWorkbench } from "./content-workbench";
import { ContentRecords } from "./content-records";
import { ContentSourceDetails } from "./content-source-details";
import { RevisionDetails } from "./revision-details";
import { ProductDetail } from "../workspace/product-detail";
import { ContentAuthorityContext } from "./content-authority";
import {
  ProductTaskSurfaces,
  RetainedTaskSurface,
  useWorkspaceSurfaces,
  type WorkspaceTaskState,
} from "./task-surfaces";
import styles from "./task-workspace.module.css";

const tabs = [
  { id: "content", label: "内容制作", icon: FileText },
  { id: "preview", label: "体验预览", icon: Eye },
  { id: "review", label: "审核封存", icon: ShieldCheck },
  { id: "testing", label: "内测发放", icon: Ticket },
] as const;
export type TaskTab = (typeof tabs)[number]["id"];
const taskLabels: Record<string, string> = {
  content: "内容制作",
  review: "审核封存",
  play: "创建答题版本",
  issue: "发放访问码",
  void: "作废访问码",
  settings: "基本设置",
};
type PreviewLaunch = {
  target: RevisionTarget;
  scope: PreviewScope;
  key: string;
};

export function ProductTaskWorkspace({
  session: initialSession,
  initialTask = "content",
  initialPanel,
  initialScope,
  consumerScope,
  consumerRenderers,
}: {
  session: StudioSessionDto;
  initialTask?: TaskTab;
  initialPanel?: WorkspaceQuery["panel"];
  initialScope?: PreviewScope | undefined;
  consumerScope: StudioConsumerScopeV1;
  consumerRenderers: StudioConsumerRenderers;
}) {
  const session = useOwnedStudioSession(initialSession);
  const authority = useInternalAuthority();
  const contentAuthority = useMemo(
    () => ({
      canWrite: () =>
        roleHasCapability(session.operator.role, "import:create") &&
        !authority.isRevoked,
      observe: (error: unknown) => {
        const wasRevoked = authority.isRevoked;
        authority.observe(error);
        if (!wasRevoked && authority.isRevoked)
          invalidateCurrentStudioAuthority();
      },
    }),
    [authority, session.operator.role],
  );
  return (
    <ContentAuthorityContext.Provider value={contentAuthority}>
      <ProductTaskSurfaces>
        <Workspace
          session={session}
          initialTask={initialTask}
          initialPanel={initialPanel}
          initialScope={initialScope}
          consumerScope={consumerScope}
          consumerRenderers={consumerRenderers}
        />
      </ProductTaskSurfaces>
    </ContentAuthorityContext.Provider>
  );
}

function Workspace({
  session: initialSession,
  initialTask,
  initialPanel,
  initialScope,
  consumerScope,
  consumerRenderers,
}: {
  session: StudioSessionDto;
  initialTask: TaskTab;
  initialPanel?: WorkspaceQuery["panel"];
  initialScope?: PreviewScope | undefined;
  consumerScope: StudioConsumerScopeV1;
  consumerRenderers: StudioConsumerRenderers;
}) {
  const session = useOwnedStudioSession(initialSession);
  const workspace = useProductWorkspaceContext();
  const authority = useInternalAuthority();
  const surfaces = useWorkspaceSurfaces();
  const [tab, setTab] = useState<TaskTab>(initialTask);
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<TaskTab>>(
    () => new Set([initialTask]),
  );
  const [selection, setSelection] = useState<RevisionTarget>();
  const [launched, setLaunched] = useState<PreviewLaunch>();
  const [switchPreview, setSwitchPreview] = useState<RevisionTarget>();
  const [historyScope, setHistoryScope] = useState<RevisionTarget>();
  const [contentSource, setContentSource] = useState<string>();
  const [contentRun, setContentRun] = useState(0);
  const [sourceDetail, setSourceDetail] = useState<string>();
  const [revisionDetail, setRevisionDetail] = useState<RevisionTarget>();
  const incomingEntry = JSON.stringify({
    task: initialTask,
    scope: initialScope,
    panel: initialPanel,
  });
  const acceptedEntry = useRef(incomingEntry);
  const [entry, setEntry] = useState({
    task: initialTask,
    scope: initialScope,
    panel: initialPanel,
  });
  const [routeNotice, setRouteNotice] = useState("");
  const scopeKey = JSON.stringify(entry.scope ?? null);
  const fixedRead = useInternalRead(
    `workspace-target:${scopeKey}`,
    async (signal) => {
      const scope = entry.scope;
      if (!scope) return undefined;
      const result = await checkedDraftFetch(
        draftRevisionEndpoint(scope.productId, scope.draftId, scope.revision),
        { signal },
        (value) => checkDraftRevision(value, scope),
        { revision: true },
      );
      const draft = result.draft;
      return revisionTargetSchema.parse({
        draftId: draft.draftId,
        revision: draft.revision,
        canonicalContentSha256: draft.canonicalContentSha256,
        assetSetSha256: draft.assetSetSha256,
        canonicalManifestSha256: draft.canonicalManifestSha256,
      });
    },
  );
  const [fixedEntry, setFixedEntry] = useState<{
    key: string;
    target: RevisionTarget;
  }>();
  if (fixedRead.value && fixedEntry?.key !== scopeKey)
    setFixedEntry({ key: scopeKey, target: fixedRead.value });
  const requestedTarget =
    fixedEntry?.key === scopeKey ? fixedEntry.target : undefined;
  useEffect(() => {
    if (acceptedEntry.current === incomingEntry) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      acceptedEntry.current = incomingEntry;
      if (
        launched ||
        Object.values(surfaces.states).some(
          (state) => state?.busy || state?.pending || state?.retained,
        )
      ) {
        setRouteNotice(
          "本页已有保留的任务或固定预览，本次地址中的新目标未接管原任务。请先核实并明确结束原操作，再重新进入目标。",
        );
        return;
      }
      if (!surfaces.canSwitch()) return;
      surfaces.close();
      setEntry({ task: initialTask, scope: initialScope, panel: initialPanel });
      setSelection(undefined);
      setVisitedTabs((old) => new Set([...old, initialTask]));
      setTab(initialTask);
      setRouteNotice("");
    });
    return () => {
      active = false;
    };
  }, [
    incomingEntry,
    initialTask,
    initialScope,
    initialPanel,
    launched,
    surfaces,
  ]);
  const historyEntryTarget = entry.scope
    ? requestedTarget
    : workspace?.read.value?.content.draft.state === "present"
      ? workspace.read.value.content.draft.value.target
      : undefined;
  useEffect(() => {
    if (entry.panel !== "revisions" || historyScope || !historyEntryTarget)
      return;
    let active = true;
    queueMicrotask(() => {
      if (active)
        setHistoryScope(revisionTargetSchema.parse(historyEntryTarget));
    });
    return () => {
      active = false;
    };
  }, [entry.panel, historyScope, historyEntryTarget]);
  const openedPanel = useRef<string | undefined>(undefined);
  const openSurface = surfaces.open;
  useEffect(() => {
    const key = JSON.stringify(entry);
    if (!entry.panel || openedPanel.current === key) return;
    let active = true;
    queueMicrotask(() => {
      if (!active || !entry.panel) return;
      if (entry.panel === "versions")
        setVisitedTabs((old) => new Set([...old, "review"]));
      openedPanel.current = key;
      openSurface(entry.panel);
    });
    return () => {
      active = false;
    };
  }, [entry, openSurface]);
  const tabBar = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = tabBar.current;
    if (!element) return;
    const revealSelected = () => {
      const button = element.querySelector<HTMLElement>(
        '[aria-current="page"]',
      );
      if (!button || element.scrollWidth <= element.clientWidth) return;
      const offset = button.offsetLeft - element.offsetLeft;
      if (offset < element.scrollLeft) element.scrollLeft = offset;
      else if (
        offset + button.offsetWidth >
        element.scrollLeft + element.clientWidth
      )
        element.scrollLeft = offset + button.offsetWidth - element.clientWidth;
    };
    revealSelected();
    const observer = new ResizeObserver(revealSelected);
    observer.observe(element);
    return () => observer.disconnect();
  }, [tab]);
  const report = surfaces.report;
  const reportContent = useCallback(
    (state: WorkspaceTaskState) => report("content", state),
    [report],
  );
  if (!workspace) return <p role="alert">请从测评管理重新进入工作区。</p>;
  const { productId, read } = workspace;
  const value = read.value;
  const presentation = value ? productPresentation(value) : undefined;
  const current =
    value?.content.draft.state === "present"
      ? value.content.draft.value.target
      : undefined;
  const selected =
    selection ?? launched?.target ?? (entry.scope ? requestedTarget : current);
  function switchTab(next: TaskTab) {
    if (!surfaces.canSwitch()) return;
    if (surfaces.active && !surfaces.close()) return;
    setVisitedTabs((old) => new Set([...old, next]));
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
      surfaces.open("content");
      return;
    }
    surfaces.open("content");
    surfaces.announce(
      "本页已有保留的内容任务。请先完成或明确结束原任务，再选择其他来源；原文件与操作记录未被替换。",
    );
  }
  function inspectSource(importId: string) {
    if (!surfaces.canSwitch()) return;
    setSourceDetail(importId);
    surfaces.open("source");
  }
  function inspectRevision(target: RevisionTarget) {
    if (!surfaces.canSwitch()) return;
    setRevisionDetail(revisionTargetSchema.parse(target));
    surfaces.open("revision");
  }
  function openVersions() {
    if (!surfaces.canSwitch()) return;
    switchTab("review");
    surfaces.open("versions");
  }
  return (
    <div className={styles.workspace}>
      <header className={styles.heading}>
        <div>
          <Link className={styles.kicker} href="/studio/products">
            测评管理 <ChevronRight size={14} aria-hidden="true" /> 测评工作区
          </Link>
          <div className={styles.headerTags}>
            {value?.directory.primaryCategory && (
              <StatusBadge
                status={{
                  label: value.directory.primaryCategory.name,
                  tone: "info",
                }}
              />
            )}
            <StatusBadge
              status={{
                label: value?.directory.archivedAt ? "已归档" : "仅内测",
                tone: value?.directory.archivedAt ? "neutral" : "success",
              }}
            />
          </div>
          <div className={styles.titleRow}>
            <h1>{value?.directory.title ?? "正在读取测评"}</h1>
          </div>
          <p className={styles.subtitle}>
            当前内容：
            {current
              ? `草稿 r${current.revision}`
              : value?.content.draft.state === "none"
                ? "尚无草稿"
                : "待读取核实"}
            {presentation?.review && <> · {presentation.review.label}</>}
            {" · "}
            {session.operator.role === "read-only"
              ? "只读身份"
              : "仅限内部测试"}
          </p>
        </div>
        <div className={styles.actions}>
          <button onClick={() => surfaces.open("history")}>
            <History size={18} aria-hidden="true" />
            记录与历史
          </button>
          <button onClick={() => surfaces.open("settings")}>
            <Settings size={18} aria-hidden="true" />
            基本设置
          </button>
          <button
            className={styles.refresh}
            onClick={read.refresh}
            disabled={read.loading}
            aria-label="刷新当前状态"
            title="刷新当前状态"
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
        </div>
      </header>
      {routeNotice && (
        <p className={styles.notice} role="alert">
          {routeNotice}
        </p>
      )}
      {entry.scope && !requestedTarget && (
        <section
          className={styles.notice}
          role={fixedRead.error ? "alert" : "status"}
        >
          <p>
            {fixedRead.error
              ? `固定目标读取失败：${fixedRead.error}，不会改为当前最新修订。`
              : `正在核对地址指定的固定 r${entry.scope.revision}，不会替换为当前草稿。`}
          </p>
          {fixedRead.error && (
            <button onClick={fixedRead.refresh}>重新读取指定修订</button>
          )}
        </section>
      )}
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
      <nav ref={tabBar} className={styles.tabs} aria-label="测评核心任务">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? styles.activeTab : undefined}
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
      <div className={styles.workspaceGrid}>
        <div className={styles.mainColumn}>
          <div hidden={tab !== "content"}>
            <ContentWorkbench
              value={value}
              loading={read.loading}
              error={read.error}
              taskState={surfaces.states.content}
              previewBlocked={authority.isRevoked}
              readOnly={
                !roleHasCapability(session.operator.role, "import:create") ||
                authority.isRevoked
              }
              onOpenTask={() => surfaces.open("content")}
              onOpenHistory={openRevisions}
              onOpenImports={() => surfaces.open("imports")}
              onInspectSource={inspectSource}
              onPreview={launchPreview}
            />
          </div>
          <div hidden={tab !== "preview"}>
            <div className={styles.columns}>
              <section className={styles.panel}>
                <div className={styles.sectionHeading}>
                  <div>
                    <h2>体验预览</h2>
                    <p>日常体验默认指向当前草稿；历史内容按需选择。</p>
                  </div>
                  <button onClick={openRevisions}>历史修订</button>
                </div>
                {selected ? (
                  <>
                    <div className={styles.cardHead}>
                      <div>
                        <h3>
                          {current && sameRevisionTarget(selected, current)
                            ? "当前草稿预览"
                            : "历史修订预览"}
                        </h3>
                        <p>选择目标：r{selected.revision} · 固定修订</p>
                      </div>
                      <StatusBadge
                        status={previewSelectionStatus(
                          { productId, target: selected },
                          productId,
                          value,
                        )}
                      />
                    </div>
                    <div
                      className={styles.previewDisplay}
                      aria-label="固定修订预览入口"
                    >
                      <Eye size={28} aria-hidden="true" />
                      <strong>{value?.directory.title ?? "测评内容"}</strong>
                      <span>
                        r{selected.revision} · 打开后查看真实封面与内容
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <button
                        className={styles.primary}
                        disabled={authority.isRevoked}
                        onClick={() => launchPreview(selected)}
                      >
                        <Eye size={18} aria-hidden="true" />
                        体验 r{selected.revision} 完整流程
                      </button>
                      <button onClick={openRevisions}>选择其他修订</button>
                    </div>
                    <p className={styles.previewHint}>
                      打开预览不会自动登记人工体验，也不会替代审核依据。
                    </p>
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
                    <button onClick={() => switchTab("content")}>
                      去处理内容
                    </button>
                  </>
                )}
              </section>
              <aside className={styles.panel}>
                <h3>预览什么？</h3>
                <ul className={styles.previewChecklist}>
                  {[
                    ["封面与答题", "检查视觉布局和阅读体验"],
                    ["结果揭晓", "检查对应结果与内容表现"],
                    ["完整报告与海报", "核对展示及导出入口"],
                  ].map(([title, description]) => (
                    <li key={title}>
                      <CheckCircle2 size={24} aria-hidden="true" />
                      <div>
                        <strong>{title}</strong>
                        <p>{description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className={styles.previewHint}>
                  新修订产生时，已打开的预览仍保持原目标和本页进度。
                </p>
              </aside>
            </div>
          </div>
          {visitedTabs.has("review") && (
            <ReviewWorkbench
              productId={productId}
              session={session}
              key={scopeKey}
              currentTarget={current}
              initialTarget={entry.scope ? requestedTarget : undefined}
              requireInitialTarget={Boolean(entry.scope)}
              visible={tab === "review"}
              onChanged={read.refresh}
              onGoToTesting={() => switchTab("testing")}
              onPreviewTarget={launchPreview}
              onInspectRevision={inspectRevision}
            />
          )}
          {visitedTabs.has("testing") && (
            <div hidden={tab !== "testing"} className={styles.testingPane}>
              <StudioConsumerAccessPageV1
                key={`${consumerScope.instanceId}:${consumerScope.issuerId}:${consumerScope.productId}`}
                scope={consumerScope}
                renderers={consumerRenderers}
                workspaceAuthority={authority}
                visible={tab === "testing"}
                onChanged={read.refresh}
                onGoToReview={() => switchTab("review")}
              />
            </div>
          )}
        </div>
        <WorkspaceAside
          value={value}
          onHistory={() => surfaces.open("history")}
        />
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
          onInspectSource={inspectSource}
          onInspectRevision={inspectRevision}
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
          <button onClick={openVersions}>查看历史固定版本</button>
        </div>
      </RetainedTaskSurface>
      <RetainedTaskSurface id="imports">
        <ContentRecords
          productId={productId}
          onContinue={continueSource}
          onInspect={inspectSource}
        />
      </RetainedTaskSurface>
      <RetainedTaskSurface id="revisions">
        {historyScope ? (
          <RevisionHistoryPanel
            embedded
            productId={productId}
            draftId={historyScope.draftId}
            currentRevision={current?.revision ?? historyScope.revision}
            onSelect={choosePreview}
            onFailure={observeHistoryFailure}
            onInspectSource={inspectSource}
            onInspectRevision={inspectRevision}
          />
        ) : (entry.scope ? fixedRead.loading : read.loading) ? (
          <p role="status">正在读取草稿范围，请稍候…</p>
        ) : (entry.scope ? fixedRead.error : read.error) ? (
          <section role="alert" className={styles.notice}>
            <p>草稿范围读取失败，尚不能判定是否存在可读修订。</p>
            <p>{entry.scope ? fixedRead.error : read.error}</p>
            <button onClick={entry.scope ? fixedRead.refresh : read.refresh}>
              重新读取草稿范围
            </button>
          </section>
        ) : !entry.scope && value?.content.draft.state === "none" ? (
          <p>尚无可读取的草稿修订。</p>
        ) : (
          <p role="status">草稿范围尚待核实，不会改用其他来源。</p>
        )}
      </RetainedTaskSurface>
      <RetainedTaskSurface id="source">
        {sourceDetail && (
          <ContentSourceDetails
            key={sourceDetail}
            productId={productId}
            sourceId={sourceDetail}
            session={session}
            onContinue={continueSource}
          />
        )}
      </RetainedTaskSurface>
      <RetainedTaskSurface id="revision">
        {revisionDetail && (
          <RevisionDetails
            key={JSON.stringify(revisionDetail)}
            productId={productId}
            target={revisionDetail}
            onPreview={launchPreview}
            onInspectSource={inspectSource}
          />
        )}
      </RetainedTaskSurface>
      <RetainedTaskSurface id="settings">
        <ProductDetail productId={productId} session={session} />
      </RetainedTaskSurface>
      <RetainedTaskSurface id="preview">
        {launched && (
          <CurrentFixedRevisionPreviewPage
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
