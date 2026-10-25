"use client";

import { useEffect, useState } from "react";
import type { ImportDto, Page } from "@/features/quizpack/import/contracts";
import { checkedImportFetch, checkImportPage } from "../imports/client";
import { importMessage } from "../imports/messages";
import { useInternalAuthority } from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import styles from "./content-workbench.module.css";

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
  onInspect,
}: {
  productId: string;
  onContinue: (importId: string) => void;
  onInspect?: ((importId: string) => void) | undefined;
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
    <div className={styles.source}>
      <p className={styles.intro}>
        按准确来源查看接收与检查，继续处理不会创建新的接收记录。
      </p>
      {loading ? (
        <p role="status">正在读取来源记录…</p>
      ) : result?.error ? (
        <p className={styles.warning} role="alert">
          {result.error}
        </p>
      ) : (
        result?.value && (
          <>
            {!result.value.items.length && (
              <p>尚无已读取的接收记录；空列表不证明未知请求未提交。</p>
            )}
            <ol className={styles.recordList}>
              {result.value.items.map((item) => (
                <li className={styles.compactRow} key={item.id}>
                  <div className={styles.rowHeading}>
                    <div>
                      <strong>{labels[item.status]}</strong>
                      <p className={styles.caption}>
                        {directoryTime(item.createdAt)} ·{" "}
                        {Math.ceil(item.expectedArchiveBytes / 1024)} KB
                      </p>
                    </div>
                    {onInspect && (
                      <button
                        className={styles.secondary}
                        onClick={() => onInspect(item.id)}
                      >
                        查看来源
                      </button>
                    )}
                  </div>
                  {item.storageCondition !== "clean" && (
                    <p className={styles.warning}>
                      存储状态待核实，不能直接开始下一步。
                    </p>
                  )}
                  {!(
                    item.status === "rejected" &&
                    item.storageCondition === "clean"
                  ) && (
                    <button
                      className={styles.textButton}
                      onClick={() => onContinue(item.id)}
                    >
                      {item.status === "received" &&
                      item.storageCondition === "clean"
                        ? "继续处理此来源"
                        : "核实原接收任务"}
                    </button>
                  )}
                  <TechnicalDetails label="来源身份与文件声明">
                    <p>接收编号：{item.id}</p>
                    <p>SHA-256：{item.expectedArchiveSha256}</p>
                  </TechnicalDetails>
                </li>
              ))}
            </ol>
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                上一页
              </button>
              <span>第 {page} 页</span>
              <button
                className={styles.secondary}
                disabled={!result.value.hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </button>
            </div>
          </>
        )
      )}
      <button
        className={styles.textButton}
        disabled={loading}
        onClick={() => setAttempt((n) => n + 1)}
      >
        重新读取记录
      </button>
    </div>
  );
}
