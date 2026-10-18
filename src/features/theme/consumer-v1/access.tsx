"use client";
import { useEffect, useRef, useState } from "react";
import { exchangeConsumerAccessV1 } from "./client";
import { ConsumerClientError } from "./request";
import { takeConsumerAccessFragmentV1 } from "./access-fragment";
import {
  consumerPlayPageUrl,
  consumerReportPageUrl,
} from "@/features/fulfillment/consumer-flow/urls";
import styles from "./host.module.css";
/** The raw fragment never becomes React state, DOM, browser storage or a query/path. */
export function ConsumerAccessV1() {
  const raw = useRef<string | null>(null),
    request = useRef<AbortController | null>(null),
    busy = useRef(false);
  const [status, setStatus] = useState<
    "empty" | "ready" | "busy" | "unavailable" | "rate-limited"
  >("empty");
  useEffect(() => {
    const value = takeConsumerAccessFragmentV1(window.location, (url) =>
      history.replaceState(null, "", url),
    );
    if (value) raw.current = value;
    // Fragment capture is synchronous and runs before any exchange or passive request.
    if (raw.current) queueMicrotask(() => setStatus("ready"));
    return () => {
      request.current?.abort();
    };
  }, []);
  async function exchange() {
    if (busy.current || !raw.current) return;
    busy.current = true;
    setStatus("busy");
    const active = new AbortController();
    request.current = active;
    try {
      const result = await exchangeConsumerAccessV1(raw.current, {
        signal: active.signal,
      });
      if (active.signal.aborted) return;
      raw.current = null;
      window.location.replace(
        result.destination === "report"
          ? consumerReportPageUrl(result.session.sessionId)
          : consumerPlayPageUrl(result.session.sessionId),
      );
    } catch (error) {
      if (!active.signal.aborted)
        setStatus(
          error instanceof ConsumerClientError && error.code === "RATE_LIMITED"
            ? "rate-limited"
            : "unavailable",
        );
    } finally {
      busy.current = false;
    }
  }
  return (
    <main className={styles.host}>
      <section className={styles.panel}>
        <h1>进入你的测评</h1>
        <p>
          {status === "empty"
            ? "请使用运营方提供的完整私密链接访问。"
            : status === "busy"
              ? "正在验证访问，请稍候。"
              : status === "rate-limited"
                ? "当前访问较多，请稍后再次验证。"
                : status === "unavailable"
                  ? "暂时无法验证访问。可在本页重新验证，或重新打开原私密链接。"
                  : "私密链接已从地址栏移除。验证后即可读取你的进度或已完成的报告。"}
        </p>
        {status !== "empty" && (
          <button
            disabled={status === "busy"}
            onClick={() => {
              void exchange();
            }}
          >
            {status === "busy" ? "正在验证" : "验证访问"}
          </button>
        )}
        <p>私密链接仅供本人使用，请勿公开分享。</p>
      </section>
    </main>
  );
}
