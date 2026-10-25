"use client";
import { useOwnedStudioSession } from "./session-owner";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { StudioSessionDto } from "../contracts";
import {
  roleHasCapability,
  studioRoles,
  type StudioRole,
} from "@/lib/auth/role-policy";
import { useWorkspaceRead } from "../workspace/use-request";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { invalidateStudioAuthority } from "../authority-events";
import type { AccountDto, AccountListDto, AccountAction } from "./contracts";
import { useAccountOperation } from "./use-operation";
import { AccountOperationPanel } from "./operation-panel";
import { roleLabel } from "./presentation";
import styles from "./accounts.module.css";
const statusLabel = {
  pending: "待本人设置密码",
  active: "可登录",
  disabled: "已停用",
};
const actions = [
  "display-name",
  "role",
  "disable",
  "restore",
  "issue-setup",
  "issue-reset",
  "revoke-sessions",
] as const;
const actionLabel: Record<string, string> = {
  create: "开通账号",
  "display-name": "修改显示名称",
  role: "修改角色",
  disable: "停用账号",
  restore: "恢复账号",
  "issue-setup": "重新签发设置入口",
  "issue-reset": "签发重置入口",
  "revoke-sessions": "撤销全部登录",
};
export function AccountsPage({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const [search, setSearch] = useState(""),
    [q, setQ] = useState(""),
    [status, setStatus] = useState("all"),
    [offset, setOffset] = useState(0);
  const read = useWorkspaceRead<AccountListDto>(
    `/api/studio/accounts?${new URLSearchParams({ q, status, offset: String(offset), limit: "25" })}`,
  );
  const operation = useAccountOperation(session, "management");
  const [selected, setSelected] = useState<AccountDto>(),
    [mode, setMode] = useState<AccountAction>("create"),
    [open, setOpen] = useState(false);
  const [loginName, setLoginName] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [role, setRole] = useState<StudioRole>("operator"),
    [confirmation, setConfirmation] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLElement | null>(null);
  useStudioLeaveProtection({
    dirty: open && Boolean(loginName || displayName),
    pending: operation.busy || Boolean(operation.pending),
  });
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  function close() {
    if (!operation.busy) {
      setOpen(false);
      opener.current?.focus();
    }
  }
  function launch(action: AccountAction, account?: AccountDto) {
    opener.current = document.activeElement as HTMLElement;
    if (!operation.pending) {
      setMode(action);
      setSelected(account);
      setLoginName("");
      setDisplayName(account?.displayName ?? "");
      setRole(account?.role ?? "operator");
      setConfirmation(false);
    }
    setOpen(true);
  }
  async function submit() {
    if (
      !confirmation &&
      [
        "role",
        "disable",
        "issue-setup",
        "issue-reset",
        "revoke-sessions",
      ].includes(mode)
    )
      return;
    const base = "/api/studio/accounts";
    const value =
      mode === "create"
        ? await operation.submit(base, "POST", "create", null, {
            loginName,
            displayName,
            role,
          })
        : selected
          ? await operation.submit(
              mode === "issue-setup" || mode === "issue-reset"
                ? `${base}/${encodeURIComponent(selected.id)}/password-token`
                : mode === "revoke-sessions"
                  ? `${base}/${encodeURIComponent(selected.id)}/revoke-sessions`
                  : `${base}/${encodeURIComponent(selected.id)}`,
              mode === "issue-setup" ||
                mode === "issue-reset" ||
                mode === "revoke-sessions"
                ? "POST"
                : "PATCH",
              mode,
              selected.id,
              {
                expectedRevision: selected.revision,
                ...(mode === "display-name"
                  ? { action: mode, displayName }
                  : mode === "role"
                    ? { action: mode, role }
                    : mode === "disable" || mode === "restore"
                      ? { action: mode }
                      : mode === "issue-setup" || mode === "issue-reset"
                        ? {
                            purpose: mode === "issue-setup" ? "setup" : "reset",
                          }
                        : {}),
              },
            )
          : undefined;
    if (value) {
      read.refresh();
      const op = "operation" in value ? value.operation : value;
      if (
        op.status === "completed" &&
        op.targetId === session.operator.id &&
        ["role", "disable", "revoke-sessions"].includes(mode)
      )
        invalidateStudioAuthority();
    }
  }
  if (!roleHasCapability(session.operator.role, "account:manage"))
    return (
      <p role="alert">
        当前身份不能管理账号。<Link href="/studio/session">前往我的账号</Link>
      </p>
    );
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>账号与权限</h1>
          <p>
            登录账号固定，显示名称可修改。待设置的管理员不能替代已可登录管理员。
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/studio/accounts/audit">账号操作记录</Link>
          <button onClick={() => launch("create")}>开通账号</button>
        </div>
      </header>
      {operation.pending && !open && (
        <section className={styles.notice}>
          <p>原账号操作仍保留，请先核实或明确结束。</p>
          <button onClick={() => setOpen(true)}>继续原账号操作</button>
        </section>
      )}
      <section className={styles.panel}>
        <form
          className={styles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            setQ(search);
            setOffset(0);
          }}
        >
          <div className={styles.field}>
            <label htmlFor="account-search">搜索账号或显示名称</label>
            <input
              id="account-search"
              value={search}
              maxLength={80}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="account-status">账号状态</label>
            <select
              id="account-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="all">全部</option>
              <option value="active">可登录</option>
              <option value="pending">待设置密码</option>
              <option value="disabled">已停用</option>
            </select>
          </div>
          <button>查询账号</button>
        </form>
      </section>
      {read.loading && <p role="status">正在读取账号…</p>}
      {read.error && (
        <section role="alert" className={styles.error}>
          <p>{read.error}</p>
          <button onClick={read.refresh}>重新读取账号</button>
        </section>
      )}
      {read.value && (
        <>
          <div className={styles.cards}>
            {read.value.items.map((account) => (
              <article
                className={`${styles.panel} ${styles.card}`}
                key={account.id}
              >
                <header className={styles.header}>
                  <div>
                    <h2>{account.displayName}</h2>
                    <p>登录账号：{account.loginName ?? "尚未配置"}</p>
                  </div>
                  <span className={styles.badge}>
                    {roleLabel(account.role)} · {statusLabel[account.status]}
                  </span>
                </header>
                <div className={styles.actions}>
                  {actions
                    .filter((action) =>
                      action === "restore"
                        ? account.status === "disabled"
                        : action === "disable"
                          ? account.status !== "disabled"
                          : action === "issue-setup"
                            ? account.status === "pending"
                            : action === "issue-reset"
                              ? account.status === "active"
                              : true,
                    )
                    .map((action) => (
                      <button
                        key={action}
                        className={styles.secondary}
                        disabled={Boolean(operation.pending)}
                        onClick={() => launch(action, account)}
                      >
                        {actionLabel[action]}
                      </button>
                    ))}
                </div>
              </article>
            ))}
          </div>
          {!read.value.items.length && (
            <p className={styles.empty}>当前查询没有账号。</p>
          )}
          <nav className={styles.pagination} aria-label="账号分页">
            <button
              className={styles.secondary}
              disabled={!offset || read.loading}
              onClick={() => setOffset((value) => Math.max(0, value - 25))}
            >
              上一页
            </button>
            <span>第 {Math.floor(offset / 25) + 1} 页</span>
            <button
              className={styles.secondary}
              disabled={!read.value.hasMore || read.loading}
              onClick={() => setOffset((value) => value + 25)}
            >
              下一页
            </button>
          </nav>
        </>
      )}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label="账号操作"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <section className={`${styles.page} ${styles.panel}`}>
          <header className={styles.header}>
            <h2>{operation.pending ? "原账号操作" : actionLabel[mode]}</h2>
            <button
              className={styles.secondary}
              disabled={operation.busy}
              onClick={close}
            >
              收起
            </button>
          </header>
          {selected && (
            <p>
              目标：{selected.displayName} ·{" "}
              {selected.loginName ?? "尚未配置登录账号"} · 信息版本{" "}
              {selected.revision}
            </p>
          )}
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {mode === "create" && (
              <div className={styles.field}>
                <label htmlFor="new-account-login">
                  登录账号（创建后不可修改）
                </label>
                <input
                  id="new-account-login"
                  name="username"
                  required
                  minLength={3}
                  maxLength={64}
                  autoCapitalize="none"
                  autoComplete="off"
                  value={loginName}
                  disabled={operation.blocked}
                  onChange={(event) => setLoginName(event.target.value)}
                />
              </div>
            )}
            {(mode === "create" || mode === "display-name") && (
              <div className={styles.field}>
                <label htmlFor="account-display-name">显示名称</label>
                <input
                  id="account-display-name"
                  required
                  value={displayName}
                  disabled={operation.blocked}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
            )}
            {(mode === "create" || mode === "role") && (
              <div className={styles.field}>
                <label htmlFor="account-role">角色</label>
                <select
                  id="account-role"
                  value={role}
                  disabled={operation.blocked}
                  onChange={(event) =>
                    setRole(event.target.value as StudioRole)
                  }
                >
                  {studioRoles.map((value) => (
                    <option key={value} value={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {[
              "role",
              "disable",
              "issue-setup",
              "issue-reset",
              "revoke-sessions",
            ].includes(mode) && (
              <label>
                <input
                  type="checkbox"
                  checked={confirmation}
                  disabled={operation.blocked}
                  onChange={(event) => setConfirmation(event.target.checked)}
                />
                {mode === "issue-reset" || mode === "issue-setup"
                  ? "确认重新签发：旧入口作废，本人完成设置后已有登录才全部失效。"
                  : "确认影响当前账号权限或登录；服务端将再次校验最后管理员和当前版本。"}
              </label>
            )}
            <button disabled={operation.blocked}>
              确认{actionLabel[mode]}
            </button>
          </form>
          <AccountOperationPanel operation={operation} />
        </section>
      </dialog>
    </div>
  );
}
