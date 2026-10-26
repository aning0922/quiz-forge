"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  KeyRound,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
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
import { useOwnedStudioSession } from "./session-owner";
import { useAccountOperation } from "./use-operation";
import { AccountOperationPanel } from "./operation-panel";
import { AccountOverlay, RoleBadge, StatusBadge } from "./account-ui";
import {
  AccountSummary,
  AccountPerson,
  PeopleList,
  accountDate,
} from "./people-list";
import { AccountWorkspaceNav } from "./workspace-nav";
import { roleLabel } from "./presentation";
import styles from "./experience.module.css";
import local from "./people.module.css";

type PersonAction = Extract<
  AccountAction,
  | "display-name"
  | "role"
  | "disable"
  | "restore"
  | "issue-setup"
  | "issue-reset"
  | "revoke-sessions"
>;
const actionLabels: Record<PersonAction, string> = {
  "display-name": "编辑显示名称",
  role: "调整角色",
  disable: "停用账号",
  restore: "恢复账号",
  "issue-setup": "生成设置入口",
  "issue-reset": "生成密码重置入口",
  "revoke-sessions": "撤销全部登录",
};
const actionIcons = {
  "display-name": Pencil,
  role: ShieldCheck,
  disable: LockKeyhole,
  restore: UserRoundCheck,
  "issue-setup": KeyRound,
  "issue-reset": KeyRound,
  "revoke-sessions": LogOut,
};
const actionDescriptions: Partial<Record<PersonAction, string>> = {
  role: "修改角色后需重新登录。系统会检查并保留至少一位可登录管理员。",
  disable: "停用后该账号无法登录，已有登录也会退出。恢复后可重新使用账号。",
  restore: "恢复账号的使用资格。若尚未完成密码设置，仍需本人设置密码后登录。",
  "issue-setup":
    "生成新的设置入口，以前的设置链接将失效。链接只显示一次，请由管理员手动保存并私下交付本人。",
  "issue-reset":
    "生成新的密码重置入口，以前的设置链接将失效。请由管理员手动保存并私下交付本人；本人改好密码后会退出全部登录。",
  "revoke-sessions":
    "退出该账号当前的全部登录。账号仍可使用，继续操作时需重新登录。",
};
function personActions(account: AccountDto): PersonAction[] {
  return [
    "display-name",
    "role",
    ...(account.status === "disabled"
      ? ["restore"]
      : account.status === "pending"
        ? ["issue-setup", "disable"]
        : ["issue-reset", "revoke-sessions", "disable"]),
  ] as PersonAction[];
}

export function AccountsPage({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const createFormId = useId(),
    personFormId = useId();
  const canManage = roleHasCapability(session.operator.role, "account:manage");
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("all"),
    [filterStatus, setFilterStatus] = useState("all");
  const [query, setQuery] = useState({
    q: "",
    role: "all",
    status: "all",
    offset: 0,
  });
  const read = useWorkspaceRead<AccountListDto>(
    canManage
      ? `/api/studio/accounts?${new URLSearchParams({ ...query, offset: String(query.offset), limit: "25" })}`
      : null,
  );
  const operation = useAccountOperation(session, "management");
  const [surface, setSurface] = useState<"create" | "person" | null>(null),
    [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AccountDto>();
  const [mode, setMode] = useState<PersonAction | null>(null);
  const [loginName, setLoginName] = useState(""),
    [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StudioRole>("operator"),
    [confirmation, setConfirmation] = useState(false);
  const dirty =
    surface === "create"
      ? Boolean(loginName || displayName || role !== "operator")
      : mode === "display-name"
        ? displayName !== selected?.displayName
        : mode === "role"
          ? role !== selected?.role || confirmation
          : Boolean(mode && confirmation);
  const pending = Boolean(operation.pending);
  const link = operation.mutation?.passwordSetup;
  const canClose = !operation.busy && !link;
  useStudioLeaveProtection({ dirty, pending: operation.busy || pending });

  function reset() {
    setSurface(null);
    setSelected(undefined);
    setMode(null);
    setLoginName("");
    setDisplayName("");
    setRole("operator");
    setConfirmation(false);
  }
  function close() {
    if (!canClose) return;
    setOpen(false);
    if (!pending && !dirty) reset();
  }
  function launch(next: "create" | "person", account?: AccountDto) {
    if (pending || operation.busy) {
      setOpen(true);
      return;
    }
    if (
      surface === next &&
      (next === "create" || selected?.id === account?.id)
    ) {
      setOpen(true);
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "放弃当前未提交的账号任务并开始新任务？当前输入将被清除。",
      )
    )
      return;
    reset();
    setSurface(next);
    setSelected(account);
    setOpen(true);
  }
  function chooseAction(action: PersonAction) {
    if (operation.blocked || !selected || !canManage) return;
    if (mode === action) return;
    if (dirty && !window.confirm("放弃当前未提交的修改？当前输入将被清除。"))
      return;
    setMode(action);
    setDisplayName(selected.displayName);
    setRole(selected.role);
    setConfirmation(false);
  }
  function discard() {
    if (
      pending ||
      operation.busy ||
      (dirty && !window.confirm("放弃本次未提交任务？当前输入将被清除。"))
    )
      return;
    if (surface === "person") {
      setMode(null);
      setConfirmation(false);
    } else {
      setOpen(false);
      reset();
    }
  }
  function finished() {
    read.refresh();
    if (
      surface === "person" &&
      selected &&
      operation.mutation?.account &&
      operation.mutation.operation.status === "completed"
    ) {
      setMode(null);
      setConfirmation(false);
    } else {
      setOpen(false);
      reset();
    }
  }
  function applyQuery(
    next = {
      q: search.trim(),
      role: filterRole,
      status: filterStatus,
      offset: 0,
    },
  ) {
    if (JSON.stringify(query) === JSON.stringify(next)) read.refresh();
    else setQuery(next);
  }
  async function submit() {
    if (!canManage || operation.blocked) return;
    if (
      surface !== "create" &&
      (!selected ||
        !mode ||
        (mode !== "display-name" && mode !== "restore" && !confirmation))
    )
      return;
    const base = "/api/studio/accounts";
    const action = surface === "create" ? "create" : mode!;
    const value =
      action === "create"
        ? await operation.submit(base, "POST", "create", null, {
            loginName,
            displayName,
            role,
          })
        : selected
          ? await operation.submit(
              action === "issue-setup" || action === "issue-reset"
                ? `${base}/${encodeURIComponent(selected.id)}/password-token`
                : action === "revoke-sessions"
                  ? `${base}/${encodeURIComponent(selected.id)}/revoke-sessions`
                  : `${base}/${encodeURIComponent(selected.id)}`,
              action === "issue-setup" ||
                action === "issue-reset" ||
                action === "revoke-sessions"
                ? "POST"
                : "PATCH",
              action,
              selected.id,
              {
                expectedRevision: selected.revision,
                ...(action === "display-name"
                  ? { action, displayName }
                  : action === "role"
                    ? { action, role }
                    : action === "disable" || action === "restore"
                      ? { action }
                      : action === "issue-setup" || action === "issue-reset"
                        ? {
                            purpose:
                              action === "issue-setup" ? "setup" : "reset",
                          }
                        : {}),
              },
            )
          : undefined;
    if (!value) return;
    if ("account" in value) setSelected(value.account);
    read.refresh();
    const receipt = "operation" in value ? value.operation : value;
    if (
      receipt.status === "completed" &&
      receipt.targetId === session.operator.id &&
      ["role", "disable", "revoke-sessions"].includes(action)
    )
      invalidateStudioAuthority();
  }
  const disabled = operation.blocked || !canManage;
  const roleField = (
    <div className={styles.field}>
      <label htmlFor="account-role">
        {surface === "create" ? "初始角色" : "角色"}
      </label>
      <select
        id="account-role"
        value={role}
        disabled={disabled}
        onChange={(event) => setRole(event.target.value as StudioRole)}
      >
        {studioRoles.map((value) => (
          <option key={value} value={value}>
            {roleLabel(value)}
            {value === "operator" && surface === "create" ? "（推荐）" : ""}
          </option>
        ))}
      </select>
      {surface === "create" && (
        <p className={local.roleHelp}>
          {role === "admin"
            ? "可管理测评、审核、人员与账号权限。"
            : role === "operator"
              ? "可管理测评内容与访问码，无人员管理权限。"
              : "可查看授权内容，无编辑与人员管理权限。"}
        </p>
      )}
    </div>
  );
  return (
    <div className={styles.page} data-account-access="people">
      {canManage ? (
        <>
          <header className={styles.heading}>
            <div>
              <div className={styles.eyebrow}>QUIZFORGE STUDIO / OPERATOR</div>
              <h1>账号与权限</h1>
              <p>开通运营成员、分配职责并核对账号状态。</p>
            </div>
            <button className={styles.primary} onClick={() => launch("create")}>
              <Plus size={18} aria-hidden="true" />
              开通人员
            </button>
          </header>
          <AccountWorkspaceNav role={session.operator.role} />
          <AccountSummary summary={read.value?.summary} />
          {(pending || surface) && !open && (
            <section className={styles.hint}>
              <p>
                {pending
                  ? "原账号操作仍保留，请先核实或明确结束。"
                  : "未提交的账号任务和输入仍保留。"}
              </p>
              <button onClick={() => setOpen(true)}>
                {pending ? "继续原账号操作" : "继续未提交账号任务"}
              </button>
            </section>
          )}
          <section className={styles.card} aria-label="人员列表">
            <div className={styles.panelHeader}>
              <div>
                <h2>人员账号</h2>
                <p>选择一位人员，在右侧详情抽屉中完成修改。</p>
              </div>
              <span className={styles.panelBadge}>管理员管理</span>
            </div>
            <form
              className={styles.controls}
              onSubmit={(event) => {
                event.preventDefault();
                applyQuery();
              }}
            >
              <div className={`${styles.field} ${styles.searchField}`}>
                <label htmlFor="account-search">姓名或登录账号</label>
                <input
                  id="account-search"
                  placeholder="查找成员"
                  value={search}
                  maxLength={80}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className={`${styles.field} ${styles.filterSelect}`}>
                <label htmlFor="account-filter-role">角色</label>
                <select
                  id="account-filter-role"
                  value={filterRole}
                  onChange={(event) => setFilterRole(event.target.value)}
                >
                  <option value="all">全部角色</option>
                  {studioRoles.map((value) => (
                    <option value={value} key={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={`${styles.field} ${styles.filterSelect}`}>
                <label htmlFor="account-status">账号状态</label>
                <select
                  id="account-status"
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value)}
                >
                  <option value="all">全部状态</option>
                  <option value="active">可登录</option>
                  <option value="pending">待设置密码</option>
                  <option value="disabled">已停用</option>
                </select>
              </div>
              <button className={styles.primary}>应用筛选</button>
            </form>
            {read.loading && (
              <p className={styles.empty} role="status">
                正在读取账号…
              </p>
            )}
            {read.error && (
              <div className={styles.error} role="alert">
                <p>{read.error}</p>
                <button onClick={read.refresh}>重新读取账号</button>
              </div>
            )}
            {read.value && (
              <PeopleList
                value={read.value}
                loading={read.loading}
                onOpen={(account) => launch("person", account)}
                onPage={(offset) => setQuery((value) => ({ ...value, offset }))}
                onReset={() => {
                  setSearch("");
                  setFilterRole("all");
                  setFilterStatus("all");
                  applyQuery({ q: "", role: "all", status: "all", offset: 0 });
                }}
              />
            )}
          </section>
          <div className={styles.hint}>
            修改显示名不会改变历史业务归属；停用或调整角色会撤销旧登录。系统保留至少一名已设密且有效的管理员。
            {read.value?.snapshotAt && (
              <span>账号概览截至 {accountDate(read.value.snapshotAt)}</span>
            )}
          </div>
        </>
      ) : (
        <section className={styles.hint}>
          <p role="alert">
            当前身份不能管理账号。
            <Link href="/studio/session">前往我的账号</Link>
          </p>
          {pending && (
            <button onClick={() => setOpen(true)}>继续原账号操作</button>
          )}
        </section>
      )}

      <AccountOverlay
        open={open}
        variant={surface === "create" ? "modal" : "drawer"}
        title={
          link
            ? "一次性设置入口"
            : surface === "create"
              ? "开通运营人员账号"
              : mode
                ? actionLabels[mode]
                : selected
                  ? "人员详情"
                  : "原账号操作"
        }
        description={
          surface === "create"
            ? link
              ? "本次确认回执中展示；关闭后不提供历史找回"
              : "创建后等待本人设置密码；不自动发送通知或登录"
            : selected
              ? `${selected.displayName} · ${selected.loginName} · r${selected.revision}`
              : "保留原操作编号并核实结果"
        }
        canClose={canClose}
        onClose={close}
        footer={
          <div className={local.taskFooter}>
            {link && <p>请先妥善保存设置链接，再明确结束本次记录。</p>}
            {surface === "person" && mode && !pending ? (
              <>
                <button disabled={operation.busy} onClick={discard}>
                  取消返回详情
                </button>
                <button
                  className={
                    mode === "disable" || mode === "revoke-sessions"
                      ? styles.danger
                      : styles.primary
                  }
                  form={personFormId}
                  type="submit"
                  disabled={
                    disabled ||
                    (mode !== "display-name" &&
                      mode !== "restore" &&
                      !confirmation)
                  }
                >
                  确认{actionLabels[mode]}
                </button>
              </>
            ) : (
              <>
                {!pending && dirty && (
                  <button className={styles.danger} onClick={discard}>
                    放弃输入
                  </button>
                )}
                <button disabled={!canClose} onClick={close}>
                  {dirty || pending
                    ? "收起"
                    : surface === "create"
                      ? "取消"
                      : "关闭"}
                </button>
                {surface === "create" && !pending && (
                  <button
                    className={styles.primary}
                    type="submit"
                    form={createFormId}
                    disabled={disabled}
                  >
                    确认开通账号
                  </button>
                )}
              </>
            )}
          </div>
        }
      >
        {surface === "create" && (
          <div hidden={Boolean(operation.mutation?.account)}>
            <form
              id={createFormId}
              aria-label="开通账号"
              className={styles.formRow}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className={styles.field}>
                <label htmlFor="account-display-name">显示名称</label>
                <input
                  id="account-display-name"
                  required
                  placeholder="如：运营小林"
                  autoComplete="off"
                  value={displayName}
                  disabled={disabled}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
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
                  placeholder="如：lin.ops"
                  autoCapitalize="none"
                  autoComplete="off"
                  value={loginName}
                  disabled={disabled}
                  onChange={(event) => setLoginName(event.target.value)}
                />
                <p className={local.roleHelp}>
                  使用 3–64 位英文字母、数字、点、下划线或连字符。
                </p>
              </div>
              {roleField}
              <div className={styles.hint}>
                创建后生成一次性密码设置链接，由本人设置密码。请私下交付链接。
              </div>
            </form>
          </div>
        )}
        {surface === "create" &&
          selected &&
          operation.receipt?.status === "completed" && (
            <section className={styles.hint} aria-label="已开通的账号">
              <div>
                <h3>账号已开通，等待本人设置密码</h3>
                <p>
                  {selected.displayName} · {selected.loginName} ·{" "}
                  {roleLabel(selected.role)}
                </p>
              </div>
            </section>
          )}
        {surface === "person" && selected && (
          <div className={local.details}>
            <div hidden={Boolean(mode || operation.pending)}>
              <div className={local.identity}>
                <AccountPerson account={selected} />
              </div>
              <div className={styles.pills}>
                <RoleBadge role={selected.role} />
                <StatusBadge status={selected.status} />
              </div>
              <dl className={styles.kv}>
                <div>
                  <dt>创建时间</dt>
                  <dd>{accountDate(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>账号状态</dt>
                  <dd>
                    {
                      {
                        active: "可登录",
                        pending: "待设置密码",
                        disabled: "已停用",
                      }[selected.status]
                    }
                  </dd>
                </div>
                <div>
                  <dt>记录版本</dt>
                  <dd>r{selected.revision}</dd>
                </div>
                {selected.disabledAt && (
                  <div>
                    <dt>停用时间</dt>
                    <dd>{accountDate(selected.disabledAt)}</dd>
                  </div>
                )}
              </dl>
              <section aria-label="账号管理">
                <h3 className={styles.groupTitle}>管理这位人员</h3>
                <div className={styles.actionList}>
                  {personActions(selected).map((action) => {
                    const Icon = actionIcons[action];
                    return (
                      <button
                        key={action}
                        className={
                          action === "disable" ? styles.danger : undefined
                        }
                        disabled={disabled}
                        aria-label={actionLabels[action]}
                        onClick={() => chooseAction(action)}
                      >
                        <span className={local.actionLabel}>
                          <Icon size={18} aria-hidden="true" />
                          <span>
                            {actionLabels[action]}
                            <small>
                              {action === "display-name"
                                ? "不更改登录名或历史记录"
                                : action === "role"
                                  ? "调整后旧登录全部失效"
                                  : action === "disable"
                                    ? "阻止登录并撤销已有会话"
                                    : action === "restore"
                                      ? "恢复使用资格，不恢复旧登录"
                                      : action === "revoke-sessions"
                                        ? "不会更改该账号密码"
                                        : "30 分钟一次性链接，需安全交付"}
                            </small>
                          </span>
                        </span>
                        <ChevronRight size={17} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
            {mode && (
              <form
                id={personFormId}
                className={styles.actionForm}
                hidden={Boolean(operation.receipt)}
                aria-label={actionLabels[mode]}
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit();
                }}
              >
                {mode !== "display-name" && mode !== "role" && (
                  <div className={local.target}>
                    <strong>{selected.displayName}</strong>
                    <p>{selected.loginName}</p>
                    <div className={styles.pills}>
                      <RoleBadge role={selected.role} />
                      <StatusBadge status={selected.status} />
                    </div>
                  </div>
                )}
                {mode === "display-name" && (
                  <div className={styles.field}>
                    <label htmlFor="person-display-name">显示名称</label>
                    <input
                      id="person-display-name"
                      required
                      value={displayName}
                      disabled={disabled}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </div>
                )}
                {mode === "role" && roleField}
                <p
                  className={`${styles.hint} ${mode === "display-name" ? "" : styles.warn}`}
                >
                  {mode === "display-name"
                    ? "修改显示名不会重写这位人员此前的操作归属、账号标识或密码。"
                    : actionDescriptions[mode]}
                </p>
                {mode !== "display-name" && mode !== "restore" && (
                  <label className={styles.checkboxRow}>
                    <input
                      type="checkbox"
                      checked={confirmation}
                      disabled={disabled}
                      onChange={(event) =>
                        setConfirmation(event.target.checked)
                      }
                    />
                    我已了解影响，确认{actionLabels[mode]}
                  </label>
                )}
              </form>
            )}
          </div>
        )}
        {pending && !selected && operation.pending?.targetId && (
          <p className={styles.hint}>
            原操作目标编号：{operation.pending.targetId}
            。请核实原操作记录；列表当前值不代表原请求结果。
          </p>
        )}
        <div className={local.operation}>
          <AccountOperationPanel operation={operation} onFinished={finished} />
        </div>
      </AccountOverlay>
    </div>
  );
}
