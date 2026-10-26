"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import type { PreviewScope } from "@/features/product/preview/contracts";
import {
  samePreviewBindingV2,
  type CurrentPreviewSelection,
  type TemporaryPreviewResultV2,
} from "@/features/product/preview/contracts-v2";
import type { StudioSessionDto } from "../contracts";
import { useOwnedStudioSession } from "../accounts/session-owner";
import {
  InternalAuthorityProvider,
  useInternalAuthority,
  type InternalProductAuthority,
} from "../internal-versions/authority";
import { StudioClientError } from "../client";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { draftRevisionPath } from "../drafts/client";
import { StudioStructurePreviewV2 } from "@/features/theme/consumer-v2/studio-structure-preview";
import { FixedRevisionPreviewPage } from "./page";
import { PreviewClientError, previewMessage } from "./client";
import { fetchCurrentPreviewEntry, fetchTemporaryPreviewV2 } from "./client-v2";
import { TemporaryPreviewFlowV2 } from "./flow-v2";
import styles from "./preview.module.css";

const emptyInputs = { answers: [], matchingContext: null } as const;
const emptySnapshot = () => emptyInputs;
const noSubscription = () => () => undefined;
type Props = {
  scope: PreviewScope;
  session: StudioSessionDto;
  embedded?: boolean;
  authority?: InternalProductAuthority;
};
export function CurrentFixedRevisionPreviewPage(props: Props) {
  return (
    <InternalAuthorityProvider productId={props.scope.productId}>
      <CurrentPreviewOwner
        key={`${props.scope.productId}/${props.scope.draftId}/${props.scope.revision}`}
        {...props}
      />
    </InternalAuthorityProvider>
  );
}
function CurrentPreviewOwner({
  scope: inputScope,
  session: initialSession,
  embedded = false,
  authority: provided,
}: Props) {
  const inherited = useInternalAuthority(),
    authority = provided ?? inherited;
  useSyncExternalStore(
    authority.subscribe,
    authority.getSnapshot,
    authority.getServerSnapshot,
  );
  const session = useOwnedStudioSession(initialSession);
  const scope = useMemo(
    () => ({
      productId: inputScope.productId,
      draftId: inputScope.draftId,
      revision: inputScope.revision,
    }),
    [inputScope.productId, inputScope.draftId, inputScope.revision],
  );
  const [selection, setSelection] = useState<CurrentPreviewSelection>(),
    [message, setMessage] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0),
    [observedRead, setObservedRead] = useState<{
      attempt: number;
      authority: InternalProductAuthority;
    }>(),
    [readFailed, setReadFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<TemporaryPreviewResultV2 | null>(null);
  const loading =
    !authority.isRevoked &&
    (observedRead?.attempt !== attempt || observedRead.authority !== authority);
  const flow = useMemo(
    () =>
      selection?.mode === "structured"
        ? new TemporaryPreviewFlowV2(selection.value)
        : null,
    [selection],
  );
  const inputs = useSyncExternalStore(
    flow?.subscribe ?? noSubscription,
    flow?.getSnapshot ?? emptySnapshot,
    flow?.getSnapshot ?? emptySnapshot,
  );
  const selectionRef = useRef<CurrentPreviewSelection | undefined>(undefined),
    scoring = useRef<AbortController | undefined>(undefined),
    read = useRef<AbortController | undefined>(undefined);
  const cancel = () => {
    flow?.invalidate();
    scoring.current?.abort();
    setBusy(false);
    setResult(null);
  };
  const failure = (error: unknown) => {
    if (
      error instanceof PreviewClientError &&
      [
        "UNAUTHENTICATED",
        "CAPABILITY_DENIED",
        "CSRF_REJECTED",
        "ORIGIN_REJECTED",
      ].includes(error.code)
    ) {
      const wasRevoked = authority.isRevoked;
      authority.observe(new StudioClientError(error.code));
      if (!wasRevoked && authority.isRevoked)
        invalidateCurrentStudioAuthority();
    }
    setMessage(previewMessage(error));
  };
  useEffect(() => {
    const active = new AbortController();
    read.current = active;
    if (authority.isRevoked) {
      return () => active.abort();
    }
    const ticket = authority.capture();
    void fetchCurrentPreviewEntry(scope, active.signal)
      .then((value) => {
        if (active.signal.aborted || !authority.accepts(ticket)) return;
        const previous = selectionRef.current;
        const binding = (s: CurrentPreviewSelection) =>
          s.mode === "legacy" ? s.binding : s.value.binding;
        if (
          previous &&
          (previous.mode !== value.mode ||
            !samePreviewBindingV2(binding(previous), binding(value)))
        )
          throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
        selectionRef.current = value;
        setSelection((previous) => previous ?? value);
        setReadFailed(false);
        setMessage(null);
        setObservedRead({ attempt, authority });
      })
      .catch((error) => {
        if (!active.signal.aborted && authority.accepts(ticket)) {
          failure(error);
          setReadFailed(true);
          setObservedRead({ attempt, authority });
        }
      });
    return () => active.abort();
    // Failure observes only this unchanged authority; callbacks never trigger a score.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, attempt, authority]);
  useEffect(
    () =>
      authority.subscribe(() => {
        if (authority.isRevoked) {
          read.current?.abort();
          scoring.current?.abort();
          flow?.invalidate();
          setResult(null);
          setBusy(false);
          setMessage(
            "当前预览权限已失效，原偏好与临时答案保留；不会自动重试计算。",
          );
        }
      }),
    [authority, flow],
  );
  useEffect(
    () => () => {
      read.current?.abort();
      scoring.current?.abort();
      flow?.invalidate();
    },
    [flow],
  );
  const score = async () => {
    if (authority.isRevoked || busy || loading || readFailed || !flow) return;
    const owner = flow,
      active = new AbortController(),
      authorityTicket = authority.capture();
    scoring.current?.abort();
    scoring.current = active;
    let ticket: ReturnType<TemporaryPreviewFlowV2["begin"]>;
    try {
      ticket = owner.begin(crypto.randomUUID());
    } catch {
      setMessage("请先明确人物偏好并完成每道题的临时选择。");
      return;
    }
    setBusy(true);
    setResult(null);
    setMessage(null);
    try {
      const value = await fetchTemporaryPreviewV2(
        ticket.request,
        session.csrfToken,
        active.signal,
      );
      if (
        !active.signal.aborted &&
        authority.accepts(authorityTicket) &&
        owner.accepts(ticket, value)
      ) {
        setResult(value);
        setBusy(false);
      }
    } catch (error) {
      if (!active.signal.aborted && authority.accepts(authorityTicket)) {
        setBusy(false);
        failure(error);
      }
    }
  };
  if (selection?.mode === "legacy")
    return (
      <FixedRevisionPreviewPage
        scope={scope}
        session={session}
        embedded={embedded}
        authority={authority}
      />
    );
  const temporary = selection?.mode === "structured" ? selection.value : null;
  return (
    <div className={`${styles.preview} ${embedded ? styles.embedded : ""}`}>
      {!embedded && (
        <nav className={styles.navigation}>
          <Link
            href={draftRevisionPath(
              scope.productId,
              scope.draftId,
              scope.revision,
            )}
          >
            返回固定修订原文
          </Link>
          <Link href="/studio">返回运营空间</Link>
        </nav>
      )}
      <p>
        固定目标：修订 {scope.revision}
        。临时输入留在本页；刷新后重置，不保存消费者进度、不封存报告、不提供
        PNG。
      </p>
      {temporary?.entry.kind === "synthetic" && (
        <p>合成测试内容，仅供结构与流程验证。</p>
      )}
      {loading && <p role="status">正在读取并核验固定修订…</p>}
      <StudioStructurePreviewV2
        revision={scope.revision}
        entry={temporary?.entry ?? null}
        result={result?.result ?? null}
        answers={inputs.answers}
        matchingContext={inputs.matchingContext}
        busy={busy}
        disabled={authority.isRevoked || loading || readFailed || !temporary}
        message={message}
        onAnswer={(question, option) => {
          if (authority.isRevoked || busy || loading || readFailed || !flow)
            return;
          cancel();
          flow.edit(question, option);
          setMessage(null);
        }}
        onPreference={(preference) => {
          if (authority.isRevoked || busy || loading || readFailed || !flow)
            return;
          cancel();
          flow.preference(preference);
          setMessage(null);
        }}
        onScore={() => {
          void score();
        }}
      />
      {busy && (
        <button
          onClick={() => {
            cancel();
            setMessage("已取消本次临时计算，偏好和答案继续保留。");
          }}
        >
          取消本次预览计算
        </button>
      )}
      {!loading && !authority.isRevoked && (
        <button
          disabled={busy}
          onClick={() => {
            cancel();
            setAttempt((n) => n + 1);
          }}
        >
          重新核验固定修订
        </button>
      )}
    </div>
  );
}
