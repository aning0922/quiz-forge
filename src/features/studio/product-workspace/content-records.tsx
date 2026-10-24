"use client";

import { useEffect, useState } from "react";
import type { ImportDto, Page } from "@/features/quizpack/import/contracts";
import { checkedImportFetch, checkImportPage } from "../imports/client";
import { importMessage } from "../imports/messages";
import { useInternalAuthority } from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import styles from "./task-workspace.module.css";

const labels: Record<ImportDto["status"], string> = {
  "awaiting-upload": "等待原文件上传",
  receiving: "接收结果待核实",
  received: "内容包已接收",
  "retryable-failed": "需要读取原记录后恢复",
  rejected: "接收已拒绝",
};
export function ContentRecords({
  productId,
  onContinue,
}: {
  productId: string;
  onContinue: (importId: string) => void;
}) {
  const authority = useInternalAuthority();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    value?: Page<ImportDto>;
    error?: string;
  }>();
  const key = `${productId}/${page}/${attempt}`;
  const loading = result?.key !== key;
  useEffect(() => {
    const controller = new AbortController();
    void checkedImportFetch<Page<ImportDto>>(
      `/api/studio/products/${encodeURIComponent(productId)}/imports?page=${page}&pageSize=10`,
      { signal: controller.signal },
      (value) => checkImportPage(value, { productId, page, pageSize: 10 }),
    ).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ key, value });
      },
      (error) => {
        if (controller.signal.aborted) return;
        const revoked = authority.isRevoked;
        authority.observe(error);
        if (!revoked && authority.isRevoked) invalidateCurrentStudioAuthority();
        setResult({ key, error: importMessage(error) });
      },
    );
    return () => controller.abort();
  }, [productId, page, attempt, key, authority]);
  return (
    <div className={styles.history}>
      <p>先选择需要继续处理的接收记录，再进入任务。接收成功不代表检查通过。</p>
      <button disabled={loading} onClick={() => setAttempt((n) => n + 1)}>
        重新读取记录
      </button>
      {loading ? (
        <p role="status">正在读取本测评的接收记录…</p>
      ) : result?.error ? (
        <p role="alert">{result.error}</p>
      ) : (
        result?.value && (
          <>
            {!result.value.items.length && <p>本页暂无接收记录。</p>}
            {result.value.items.map((item) => (
              <section className={styles.record} key={item.id}>
                <h3>{labels[item.status]}</h3>
                <p>
                  {directoryTime(item.createdAt)} ·{" "}
                  {Math.ceil(item.expectedArchiveBytes / 1024)} KB
                </p>
                {item.storageCondition !== "clean" && (
                  <p>存储状态待核实，不能直接开始下一步。</p>
                )}
                {item.status === "received" &&
                item.storageCondition === "clean" ? (
                  <button onClick={() => onContinue(item.id)}>
                    选择此来源并继续
                  </button>
                ) : (
                  <a
                    href={`/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(item.id)}`}
                    target="_blank"
                    rel="noopener"
                  >
                    查看原接收记录与恢复条件
                  </a>
                )}
                <TechnicalDetails label="来源记录标识">
                  <p>接收编号：{item.id}</p>
                  <p>原声明 SHA-256：{item.expectedArchiveSha256}</p>
                </TechnicalDetails>
              </section>
            ))}
            <div className={styles.actions}>
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>第 {page} 页</span>
              <button
                disabled={!result.value.hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )
      )}
    </div>
  );
}
