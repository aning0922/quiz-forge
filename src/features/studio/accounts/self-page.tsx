"use client";
import { useId, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { StudioSessionDto } from "../contracts";
import { useWorkspaceRead } from "../workspace/use-request";
import { invalidateStudioAuthority } from "../authority-events";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { AccountWorkspaceNav } from "./workspace-nav";
import { roleHasCapability } from "@/lib/auth/role-policy";
import { useCurrentStudioLogout } from "./use-current-logout";
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
  );
  const formId = useId();
  const currentLogout = useCurrentStudioLogout(session);
  const loggingOut = currentLogout.busy;
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
    currentLogout.clearMessage();
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
    if (loggingOut || owner?.revoked || pending) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setMessage("");
    await currentLogout.submit(protection.markSaved);
  }
  const changeDone = change.receipt?.status === "completed",
    allDone = all.receipt?.status === "completed";
  const ended = changeDone || allDone;
  return (
    <div className={styles.page} data-account-access="self">
      <header className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>QUIZFORGE STUDIO / OPERATOR</div>
          <h1>我的账号</h1>
          <p>个人信息与安全操作分开管理，不把改密或退出动作做成常驻表单。</p>
        </div>
      </header>
      <AccountWorkspaceNav role={session.operator.role} />
      <section
        className={`${styles.card} ${access.identityCard}`}
        aria-label="本人资料"
      >
        <div className={access.largeAvatar}>
          <AccountAvatar name={name} />
        </div>
        <div className={access.identityText}>
          <h2>{name}</h2>
          <p>
            {read.value?.loginName ?? session.operator.loginName} ·{" "}
            {roleLabel(session.operator.role)} ·{" "}
            {ended ? "登录已结束" : "当前登录"}
          </p>
          <div className={styles.pills}>
            <RoleBadge role={read.value?.role ?? session.operator.role} />
            {read.value && <StatusBadge status={read.value.status} />}
          </div>
        </div>
        {read.error && (
          <div className={styles.error} role="alert">
            {read.error}
            <button onClick={read.refresh}>重新读取资料</button>
          </div>
        )}
      </section>
      <div className={access.columns}>
        <section className={`${styles.card} ${styles.cardPad}`}>
          <div className={access.sectionTitle}>
            <div>
              <h2>账号安全</h2>
              <p>操作需本人确认；改密与退出全部会撤销登录。</p>
            </div>
            <ShieldCheck size={21} aria-hidden="true" />
          </div>
          <div className={access.securityLinks}>
            <div className={access.securityItem}>
              <div>
                <h3>修改登录密码</h3>
                <p>需要验证当前密码，成功后全部设备重新登录。</p>
              </div>
              <button
                disabled={
                  ended ||
                  Boolean(owner?.revoked) ||
                  Boolean(all.pending) ||
                  loggingOut
                }
                onClick={() => open("password")}
              >
                修改密码
              </button>
            </div>
            <div className={access.securityItem}>
              <div>
                <h3>退出当前登录</h3>
                <p>只退出正在使用的会话，其他登录不会自动退出。</p>
              </div>
              <button
                disabled={ended || busy || pending || Boolean(owner?.revoked)}
                onClick={() => open("current")}
              >
                退出当前
              </button>
            </div>
            <div className={access.securityItem}>
              <div>
                <h3>退出全部登录</h3>
                <p>撤销该账号所有会话，重新登录才可操作。</p>
              </div>
              <button
                className={styles.danger}
                disabled={
                  ended ||
                  Boolean(owner?.revoked) ||
                  Boolean(change.pending) ||
                  loggingOut
                }
                onClick={() => open("all")}
              >
                退出全部
              </button>
            </div>
          </div>
        </section>
        <aside className={`${styles.card} ${styles.cardPad}`}>
          <div className={access.sectionTitle}>
            <div>
              <h2>角色与权限</h2>
              <p>能力来自服务端策略。</p>
            </div>
          </div>
          <p className={styles.muted}>
            当前为{roleLabel(session.operator.role)}。
            {roleHasCapability(session.operator.role, "account:manage")
              ? "可以管理成员、审核封存与内容运营操作。"
              : roleHasCapability(session.operator.role, "workspace:write")
                ? "可维护测评、导入内容、发放和作废未领取访问码；审核封存由管理员完成。"
                : "仅可查看测评、版本和已授权的安全信息，不可进行业务写入。"}
          </p>
          <div className={`${styles.hint} ${access.sessionHint}`}>
            {ended ? (
              <p role="status">当前登录已失效。请完成原操作记录后重新登录。</p>
            ) : (
              <dl className={access.sessionFacts}>
                <div>
                  <dt>空闲到期</dt>
                  <dd>
                    {new Date(session.idleExpiresAt).toLocaleString("zh-CN")}
                  </dd>
                </div>
                <div>
                  <dt>最长到期</dt>
                  <dd>
                    {new Date(session.absoluteExpiresAt).toLocaleString(
                      "zh-CN",
                    )}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <p className={access.profileHelp}>
            修改显示名称请联系管理员。待确认的原业务操作不会自动重发。
          </p>
        </aside>
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
        size="short"
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
            value={session.operator.loginName}
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
        size="short"
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
        size="short"
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
        {modal === "current" && currentLogout.message && (
          <p className={styles.error} role="alert">
            {currentLogout.message}
          </p>
        )}
      </AccountOverlay>
    </div>
  );
}
