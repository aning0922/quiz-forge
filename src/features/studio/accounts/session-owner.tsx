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
import { studioOperatorIdentitySchema } from "@/lib/auth/identity";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import {
  acceptsStudioEpoch,
  advanceStudioRequestEpoch,
  captureStudioEpoch,
  subscribeStudioAuthorityInvalidation,
} from "../authority-events";
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
/** Isolated components use their input session; a mounted owner supplies updates only for the same operator ID. */
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
  onSessionChange,
}: {
  initialSession: StudioSessionDto;
  children: ReactNode;
  onSessionChange?: (session: StudioSessionDto) => void;
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
    [confirmed, setConfirmed] = useState(false);
  const revoke = useCallback(() => {
    setState((old) => (old.revoked ? old : { ...old, revoked: true }));
    setCandidate(undefined);
    setConfirmed(false);
  }, []);
  useEffect(() => subscribeStudioAuthorityInvalidation(revoke), [revoke]);
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
        !studioOperatorIdentitySchema.safeParse(fresh?.operator).success ||
        !fresh.csrfToken
      )
        throw Error();
      if (fresh.operator.id !== ownerId) {
        setMessage(
          "当前登录的是其他账号。文件、输入和待确认操作已保留，请使用原账号重新登录后继续。",
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
        `已核对账号 ${operatorName(fresh.operator)}（${roleLabel(fresh.operator.role)}）。继续任务后，请先核实之前待确认的操作。`,
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
    // Publish only the session explicitly accepted for this unchanged owner.
    // Keep the callback outside the state updater, which React may replay.
    onSessionChange?.(candidate);
    setCandidate(undefined);
    setConfirmed(false);
    setMessage("");
  }
  return (
    <Context.Provider value={state}>
      {state.revoked && (
        <aside
          className={`${styles.page} ${styles.notice}`}
          aria-label="核对原账号并恢复任务"
        >
          <p>
            登录或权限状态已变化，请检查后继续。未保存内容会保留，已提交的操作不会自动重试。
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
              {checking ? "正在检查…" : "检查登录状态"}
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
                我已核对账号与操作状态，继续后先核实待确认结果
              </label>
              <button
                type="button"
                disabled={!confirmed || checking}
                onClick={recover}
              >
                继续原任务
              </button>
            </>
          )}
        </aside>
      )}
      {children}
    </Context.Provider>
  );
}
