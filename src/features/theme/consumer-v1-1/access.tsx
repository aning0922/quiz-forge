"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { exchangeConsumerAccessV1 } from "../consumer-v1/client";
import {
  consumerPlayPageUrl,
  consumerReportPageUrl,
} from "@/features/fulfillment/consumer-flow/urls";
import styles from "../consumer-v1/host.module.css";
import { ConsumerAccessLifecycleV1_1 } from "./access-lifecycle";

/** Versioned platform gateway. Raw input never becomes React state or rendered data. */
export function ConsumerAccessV1_1() {
  const lifecycle = useMemo(
    () =>
      new ConsumerAccessLifecycleV1_1({
        readAddress: () => ({
          href: location.href,
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        }),
        erase: (pathname) => history.replaceState(null, "", pathname),
        exchange: (rawKey, signal) =>
          exchangeConsumerAccessV1(rawKey, { signal }),
        navigate: (result) =>
          location.replace(
            result.destination === "report"
              ? consumerReportPageUrl(result.session.sessionId)
              : consumerPlayPageUrl(result.session.sessionId),
          ),
      }),
    [],
  );
  const status = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    lifecycle.getServerSnapshot,
  );
  useEffect(() => {
    const detach = lifecycle.attach();
    const hash = (event: HashChangeEvent) => lifecycle.hashChange(event.newURL);
    const pop = () => lifecycle.historyChange();
    window.addEventListener("hashchange", hash);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("popstate", pop);
      detach();
    };
  }, [lifecycle]);
  return (
    <main className={styles.host}>
      <section className={styles.panel}>
        <h1>进入你的测评</h1>
        <p>
          {status === "empty"
            ? "请使用运营方提供的完整私密链接访问。"
            : status === "blocked"
              ? "暂时无法安全读取私密链接。请重新打开原私密链接。"
              : status === "busy"
                ? "正在验证访问，请稍候。"
                : status === "rate-limited"
                  ? "当前访问较多，请稍后再次验证。"
                  : status === "unavailable"
                    ? "暂时无法验证访问。可在本页重新验证，或重新打开原私密链接。"
                    : "私密链接已从地址栏移除。验证后即可读取你的进度或已完成的报告。"}
        </p>
        {status !== "empty" && status !== "blocked" && (
          <button
            disabled={status === "busy"}
            onClick={() => {
              void lifecycle.verify();
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
