"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isStudioRole } from "@/lib/auth/role-policy";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import {
  acceptsStudioEpoch,
  advanceStudioRequestEpoch,
  captureStudioEpoch,
  subscribeStudioAuthorityInvalidation,
} from "../authority-events";
import { hasUnownedPending } from "./owned-storage";
import { operatorName, roleLabel } from "./presentation";
import styles from "./accounts.module.css";
type Owner = {
  session: StudioSessionDto;
  generation: number;
  revoked: boolean;
};
const Context = createContext<Owner | null>(null);
export function useStudioAccountOwner() {
  return useContext(Context);
}
/** Props remain a compatibility fallback for isolated components; the live owner never changes ID. */
export function useOwnedStudioSession(
  initial: StudioSessionDto,
): StudioSessionDto;
export function useOwnedStudioSession(
  initial: StudioSessionDto | undefined,
): StudioSessionDto | undefined;
export function useOwnedStudioSession(initial: StudioSessionDto | undefined) {
  const owner = useStudioAccountOwner();
  return initial && owner?.session.operator.id === initial.operator.id
    ? owner.session
    : initial;
}
/** Clear only local acceptance gates after an explicit new generation; never submit/replay. */
export function useStudioRecoveryReset(reset: () => void) {
  const generation = useStudioAccountOwner()?.generation ?? 0;
  const seen = useRef(generation),
    callback = useRef(reset);
  useEffect(() => {
    callback.current = reset;
  });
  useEffect(() => {
    if (seen.current !== generation) {
      seen.current = generation;
      callback.current();
    }
  }, [generation]);
  return generation;
}
export function StudioAccountOwner({
  initialSession,
  children,
}: {
  initialSession: StudioSessionDto;
  children: ReactNode;
}) {
  const [ownerId] = useState(initialSession.operator.id);
  const [state, setState] = useState<Owner>({
    session: initialSession,
    generation: 0,
    revoked: false,
  });
  const [candidate, setCandidate] = useState<StudioSessionDto>(),
    [checking, setChecking] = useState(false),
    [message, setMessage] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [legacy, setLegacy] = useState(false);
  const revoke = useCallback(() => {
    setState((old) => ({ ...old, revoked: true }));
    setCandidate(undefined);
    setConfirmed(false);
  }, []);
  useEffect(() => subscribeStudioAuthorityInvalidation(revoke), [revoke]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        setLegacy(hasUnownedPending(sessionStorage));
      } catch {
        setLegacy(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);
  async function inspect() {
    if (checking) return;
    const epoch = captureStudioEpoch();
    setChecking(true);
    setCandidate(undefined);
    setConfirmed(false);
    try {
      const fresh = await studioFetch<StudioSessionDto>(
        "/api/studio/auth/session",
        {},
      );
      if (
        !fresh?.operator?.id ||
        !isStudioRole(fresh.operator.role) ||
        !fresh.csrfToken
      )
        throw Error();
      if (fresh.operator.id !== ownerId) {
        setMessage(
          "当前浏览器登录的是其他账号。原文件、输入和操作继续由原账号保留，不会迁给新账号；请返回原身份登录。",
        );
        return;
      }
      const product = location.pathname.match(
        /^\/studio\/products\/([^/]+)/,
      )?.[1];
      if (product)
        await studioFetch(`/api/studio/operations/products/${product}`, {});
      if (!acceptsStudioEpoch(epoch)) return;
      setCandidate(fresh);
      setMessage(
        `已只读核实原账号 ${operatorName(fresh.operator)}（${roleLabel(fresh.operator.role)}）及当前服务器状态。恢复后请先核实原未决请求，再明确选择动作。`,
      );
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      setChecking(false);
    }
  }
  function recover() {
    if (!candidate || !confirmed || candidate.operator.id !== ownerId) return;
    advanceStudioRequestEpoch();
    setState((old) => ({
      session: candidate,
      generation: old.generation + 1,
      revoked: false,
    }));
    setCandidate(undefined);
    setConfirmed(false);
    setMessage("");
  }
  return (
    <Context.Provider value={state}>
      {legacy && (
        <aside className={`${styles.page} ${styles.notice}`} role="status">
          <p>
            此标签页仍有未注明账号归属的历史操作记录，已原样保留。不会自动认领、删除或迁给当前账号；请按原身份核对来源。
          </p>
        </aside>
      )}
      {state.revoked && (
        <aside
          className={`${styles.page} ${styles.notice}`}
          aria-label="核对原账号并恢复任务"
        >
          <p>
            当前页面权限已失效。原文件、输入和 UNKNOWN
            仍保留；重新登录不会自动重发。
          </p>
          <div className={styles.actions}>
            <a href="/studio/login" target="_blank" rel="noopener">
              在新标签重新登录
            </a>
            <button
              type="button"
              disabled={checking}
              onClick={() => void inspect()}
            >
              {checking ? "正在只读核实…" : "核对当前登录与服务器状态"}
            </button>
          </div>
          {message && <p role="status">{message}</p>}
          {candidate && (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核对原账号和当前状态；恢复后先读取原操作结果，不自动重发
              </label>
              <button
                type="button"
                disabled={!confirmed || checking}
                onClick={recover}
              >
                明确恢复原任务
              </button>
            </>
          )}
        </aside>
      )}
      {children}
    </Context.Provider>
  );
}
