"use client";
import { useStudioAccountOwner } from "./session-owner";
import { useState } from "react";
import { accountActionLabel } from "./presentation";
import type { useAccountOperation } from "./use-operation";
import styles from "./experience.module.css";
export function AccountOperationPanel({
  operation,
  onFinished,
}: {
  operation: ReturnType<typeof useAccountOperation>;
  onFinished?: () => void;
}) {
  const [saved, setSaved] = useState(false),
    [revealed, setRevealed] = useState(false),
    [copyMessage, setCopyMessage] = useState("");
  const revoked = useStudioAccountOwner()?.revoked;
  const link = revoked ? undefined : operation.mutation?.passwordSetup;
  return (
    <>
      {operation.message && (
        <p role="status" className={styles.notice}>
          {operation.message}
        </p>
      )}
      {operation.pending && (
        <section
          className={`${styles.panel} ${styles.recovery}`}
          aria-label="原账号操作"
        >
          <h3>
            {link
              ? "一次性设置入口已生成"
              : accountActionLabel(operation.pending.action)}
          </h3>
          {operation.receipt && (
            <p>
              处理结果：
              {operation.receipt.status === "completed" ? "已完成" : "已拒绝"}
              {operation.receipt.errorCode
                ? ` · ${operation.receipt.errorCode}`
                : ""}
            </p>
          )}
          {link && (
            <div className={styles.secret} data-private-setup-link>
              <p>
                请保存并私下交付给账号本人。该入口仅本次签发时可见，30
                分钟内有效，只能使用一次。
              </p>
              <input
                aria-label="密码设置链接"
                readOnly
                type={revealed ? "text" : "password"}
                value={link.url}
                autoComplete="off"
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? "隐藏链接" : "显示链接"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (!navigator.clipboard?.writeText) throw Error();
                      await navigator.clipboard.writeText(link.url);
                      setCopyMessage("已复制，请妥善交付并确认保存。");
                    } catch {
                      setCopyMessage("复制失败，请显示链接后手动保存。");
                    }
                  }}
                >
                  复制设置链接
                </button>
              </div>
              {copyMessage && <p role="status">{copyMessage}</p>}
              <p>
                有效至 {new Date(link.expiresAt).toLocaleString("zh-CN")}
                。本人完成设置后，原有登录会话失效。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />
                我已妥善保存或发送设置链接
              </label>
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              disabled={operation.busy}
              onClick={() => void operation.resolve()}
            >
              核实原操作
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={
                operation.busy ||
                !operation.canFinish ||
                Boolean(link && !saved)
              }
              onClick={() => {
                if (!operation.finish()) return;
                onFinished?.();
                setSaved(false);
                setRevealed(false);
                setCopyMessage("");
              }}
            >
              明确结束本次记录
            </button>
          </div>
          <details className={styles.technical}>
            <summary>操作记录与技术信息</summary>
            <p>原操作编号：{operation.pending.operationId}</p>
          </details>
          {!link &&
            operation.receipt?.status === "completed" &&
            ["create", "issue-setup", "issue-reset"].includes(
              operation.receipt.action,
            ) && (
              <p>
                原操作已完成，但本页无法再次显示设置链接。结束本次记录后，可重新发送；以前的设置链接将失效。
              </p>
            )}
        </section>
      )}
    </>
  );
}
