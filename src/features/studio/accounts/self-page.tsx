"use client";
import { useId, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  LockKeyhole,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { StudioSessionDto } from "../contracts";
import { useWorkspaceRead } from "../workspace/use-request";
import { studioFetch, studioMessage } from "../client";
import { invalidateStudioAuthority } from "../authority-events";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { PasswordField } from "./password-field";
import { passwordProblem, operatorName, roleLabel } from "./presentation";
import { useAccountOperation } from "./use-operation";
import { AccountOperationPanel } from "./operation-panel";
import { useOwnedStudioSession, useStudioAccountOwner } from "./session-owner";
import {
  AccountAvatar,
  AccountOverlay,
  RoleBadge,
  StatusBadge,
} from "./account-ui";
import type { AccountDto } from "./contracts";
import styles from "./experience.module.css";
import access from "./access.module.css";

export function MyAccountPage({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession),
    owner = useStudioAccountOwner();
  const read = useWorkspaceRead<AccountDto>("/api/studio/accounts/me");
  const change = useAccountOperation(session, "password"),
    all = useAccountOperation(session, "logout-all");
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [message, setMessage] = useState("");
  const [modal, setModal] = useState<"password" | "current" | "all" | null>(
      null,
    ),
    [loggingOut, setLoggingOut] = useState(false);
  const logoutLock = useRef(false),
    formId = useId();
  const dirty = Boolean(current || next || confirm),
    pending = Boolean(change.pending || all.pending);
  const protection = useStudioLeaveProtection({
    dirty,
    pending: pending || loggingOut,
  });
  const name = read.value?.displayName ?? operatorName(session.operator);
  const busy = change.busy || all.busy || loggingOut;
  function open(which: "password" | "current" | "all") {
    setMessage("");
    setModal(which);
  }
  function close() {
    if (!busy) setModal(null);
  }
  function leave() {
    protection.markSaved();
    invalidateStudioAuthority();
    // Re-enter the authentication boundary as a document after confirming this local operation.
    window.location.assign(
      new URL("/studio/login", window.location.origin).href,
    );
  }
  function finishAndLeave(operation: typeof change) {
    if (operation.finish()) leave();
  }
  async function password() {
    if (change.blocked || all.pending) return;
    const problem = passwordProblem(next);
    if (problem || next !== confirm) {
      setMessage(problem ?? "两次新密码不一致。");
      return;
    }
    setMessage("");
    const request = change.submit(
      "/api/studio/accounts/me/password",
      "POST",
      "password-change",
      session.operator.id,
      { currentPassword: current, newPassword: next },
    );
    // Passwords remain in memory only and are erased immediately after submitting.
    setCurrent("");
    setNext("");
    setConfirm("");
    await request;
  }
  async function logoutAll() {
    if (!all.blocked && !change.pending) {
      setCurrent("");
      setNext("");
      setConfirm("");
      await all.submit(
        "/api/studio/accounts/me/logout-all",
        "POST",
        "logout-all",
        session.operator.id,
        {},
      );
    }
  }
  async function logout() {
    if (logoutLock.current || owner?.revoked || pending) return;
    logoutLock.current = true;
    setCurrent("");
    setNext("");
    setConfirm("");
    setLoggingOut(true);
    setMessage("");
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
      leave();
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      logoutLock.current = false;
      setLoggingOut(false);
    }
  }
  const changeDone = change.receipt?.status === "completed",
    allDone = all.receipt?.status === "completed";
  const ended = changeDone || allDone;
  return (
    <div className={styles.page} data-account-access="self">
      <header className={styles.heading}>
        <div>
          <h1>我的账号</h1>
          <p>个人信息与安全操作分开管理，减少误操作。</p>
        </div>
      </header>
      <div className={access.columns}>
        <div className={access.stack}>
          <section
            className={`${styles.card} ${styles.cardPad}`}
            aria-label="本人资料"
          >
            <div className={access.identity}>
              <div className={access.largeAvatar}>
                <AccountAvatar name={name} />
              </div>
              <div>
                <strong>{name}</strong>
                <p>
                  {read.value?.loginName ??
                    session.operator.loginName ??
                    "登录账号暂不可用"}
                </p>
              </div>
            </div>
            <div className={access.profilePills}>
              <RoleBadge role={read.value?.role ?? session.operator.role} />
              {read.value && <StatusBadge status={read.value.status} />}
            </div>
            <dl className={styles.kv}>
              <div>
                <dt>显示名称</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>登录账号</dt>
                <dd>
                  {read.value?.loginName ?? session.operator.loginName ?? "—"}
                </dd>
              </div>
              <div>
                <dt>当前角色</dt>
                <dd>{roleLabel(read.value?.role ?? session.operator.role)}</dd>
              </div>
              <div>
                <dt>账号状态</dt>
                <dd>
                  {read.value
                    ? {
                        active: "可登录",
                        pending: "待设置密码",
                        disabled: "已停用",
                      }[read.value.status]
                    : read.error
                      ? "暂不可用"
                      : "正在核对本人资料…"}
                </dd>
              </div>
            </dl>
            {read.error && (
              <div className={styles.error} role="alert">
                {read.error}
                <button type="button" onClick={read.refresh}>
                  重新读取资料
                </button>
              </div>
            )}
          </section>
          <div className={`${styles.hint} ${access.inlineHint}`}>
            <ShieldCheck size={18} aria-hidden="true" />
            <p>
              此处仅查看本人资料。修改显示名请联系管理员；退出登录后，待确认业务请求不会自动重发。
            </p>
          </div>
        </div>
        <div className={access.stack}>
          <section className={`${styles.card} ${styles.cardPad}`}>
            <h2>账号安全</h2>
            <p className={styles.muted}>
              建议使用独立长口令，支持粘贴和密码管理器。
            </p>
            <div className={access.securityLinks}>
              <button
                className={access.securityLink}
                disabled={
                  ended ||
                  Boolean(owner?.revoked) ||
                  Boolean(all.pending) ||
                  loggingOut
                }
                onClick={() => open("password")}
              >
                <span className={access.icon}>
                  <LockKeyhole size={21} aria-hidden="true" />
                </span>
                <span>
                  <strong>修改登录密码</strong>
                  <span>需验证当前密码，成功后退出全部登录</span>
                </span>
                <ChevronRight
                  className={access.arrow}
                  size={18}
                  aria-hidden="true"
                />
              </button>
              <button
                className={access.securityLink}
                disabled={
                  ended ||
                  Boolean(owner?.revoked) ||
                  Boolean(change.pending) ||
                  loggingOut
                }
                onClick={() => open("all")}
              >
                <span className={access.icon}>
                  <LogOut size={21} aria-hidden="true" />
                </span>
                <span>
                  <strong>退出全部登录</strong>
                  <span>撤销这个账号的所有已登录会话</span>
                </span>
                <ChevronRight
                  className={access.arrow}
                  size={18}
                  aria-hidden="true"
                />
              </button>
            </div>
          </section>
          <section className={`${styles.card} ${styles.cardPad}`}>
            <h2>当前登录</h2>
            {ended ? (
              <p className={styles.muted} role="status">
                当前登录已失效。请完成原操作记录后重新登录。
              </p>
            ) : (
              <dl className={styles.kv}>
                <div>
                  <dt>空闲到期时间</dt>
                  <dd>
                    {new Date(session.idleExpiresAt).toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>最长到期时间</dt>
                  <dd>
                    {new Date(session.absoluteExpiresAt).toLocaleString(
                      "zh-CN",
                    )}
                  </dd>
                </div>
              </dl>
            )}
            <button
              className={`${styles.danger} ${access.currentExit}`}
              disabled={busy || pending || Boolean(owner?.revoked)}
              onClick={() => open("current")}
            >
              退出当前登录
            </button>
          </section>
        </div>
      </div>
      {modal !== "password" && dirty && !change.pending && (
        <aside
          className={`${styles.hint} ${styles.warn} ${access.inlineNotice}`}
          aria-label="保留的密码输入"
        >
          <p>有尚未提交的密码修改，输入仅保留在当前页。</p>
          <div className={styles.actions}>
            <button onClick={() => open("password")}>继续修改密码</button>
            <button
              onClick={() => {
                setCurrent("");
                setNext("");
                setConfirm("");
                setMessage("");
              }}
            >
              放弃未提交输入
            </button>
          </div>
        </aside>
      )}
      {modal !== "password" && change.pending && (
        <aside className={`${styles.hint} ${styles.warn}`}>
          <p>有一项本人改密操作尚未结束。</p>
          <button onClick={() => open("password")}>继续处理原改密操作</button>
        </aside>
      )}
      {modal !== "all" && all.pending && (
        <aside className={`${styles.hint} ${styles.warn}`}>
          <p>有一项退出全部登录的操作尚未结束。</p>
          <button onClick={() => open("all")}>继续处理原退出操作</button>
        </aside>
      )}
      <AccountOverlay
        open={modal === "password"}
        variant="modal"
        title="修改登录密码"
        description="操作完成后退出所有登录会话"
        onClose={close}
        canClose={!busy}
        footer={
          changeDone ? (
            <button
              className={styles.primary}
              onClick={() => finishAndLeave(change)}
            >
              完成并返回登录
            </button>
          ) : !change.pending ? (
            <>
              <button onClick={close}>
                {dirty ? "收起并保留输入" : "取消"}
              </button>
              <button
                className={styles.primary}
                type="submit"
                form={formId}
                disabled={change.blocked || Boolean(all.pending)}
              >
                确认修改密码
              </button>
            </>
          ) : (
            <button onClick={close} disabled={busy}>
              收起并保留记录
            </button>
          )
        }
      >
        {changeDone && (
          <div className={access.success} role="status">
            <CheckCircle2 size={28} aria-hidden="true" />
            <h3>登录密码已修改</h3>
            <p>该账号的全部登录已失效。完成本次记录后，请使用新密码登录。</p>
          </div>
        )}
        <form
          id={formId}
          className={access.form}
          hidden={Boolean(change.pending)}
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
          <p className={styles.muted}>
            15–256
            个字符，可包含空格，不自动裁剪。成功后，这个账号的全部登录会话都会失效。
          </p>
        </form>
        {modal === "password" && message && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <div className={access.recovery} hidden={changeDone}>
          <AccountOperationPanel
            operation={change}
            onFinished={() => {
              setMessage("");
              setModal(null);
            }}
          />
        </div>
      </AccountOverlay>
      <AccountOverlay
        open={modal === "all"}
        variant="modal"
        title="退出全部登录"
        description="请确认操作范围"
        onClose={close}
        canClose={!busy}
        footer={
          allDone ? (
            <button
              className={styles.primary}
              onClick={() => finishAndLeave(all)}
            >
              完成并返回登录
            </button>
          ) : !all.pending ? (
            <>
              <button onClick={close}>保留登录</button>
              <button
                className={styles.danger}
                disabled={all.blocked || Boolean(change.pending)}
                onClick={() => void logoutAll()}
              >
                确认退出全部登录
              </button>
            </>
          ) : (
            <button onClick={close} disabled={busy}>
              收起并保留记录
            </button>
          )
        }
      >
        {allDone ? (
          <div className={access.success} role="status">
            <CheckCircle2 size={28} aria-hidden="true" />
            <h3>全部登录已退出</h3>
            <p>完成本次记录后，请重新登录。</p>
          </div>
        ) : (
          <div className={`${styles.hint} ${styles.warn}`}>
            当前账号所有设备上的登录都会被撤销，包括本页。之后需要重新登录；待核实的原业务操作不会自动重发。
          </div>
        )}
        {dirty && (
          <p className={styles.error}>
            本页还有未提交的密码输入；确认退出将放弃这些输入。
          </p>
        )}
        <div className={access.recovery} hidden={allDone}>
          <AccountOperationPanel
            operation={all}
            onFinished={() => setModal(null)}
          />
        </div>
      </AccountOverlay>
      <AccountOverlay
        open={modal === "current"}
        variant="modal"
        title="退出当前登录"
        description="请确认操作范围"
        onClose={close}
        canClose={!busy}
        footer={
          <>
            <button onClick={close} disabled={loggingOut}>
              保留登录
            </button>
            <button
              className={styles.danger}
              disabled={loggingOut || Boolean(owner?.revoked) || pending}
              onClick={() => void logout()}
            >
              {loggingOut ? "正在退出…" : "确认退出当前登录"}
            </button>
          </>
        }
      >
        <div className={`${styles.hint} ${styles.warn}`}>
          仅退出当前登录会话，其他设备不受影响。页面中待核实的原业务操作不会自动重发。
        </div>
        {dirty && (
          <p className={styles.error}>
            本页还有未提交的密码输入；确认退出将放弃这些输入。
          </p>
        )}
        {modal === "current" && message && (
          <p className={styles.error} role="alert">
            {message}
          </p>
        )}
      </AccountOverlay>
    </div>
  );
}
