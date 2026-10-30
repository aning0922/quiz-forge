"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { ConsumerFetch } from "../consumer-v1/request";
import { readConsumerProtocol } from "./client";

type SessionProps = { sessionId: string; initialScreen?: "report" };
export type CurrentConsumerSessionProps = SessionProps & {
  renderV1: (props: SessionProps) => ReactNode;
  renderV2: (props: SessionProps) => ReactNode;
  fetcher?: ConsumerFetch;
};
export function CurrentConsumerSession({
  sessionId,
  initialScreen,
  renderV1,
  renderV2,
  fetcher,
}: CurrentConsumerSessionProps) {
  const [selection, setSelection] = useState<{
    sessionId: string;
    protocol: "v1" | "v2" | "unavailable";
  }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const active = new AbortController();
    void readConsumerProtocol(sessionId, {
      signal: active.signal,
      ...(fetcher ? { fetcher } : {}),
    }).then(
      (protocol) => {
        if (!active.signal.aborted) setSelection({ sessionId, protocol });
      },
      () => {
        if (!active.signal.aborted)
          setSelection({ sessionId, protocol: "unavailable" });
      },
    );
    return () => active.abort();
  }, [sessionId, fetcher, attempt]);
  const selected =
    selection?.sessionId === sessionId ? selection.protocol : null;
  const props = { sessionId, ...(initialScreen ? { initialScreen } : {}) };
  if (selected === "v1") return renderV1(props);
  if (selected === "v2") return renderV2(props);
  return (
    <main>
      <h1>
        {selected === "unavailable"
          ? "暂时无法核对体验版本"
          : "正在核对体验版本"}
      </h1>
      <p role="status">
        {selected === "unavailable"
          ? "尚未取得可信的固定协议；没有切换到其他版本。"
          : "正在读取当前授权会话。"}
      </p>
      {selected === "unavailable" && (
        <button
          onClick={() => {
            setSelection(undefined);
            setAttempt((n) => n + 1);
          }}
        >
          重新核对
        </button>
      )}
      <a href="/access">返回访问入口</a>
    </main>
  );
}
