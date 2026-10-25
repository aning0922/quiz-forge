"use client";
import { useStudioAccountOwner } from "./session-owner";
import { useState } from "react";
import type { useAccountOperation } from "./use-operation";
import styles from "./accounts.module.css";
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
          <p>原操作编号：{operation.pending.operationId}</p>
          {operation.receipt && (
            <p>
              原回执：
              {operation.receipt.status === "completed" ? "已完成" : "已拒绝"}
              {operation.receipt.errorCode
                ? ` · ${operation.receipt.errorCode}`
                : ""}
            </p>
          )}
          {link && (
            <div className={styles.secret} data-private-setup-link>
              <p>
                一次性设置入口仅在本次确认响应中提供。请私下交给本人，不要保存到公开文档或截图。
              </p>
              <input
                aria-label="一次性设置入口"
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
                  {revealed ? "隐藏入口" : "显示入口"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link.url)
                      .then(() =>
                        setCopyMessage("已复制，请妥善交付并确认保存。"),
                      )
                      .catch(() =>
                        setCopyMessage("复制失败，请显示入口后手动保存。"),
                      )
                  }
                >
                  复制一次性入口
                </button>
              </div>
              {copyMessage && <p role="status">{copyMessage}</p>}
              <p>
                有效至 {new Date(link.expiresAt).toLocaleString("zh-CN")}
                。本人完成设置后已有登录才全部失效；立即阻断访问请使用停用或撤销会话。
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />
                我已妥善保存或交付该入口
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
          {!link &&
            operation.receipt?.status === "completed" &&
            ["create", "issue-setup", "issue-reset"].includes(
              operation.receipt.action,
            ) && (
              <p>
                已确认签发，但原始入口不在本页。结束原记录后，可明确重新签发；旧入口届时作废。
              </p>
            )}
        </section>
      )}
    </>
  );
}
