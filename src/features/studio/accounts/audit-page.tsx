"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, ShieldCheck } from "lucide-react";
import { useWorkspaceRead } from "../workspace/use-request";
import type {
  AccountAction,
  AccountAuditDto,
  AccountAuditListDto,
} from "./contracts";
import { accountActionLabel } from "./presentation";
import { AccountWorkspaceNav } from "./workspace-nav";
import { useStudioAccountOwner } from "./session-owner";
import { AccountOverlay } from "./account-ui";
import styles from "./experience.module.css";
import access from "./access.module.css";
const actions: AccountAction[] = [
  "create",
  "display-name",
  "role",
  "disable",
  "restore",
  "issue-setup",
  "issue-reset",
  "password-setup",
  "password-change",
  "logout-all",
  "revoke-sessions",
  "bootstrap-admin",
  "admin-recovery",
];
function actorName(item: AccountAuditDto) {
  return (
    item.actorDisplayName ??
    (item.action === "password-setup" ? "设置链接持有人" : "本机维护工具")
  );
}
function moment(value: string, full = false) {
  return Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString(
        "zh-CN",
        full
          ? undefined
          : {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            },
      )
    : "时间暂不可用";
}
function Result({ item }: { item: AccountAuditDto }) {
  return (
    <span
      className={`${access.result} ${item.status === "rejected" ? access.rejected : ""}`}
    >
      {item.status === "completed" ? "已完成" : "已拒绝"}
    </span>
  );
}
export function AccountAuditPage() {
  const owner = useStudioAccountOwner();
  const [draft, setDraft] = useState(""),
    [action, setAction] = useState<AccountAction | "all">("all");
  const [query, setQuery] = useState<{
    q: string;
    action: AccountAction | "all";
    offset: number;
  }>({ q: "", action: "all", offset: 0 });
  const [selected, setSelected] = useState<AccountAuditDto>();
  const params = new URLSearchParams({
    q: query.q,
    action: query.action,
    offset: String(query.offset),
    limit: "25",
  });
  const read = useWorkspaceRead<AccountAuditListDto>(
    `/api/studio/accounts/audit?${params}`,
  );
  function reset() {
    setDraft("");
    setAction("all");
    setQuery({ q: "", action: "all", offset: 0 });
  }
  return (
    <div className={styles.page} data-account-access="audit">
      <header className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>QUIZFORGE STUDIO / OPERATOR</div>
          <h1>账号操作记录</h1>
          <p>查看账号开通、角色变更、密码入口和会话撤销等安全操作。</p>
        </div>
        <Link className={styles.button} href="/studio/accounts">
          返回人员管理
        </Link>
      </header>
      <AccountWorkspaceNav role={owner?.session.operator.role ?? "read-only"} />
      <section className={styles.card} aria-label="账号操作记录列表">
        <form
          className={`${styles.controls} ${access.auditFilters}`}
          onSubmit={(event) => {
            event.preventDefault();
            setQuery({ q: draft.trim(), action, offset: 0 });
          }}
        >
          <div className={`${styles.field} ${styles.searchField}`}>
            <label htmlFor="account-audit-q">操作者 / 目标人员</label>
            <input
              id="account-audit-q"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="操作者或目标的姓名、登录账号"
              autoComplete="off"
              maxLength={80}
            />
          </div>
          <div className={`${styles.field} ${styles.filterSelect}`}>
            <label htmlFor="account-audit-action">操作类型</label>
            <select
              id="account-audit-action"
              value={action}
              onChange={(event) =>
                setAction(event.target.value as AccountAction | "all")
              }
            >
              <option value="all">全部操作</option>
              {actions.map((item) => (
                <option key={item} value={item}>
                  {accountActionLabel(item)}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={styles.primary}>
            查询记录
          </button>
          <button type="button" onClick={reset}>
            重置
          </button>
        </form>
        {read.loading && (
          <p className={styles.empty} role="status">
            正在读取操作记录…
          </p>
        )}
        {read.error && (
          <div className={styles.cardPad}>
            <p className={styles.error} role="alert">
              {read.error}
            </p>
            <button onClick={read.refresh}>重新读取记录</button>
          </div>
        )}
        {read.value && (
          <>
            {read.value.items.length ? (
              <>
                <div
                  className={`${styles.tableContainer} ${access.auditDesktop}`}
                >
                  <table
                    className={`${styles.auditTable} ${access.auditTable}`}
                  >
                    <caption className="sr-only">账号安全操作记录</caption>
                    <thead>
                      <tr>
                        <th scope="col">操作</th>
                        <th scope="col">操作者</th>
                        <th scope="col">目标人员</th>
                        <th scope="col">结果</th>
                        <th scope="col">记录时间</th>
                        <th scope="col">详情</th>
                      </tr>
                    </thead>
                    <tbody>
                      {read.value.items.map((item) => (
                        <tr key={item.operationId}>
                          <td>{accountActionLabel(item.action)}</td>
                          <td>{actorName(item)}</td>
                          <td>{item.targetDisplayName}</td>
                          <td>
                            <Result item={item} />
                          </td>
                          <td>{moment(item.createdAt)}</td>
                          <td>
                            <button
                              onClick={() => setSelected(item)}
                              aria-label={`查看${accountActionLabel(item.action)}详情`}
                            >
                              详情
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={access.auditMobile}>
                  {read.value.items.map((item) => (
                    <article
                      className={access.auditCard}
                      key={item.operationId}
                    >
                      <div className={access.auditCardHead}>
                        <strong>{accountActionLabel(item.action)}</strong>
                        <Result item={item} />
                      </div>
                      <div>
                        <p>
                          {actorName(item)} → {item.targetDisplayName}
                        </p>
                        <time
                          dateTime={item.createdAt}
                          className={styles.muted}
                        >
                          {moment(item.createdAt)}
                        </time>
                      </div>
                      <button
                        onClick={() => setSelected(item)}
                        aria-label={`查看${accountActionLabel(item.action)}详情`}
                      >
                        查看记录详情
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <Search size={30} aria-hidden="true" />
                <strong className={access.emptyTitle}>
                  {query.q || query.action !== "all"
                    ? "没有符合条件的操作记录"
                    : "暂无账号操作记录"}
                </strong>
                可调整姓名、登录账号或操作类型后重新查询。
              </div>
            )}
            <div className={styles.tableFoot}>
              <span>
                共 {read.value.total} 条
                {query.q || query.action !== "all" ? "匹配" : ""}记录
              </span>
              <nav className={styles.pagination} aria-label="操作记录分页">
                <button
                  disabled={read.loading || !query.offset}
                  onClick={() =>
                    setQuery((old) => ({
                      ...old,
                      offset: Math.max(0, old.offset - 25),
                    }))
                  }
                >
                  上一页
                </button>
                <span>第 {Math.floor(query.offset / 25) + 1} 页</span>
                <button
                  disabled={read.loading || !read.value.hasMore}
                  onClick={() =>
                    setQuery((old) => ({ ...old, offset: old.offset + 25 }))
                  }
                >
                  下一页
                </button>
                <button onClick={read.refresh}>刷新记录</button>
              </nav>
            </div>
          </>
        )}
      </section>
      {read.value && (
        <p className={access.snapshot}>
          读取时间：{moment(read.value.snapshotAt, true)}
        </p>
      )}
      <div className={`${styles.hint} ${access.inlineHint}`}>
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          记录仅展示账号业务动作和处理结果。密码、私密设置入口和会话凭证不在此页展示。
        </p>
      </div>
      <AccountOverlay
        open={Boolean(selected)}
        variant="drawer"
        title="操作详情"
        description="历史业务记录 · 只读"
        onClose={() => setSelected(undefined)}
        footer={<button onClick={() => setSelected(undefined)}>关闭</button>}
      >
        {selected && (
          <>
            <Result item={selected} />
            <h3 className={access.detailTitle}>
              {accountActionLabel(selected.action)}
            </h3>
            <dl className={styles.kv}>
              <div>
                <dt>操作者</dt>
                <dd>{actorName(selected)}</dd>
              </div>
              <div>
                <dt>目标账号</dt>
                <dd>{selected.targetDisplayName}</dd>
              </div>
              <div>
                <dt>操作时间</dt>
                <dd>{moment(selected.createdAt, true)}</dd>
              </div>
              <div>
                <dt>原操作编号</dt>
                <dd>{selected.operationId}</dd>
              </div>
              <div>
                <dt>目标账号编号</dt>
                <dd>{selected.targetId}</dd>
              </div>
              <div>
                <dt>处理结果</dt>
                <dd>{selected.status === "completed" ? "已完成" : "已拒绝"}</dd>
              </div>
              {selected.errorCode && (
                <div>
                  <dt>结果说明</dt>
                  <dd>{selected.errorCode}</dd>
                </div>
              )}
            </dl>
            <div
              className={`${styles.hint} ${access.scopeHint} ${access.inlineHint}`}
            >
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                此处仅展示安全记录中的业务字段，不能在详情中重新执行历史操作。
              </p>
            </div>
          </>
        )}
      </AccountOverlay>
    </div>
  );
}
