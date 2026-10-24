"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { StudioClientError } from "../client";
import { subscribeStudioAuthorityInvalidation } from "../authority-events";
import { useInternalAuthority } from "../internal-versions/authority";
import styles from "./task-surfaces.module.css";

const surfaces = {
  content: { title: "导入或更新测评内容", kind: "task" },
  review: { title: "核对与固定内测内容", kind: "task" },
  play: { title: "创建内测答题版本", kind: "task" },
  issue: { title: "发放内测访问码", kind: "task" },
  void: { title: "确认作废未领取访问码", kind: "task" },
  history: { title: "记录与历史", kind: "drawer" },
  revisions: { title: "内容修订记录", kind: "drawer" },
  imports: { title: "接收与检查记录", kind: "drawer" },
  versions: { title: "固定内测内容版本", kind: "drawer" },
  version: { title: "固定版本详情", kind: "drawer" },
  key: { title: "访问码安全详情", kind: "drawer" },
  source: { title: "内容来源与检查", kind: "drawer" },
  revision: { title: "固定修订内容", kind: "drawer" },
  settings: { title: "基本设置", kind: "drawer" },
  archive: { title: "归档与恢复", kind: "task" },
  preview: { title: "固定修订完整预览", kind: "preview" },
} as const;

export type WorkspaceSurfaceId = keyof typeof surfaces;
export type WorkspaceTaskState = {
  busy: boolean;
  pending: boolean;
  retained: boolean;
  message?: string | undefined;
  blockCloseReason?: string | undefined;
};
type SurfaceContextValue = {
  active: WorkspaceSurfaceId | null;
  visited: ReadonlySet<WorkspaceSurfaceId>;
  host: HTMLDivElement | null;
  actionsHost: HTMLDivElement | null;
  states: Partial<Record<WorkspaceSurfaceId, WorkspaceTaskState>>;
  open: (id: WorkspaceSurfaceId) => boolean;
  close: () => boolean;
  canSwitch: () => boolean;
  announce: (message: string) => void;
  report: (id: WorkspaceSurfaceId, state: WorkspaceTaskState) => void;
};
const SurfaceContext = createContext<SurfaceContextValue | null>(null);

export function useOptionalWorkspaceSurfaces() {
  return useContext(SurfaceContext);
}

export function useWorkspaceSurfaces() {
  const value = useContext(SurfaceContext);
  if (!value) throw Error("PRODUCT_TASK_SURFACE_REQUIRED");
  return value;
}

/** Product-local presentation only. No business operation or completion authority. */
export function ProductTaskSurfaces({ children }: { children: ReactNode }) {
  const authority = useInternalAuthority();
  const [active, setActive] = useState<WorkspaceSurfaceId | null>(null);
  const [visited, setVisited] = useState<ReadonlySet<WorkspaceSurfaceId>>(
    () => new Set(),
  );
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const [states, setStates] = useState<SurfaceContextValue["states"]>({});
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bindHost = useCallback((element: HTMLDivElement | null) => {
    bodyRef.current = element;
    setHost(element);
  }, []);
  const opener = useRef<HTMLElement | null>(null);
  const activeRef = useRef(active);
  const statesRef = useRef(states);
  const positions = useRef<Partial<Record<WorkspaceSurfaceId, number>>>({});
  const report = useCallback(
    (id: WorkspaceSurfaceId, state: WorkspaceTaskState) => {
      const old = statesRef.current[id];
      if (
        old?.busy === state.busy &&
        old.pending === state.pending &&
        old.retained === state.retained &&
        old.message === state.message &&
        old.blockCloseReason === state.blockCloseReason
      )
        return;
      statesRef.current = { ...statesRef.current, [id]: state };
      setStates(statesRef.current);
    },
    [],
  );
  const canSwitch = useCallback(() => {
    const id = activeRef.current;
    const state = id ? statesRef.current[id] : undefined;
    const reason =
      state?.blockCloseReason ||
      (state?.busy ? "本次操作正在处理，请等待结果后再收起任务。" : "");
    if (reason) {
      setNotice(reason);
      return false;
    }
    return true;
  }, []);
  const open = useCallback(
    (id: WorkspaceSurfaceId) => {
      if (activeRef.current === id) return true;
      if (!canSwitch()) return false;
      if (!activeRef.current && document.activeElement instanceof HTMLElement)
        opener.current = document.activeElement;
      activeRef.current = id;
      setNotice("");
      setVisited((old) => new Set([...old, id]));
      setActive(id);
      return true;
    },
    [canSwitch],
  );
  const close = useCallback(() => {
    if (!canSwitch()) return false;
    activeRef.current = null;
    setActive(null);
    setNotice("");
    return true;
  }, [canSwitch]);

  useEffect(
    () =>
      subscribeStudioAuthorityInvalidation(() => {
        authority.observe(new StudioClientError("UNAUTHENTICATED"));
      }),
    [authority],
  );
  useLayoutEffect(() => {
    const element = dialog.current;
    const body = bodyRef.current;
    const scrollPositions = positions.current;
    if (!element) return;
    // The dialog body and every portal target survive close and surface changes.
    // Close the previous modality before opening the next presentation.
    if (element.open) element.close();
    if (!active) {
      if (opener.current?.isConnected) opener.current.focus();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    // Portals bubble React events through their owner, outside this dialog.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    element.addEventListener("keydown", onKeyDown);
    if (body) body.scrollTop = scrollPositions[active] ?? 0;
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      if (body) scrollPositions[active] = body.scrollTop;
      if (element.open) element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [active, host, close]);

  return (
    <SurfaceContext.Provider
      value={{
        active,
        visited,
        host,
        actionsHost,
        states,
        open,
        close,
        canSwitch,
        announce: setNotice,
        report,
      }}
    >
      {children}
      <dialog
        ref={dialog}
        className={styles.dialog}
        data-variant={active ? surfaces[active].kind : "task"}
        data-surface={active ?? undefined}
        aria-labelledby="product-task-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            close();
        }}
      >
        <header className={styles.header}>
          <div>
            <h2 id="product-task-title">
              {active ? surfaces[active].title : "测评任务"}
            </h2>
            <p className={styles.eyebrow}>
              {active === "content"
                ? "在同一任务中完成接收、检查与形成修订"
                : active === "settings"
                  ? "目录资料与管理设置，收起后保留未保存输入"
                  : active && surfaces[active].kind === "drawer"
                    ? "查看准确对象，关闭后回到当前工作区"
                    : active === "preview"
                      ? "真实固定修订 · 临时体验，不记录审核状态"
                      : "核对本次对象后明确确认"}
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label={active === "preview" ? "收起预览" : "关闭当前浮层"}
            onClick={close}
          >
            <X size={22} aria-hidden="true" />
            {active === "preview" && <span>退出预览</span>}
          </button>
        </header>
        {notice && (
          <p className={styles.notice} role="alert">
            {notice}
          </p>
        )}
        {authority.isRevoked && (
          <div className={styles.notice} role="alert">
            <p>
              当前页面权限已失效。原文件、输入与未确认操作保持，新操作已停止。
            </p>
            <a href="/studio/login" target="_blank" rel="noopener">
              在新标签重新登录
            </a>
            <p>登录不会恢复本页旧权限，请保留原记录并在新工作区核实。</p>
          </div>
        )}
        <div className={styles.body} ref={bindHost} />
        <footer className={styles.footer}>
          {active === "preview" && (
            <p className={styles.previewNote}>
              临时体验不会记录人工审核；收起后保留本页进度。
            </p>
          )}
          <button className={styles.returnButton} type="button" onClick={close}>
            {active === "preview"
              ? "返回工作区"
              : active && surfaces[active].kind === "drawer"
                ? "关闭详情"
                : "先返回"}
          </button>
          <div className={styles.actionsHost} ref={setActionsHost} />
        </footer>
      </dialog>
    </SurfaceContext.Provider>
  );
}

/** Lazy mount once. Never move the portal or key it by the currently open layer. */
export function RetainedTaskSurface({
  id,
  children,
}: {
  id: WorkspaceSurfaceId;
  children: ReactNode;
}) {
  const { active, visited, host } = useWorkspaceSurfaces();
  const authority = useInternalAuthority();
  if (!visited.has(id) || !host) return null;
  return createPortal(
    <div hidden={active !== id} data-task-surface={id}>
      <fieldset disabled={authority.isRevoked} className={styles.boundary}>
        {children}
      </fieldset>
    </div>,
    host,
    id,
  );
}

/** Presentation slot only; handlers and business state remain with their original owner. */
export function RetainedTaskActions({
  id,
  visible = true,
  children,
}: {
  id: WorkspaceSurfaceId;
  visible?: boolean;
  children: ReactNode;
}) {
  const { active, visited, actionsHost } = useWorkspaceSurfaces();
  const authority = useInternalAuthority();
  if (!visited.has(id) || !actionsHost) return null;
  return createPortal(
    <fieldset
      hidden={active !== id || !visible}
      disabled={authority.isRevoked}
      data-task-actions={id}
      className={styles.actionGroup}
    >
      {children}
    </fieldset>,
    actionsHost,
    id,
  );
}
