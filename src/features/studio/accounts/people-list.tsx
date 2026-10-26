"use client";

import { Check, ChevronRight, Clock3, LockKeyhole, Users } from "lucide-react";
import type { AccountDto, AccountListDto } from "./contracts";
import { AccountAvatar, RoleBadge, StatusBadge } from "./account-ui";
import styles from "./experience.module.css";

export function accountDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AccountSummary({
  summary,
}: {
  summary: AccountListDto["summary"] | undefined;
}) {
  const stats = [
    { key: "total", label: "全部账号", detail: "当前后台人员", Icon: Users },
    { key: "active", label: "可登录", detail: "已完成密码设置", Icon: Check },
    {
      key: "pending",
      label: "待设置密码",
      detail: "等待本人完成开通",
      Icon: Clock3,
    },
    {
      key: "disabled",
      label: "已停用",
      detail: "无法登录后台",
      Icon: LockKeyhole,
    },
  ] as const;
  return (
    <section className={styles.stats} aria-label="全部账号概览">
      {stats.map(({ key, label, detail, Icon }) => (
        <div className={styles.stat} key={key}>
          <div className={styles.statLabel}>
            <Icon aria-hidden="true" />
            {label}
          </div>
          <div className={styles.statNum} data-account-stat={key}>
            {summary ? summary[key] : "—"}
          </div>
          <div className={styles.statDetail}>{detail}</div>
        </div>
      ))}
    </section>
  );
}

export function AccountPerson({ account }: { account: AccountDto }) {
  return (
    <div className={styles.person}>
      <AccountAvatar
        name={account.displayName}
        tone={
          account.role === "operator"
            ? "blue"
            : account.role === "read-only"
              ? "green"
              : "purple"
        }
      />
      <div>
        <div className={styles.personLabel}>{account.displayName}</div>
        <div className={styles.personSub}>{account.loginName}</div>
      </div>
    </div>
  );
}

export function PeopleList({
  value,
  loading,
  onOpen,
  onPage,
  onReset,
}: {
  value: AccountListDto;
  loading: boolean;
  onOpen: (account: AccountDto) => void;
  onPage: (offset: number) => void;
  onReset: () => void;
}) {
  const manage = (account: AccountDto) => (
    <button
      type="button"
      aria-label={`查看与管理 ${account.displayName}`}
      onClick={() => onOpen(account)}
    >
      查看与管理
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
  return (
    <>
      <div className={styles.tableContainer}>
        <table className={styles.accountTable} aria-label="人员账号">
          <colgroup>
            <col style={{ width: "27%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "17%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "20%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">人员</th>
              <th scope="col">角色</th>
              <th scope="col">账号状态</th>
              <th scope="col">创建时间</th>
              <th scope="col">管理操作</th>
            </tr>
          </thead>
          <tbody>
            {value.items.map((account) => (
              <tr key={account.id}>
                <td>
                  <AccountPerson account={account} />
                </td>
                <td>
                  <RoleBadge role={account.role} />
                </td>
                <td>
                  <StatusBadge status={account.status} />
                </td>
                <td>{accountDate(account.createdAt)}</td>
                <td>{manage(account)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.mobileCards} aria-label="人员账号卡片">
        {value.items.map((account) => (
          <article className={styles.mobileCard} key={account.id}>
            <AccountPerson account={account} />
            <div className={styles.pills}>
              <RoleBadge role={account.role} />
              <StatusBadge status={account.status} />
            </div>
            <div className={styles.personSub}>
              创建于 {accountDate(account.createdAt)}
            </div>
            {manage(account)}
          </article>
        ))}
      </div>
      {!value.items.length && (
        <p className={styles.empty}>
          没有符合条件的人员，请调整搜索或筛选条件。
        </p>
      )}
      <div className={styles.tableFoot}>
        <span>
          共 {value.total} 位人员
          {value.items.length
            ? `，显示 ${value.offset + 1}–${value.offset + value.items.length} 位`
            : ""}
        </span>
        <nav className={styles.pagination} aria-label="账号分页">
          <button
            disabled={!value.offset || loading}
            onClick={() => onPage(Math.max(0, value.offset - value.limit))}
          >
            上一页
          </button>
          <span>
            第 {Math.floor(value.offset / value.limit) + 1} /{" "}
            {Math.max(1, Math.ceil(value.total / value.limit))} 页
          </span>
          <button
            disabled={!value.hasMore || loading}
            onClick={() => onPage(value.offset + value.limit)}
          >
            下一页
          </button>
          <button onClick={onReset}>重置</button>
        </nav>
      </div>
    </>
  );
}
