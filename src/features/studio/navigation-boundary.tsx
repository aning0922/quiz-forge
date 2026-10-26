"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  advanceStudioRequestEpoch,
  invalidateCurrentStudioAuthority,
} from "./authority-events";
import styles from "./navigation-boundary.module.css";

type Protection = { dirty: boolean; pending: boolean; message?: string };
type Entry = { current: Protection; saved: boolean };
const ProtectionContext = createContext<{
  entries: Map<symbol, Entry>;
  allow: () => boolean;
} | null>(null);

/** Explicit exits use the same live task guard as ordinary navigation. */
export function useStudioLeaveGate() {
  const context = useContext(ProtectionContext);
  return context?.allow ?? (() => false);
}

/** UI-only leave protection. It never grants authority or settles a write. */
export function useStudioLeaveProtection(value: Protection) {
  const entries = useContext(ProtectionContext)?.entries;
  const key = useRef(Symbol("studio-leave"));
  const entry = useRef<Entry>({ current: value, saved: false });
  useLayoutEffect(() => {
    entry.current.current = value;
  });
  useLayoutEffect(() => {
    const id = key.current;
    const record = entry.current;
    entries?.set(id, record);
    return () => {
      entries?.delete(id);
    };
  }, [entries]);
  return {
    // Only after the existing service has confirmed a successful save, immediately
    // before a document replacement. This does not clear any other registration.
    markSaved() {
      entry.current.saved = true;
    },
  };
}

/** File/form pages keep document history boundaries, including their deep links. */
function documentBoundary(path: string) {
  return (
    path === "/studio/new-product" ||
    path === "/studio/taxonomy" ||
    path.startsWith("/studio/products/")
  );
}

export function studioSameTabLink(event: MouseEvent<HTMLElement>) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return null;
  const anchor =
    event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[href]")
      : null;
  if (
    !anchor ||
    !event.currentTarget.contains(anchor) ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target !== "_self")
  )
    return null;
  const url = new URL(anchor.href, window.location.href);
  if (!/^https?:$/.test(url.protocol)) return null;
  if (
    url.origin === window.location.origin &&
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash
  )
    return null;
  return url;
}

export function StudioNavigationBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const [entries] = useState(() => new Map<symbol, Entry>());
  const [recoveryNotice, setRecoveryNotice] = useState(false);
  const permittedUnload = useRef(false);
  function active() {
    return [...entries.values()]
      .filter((entry) => !entry.saved)
      .map((entry) => entry.current);
  }
  function allow() {
    const values = active();
    const pending = values.find((value) => value.pending);
    if (pending) {
      setRecoveryNotice(true);
      window.alert(
        pending.message ??
          "当前操作尚未确认，原输入仍保留在此页。请先完成核实或处理，再离开。",
      );
      return false;
    }
    return (
      !values.some((value) => value.dirty) ||
      window.confirm(
        "此页有尚未保存的输入或文件。离开将放弃这些内容，确定离开吗？",
      )
    );
  }
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (permittedUnload.current) {
        permittedUnload.current = false;
        return;
      }
      const protectedPage = [...entries.values()].some(
        ({ current, saved }) => !saved && (current.dirty || current.pending),
      );
      if (protectedPage) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    function pageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        // Re-enter through server authentication after a BFCache restore; never
        // continue a frozen page's old operator/CSRF presentation.
        permittedUnload.current = true;
        window.location.reload();
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", invalidateCurrentStudioAuthority);
    window.addEventListener("pageshow", pageShow);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", invalidateCurrentStudioAuthority);
      window.removeEventListener("pageshow", pageShow);
    };
  }, [entries]);
  return (
    <ProtectionContext.Provider value={{ entries, allow }}>
      <div
        style={{ display: "contents" }}
        onClickCapture={(event) => {
          const url = studioSameTabLink(event);
          if (!url || event.defaultPrevented) return;
          if (url.href === window.location.href) {
            // Selecting the current page is a no-op, including plain anchors.
            // Do not discard inputs or revoke the persistent account owner.
            event.preventDefault();
            return;
          }
          if (!allow()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (
            url.origin !== window.location.origin ||
            documentBoundary(window.location.pathname) ||
            documentBoundary(url.pathname)
          ) {
            invalidateCurrentStudioAuthority();
            event.preventDefault();
            event.stopPropagation();
            permittedUnload.current = true;
            window.location.assign(url.href);
          } else {
            // A Next.js layout survives SPA navigation. Retire old requests,
            // while actual authentication failures retain the revoke path.
            advanceStudioRequestEpoch();
          }
        }}
        onSubmitCapture={(event) => {
          if (
            !(event.target instanceof HTMLFormElement) ||
            !event.target.hasAttribute("data-studio-navigation-form")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (!allow()) return;
          const form = event.target;
          const url = new URL(form.action, window.location.href);
          new FormData(form).forEach((value, key) => {
            if (typeof value === "string") url.searchParams.set(key, value);
          });
          invalidateCurrentStudioAuthority();
          permittedUnload.current = true;
          window.location.assign(url.href);
        }}
      >
        {recoveryNotice && (
          <aside className={styles.notice} aria-label="保留当前操作并恢复身份">
            <p>
              当前操作尚未确认，原文件与输入仍保留在本页。需要重新登录时，请在新标签继续；本页不会自动重发请求。
            </p>
            <div>
              <a href="/studio/login" target="_blank" rel="noopener">
                在新标签重新登录
              </a>
              <button type="button" onClick={() => setRecoveryNotice(false)}>
                收起提示
              </button>
            </div>
          </aside>
        )}
        {children}
      </div>
    </ProtectionContext.Provider>
  );
}
