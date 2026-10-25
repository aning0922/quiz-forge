"use client";
import { useOwnedStudioSession } from "./session-owner";
import { useState } from "react";
import Link from "next/link";
import type { StudioSessionDto } from "../contracts";
import { useWorkspaceRead } from "../workspace/use-request";
import { studioFetch, studioMessage } from "../client";
import { invalidateStudioAuthority } from "../authority-events";
import { PasswordField } from "./password-field";
import { passwordProblem, operatorName, roleLabel } from "./presentation";
import { useAccountOperation } from "./use-operation";
import { AccountOperationPanel } from "./operation-panel";
import type { AccountDto } from "./contracts";
import styles from "./accounts.module.css";
export function MyAccountPage({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const read = useWorkspaceRead<AccountDto>("/api/studio/accounts/me");
  const change = useAccountOperation(session, "password"),
    all = useAccountOperation(session, "logout-all");
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState("");
  const [left, setLeft] = useState(false),
    [loggingOut, setLoggingOut] = useState(false);
  async function password() {
    const problem = passwordProblem(next);
    if (problem || next !== confirm) {
      setMessage(problem ?? "两次新密码不一致。");
      return;
    }
    const request = change.submit(
      "/api/studio/accounts/me/password",
      "POST",
      "password-change",
      session.operator.id,
      { currentPassword: current, newPassword: next },
    );
    setCurrent("");
    setNext("");
    setConfirm("");
    const value = await request;
    if (
      value &&
      ("operation" in value ? value.operation : value).status === "completed"
    ) {
      invalidateStudioAuthority();
      setLeft(true);
    }
  }
  async function logoutAll() {
    if (
      !window.confirm(
        "退出当前账号的全部登录，包括本页。其他页面的未确认任务将保留并禁写。",
      )
    )
      return;
    const value = await all.submit(
      "/api/studio/accounts/me/logout-all",
      "POST",
      "logout-all",
      session.operator.id,
      {},
    );
    if (
      value &&
      ("operation" in value ? value.operation : value).status === "completed"
    ) {
      invalidateStudioAuthority();
      setLeft(true);
    }
  }
  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    invalidateStudioAuthority();
    try {
      await studioFetch<void>("/api/studio/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: "{}",
      });
      setLeft(true);
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>我的账号</h1>
          <p>核对身份、修改本人密码并管理登录。</p>
        </div>
        <Link href="/studio">返回工作台</Link>
      </header>
      <section className={styles.panel}>
        <h2>{read.value?.displayName ?? operatorName(session.operator)}</h2>
        <dl className={styles.facts}>
          <div>
            <dt>登录账号</dt>
            <dd>
              {read.value?.loginName ??
                session.operator.loginName ??
                "尚未开通账号密码"}
            </dd>
          </div>
          <div>
            <dt>显示名称</dt>
            <dd>{read.value?.displayName ?? operatorName(session.operator)}</dd>
          </div>
          <div>
            <dt>角色</dt>
            <dd>{roleLabel(session.operator.role)}</dd>
          </div>
          <div>
            <dt>空闲到期</dt>
            <dd>{new Date(session.idleExpiresAt).toLocaleString("zh-CN")}</dd>
          </div>
          <div>
            <dt>登录最长到期</dt>
            <dd>
              {new Date(session.absoluteExpiresAt).toLocaleString("zh-CN")}
            </dd>
          </div>
        </dl>
        {read.value?.legacyCredentialActive && (
          <p className={styles.notice}>
            旧登录仍有效。完成本人设置密码后才切换为账号密码，不会因页面显示“待设置”自动撤销。
          </p>
        )}
        {read.error && <p role="alert">{read.error}</p>}
      </section>
      {left ? (
        <section className={styles.panel}>
          <h2>本次登录已结束</h2>
          <p>请使用账号密码重新登录。其他页面的输入和原操作不会自动重发。</p>
          <Link href="/studio/login" target="_blank" rel="noopener">
            在新标签重新登录
          </Link>
        </section>
      ) : (
        <div className={styles.grid}>
          <section className={styles.panel}>
            <h2>修改本人密码</h2>
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                void password();
              }}
            >
              <input
                autoComplete="username"
                name="username"
                value={session.operator.loginName ?? ""}
                readOnly
                hidden
              />
              <PasswordField
                label="当前密码"
                value={current}
                onChange={setCurrent}
                autoComplete="current-password"
                disabled={change.blocked}
              />
              <PasswordField
                label="新密码"
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                disabled={change.blocked}
              />
              <PasswordField
                label="确认新密码"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                disabled={change.blocked}
              />
              <p>使用15–256字符长口令，可包含空格。成功后全部登录失效。</p>
              <button disabled={change.blocked}>确认修改密码</button>
            </form>
          </section>
          <section className={styles.panel}>
            <h2>登录管理</h2>
            <p>退出不会将原未知请求记为成功或删除其记录。</p>
            <div className={styles.actions}>
              <button disabled={loggingOut} onClick={() => void logout()}>
                退出当前登录
              </button>
              <button
                className={styles.secondary}
                disabled={all.blocked}
                onClick={() => void logoutAll()}
              >
                退出全部登录
              </button>
            </div>
          </section>
        </div>
      )}
      {message && (
        <p role="status" className={styles.notice}>
          {message}
        </p>
      )}
      <AccountOperationPanel operation={change} />
      <AccountOperationPanel operation={all} />
    </div>
  );
}
