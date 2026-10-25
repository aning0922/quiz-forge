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
                设置链接只显示一次。请妥善保存并私下发送给本人，勿公开分享或截图。
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
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link.url)
                      .then(() =>
                        setCopyMessage("已复制，请妥善交付并确认保存。"),
                      )
                      .catch(() =>
                        setCopyMessage("复制失败，请显示链接后手动保存。"),
                      )
                  }
                >
                  复制设置链接
                </button>
              </div>
              {copyMessage && <p role="status">{copyMessage}</p>}
              <p>
                有效至 {new Date(link.expiresAt).toLocaleString("zh-CN")}
                。本人改好密码后会退出全部登录。如需立即停止使用账号，请先停用账号或撤销全部登录。
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
