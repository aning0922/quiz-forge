"use client";

import type { ReactNode } from "react";
import type { MutationState } from "./use-mutation";
import styles from "./workspace.module.css";

export function ReconcilePanel({
  state,
  reading,
  readError,
  snapshot,
  onRead,
  onUseServer,
  onKeepInput,
}: {
  state: MutationState;
  reading: boolean;
  readError: string;
  snapshot: ReactNode;
  onRead: () => void;
  onUseServer?: () => void;
  onKeepInput?: () => void;
}) {
  if (state.phase !== "conflict" && state.phase !== "unknown") return null;
  return (
    <section className={styles.compare} aria-label="服务器状态核实">
      <h2>
        {state.phase === "conflict" ? "内容发生冲突" : "提交结果尚未确认"}
      </h2>
      <p>{state.message}</p>
      {state.currentRevision !== undefined && (
        <p>
          冲突响应中的服务器修订：{state.currentRevision}。请继续读取最新内容。
        </p>
      )}
      <button
        className={`${styles.button} ${styles.secondary}`}
        type="button"
        disabled={reading}
        onClick={onRead}
      >
        {reading ? "正在读取服务器…" : "读取服务器最新内容"}
      </button>
      {readError && (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {readError}
        </p>
      )}
      {snapshot && (
        <div>
          <p className={styles.note}>
            服务器当前值已确认。以下是当前状态，不是原请求确定成功的证明。未保存输入仍保留在表单中。
          </p>
          {snapshot}
          <div className={styles.actions}>
            {onUseServer && (
              <button
                className={styles.button}
                type="button"
                disabled={reading}
                onClick={onUseServer}
              >
                采用服务器内容
              </button>
            )}
            {onKeepInput && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                type="button"
                disabled={reading}
                onClick={onKeepInput}
              >
                保留我的输入，以最新修订重提
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
