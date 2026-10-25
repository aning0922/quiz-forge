import { roleHasCapability } from "@/lib/auth/role-policy";
import Link from "next/link";
import {
  Users,
  History,
  User,
  Tags,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import type { StudioIdentity } from "./navigation-model";
import { AccountAvatar, RoleBadge } from "./accounts/account-ui";
import ui from "./accounts/experience.module.css";
import styles from "./settings.module.css";

export function StudioSettings({ identity }: { identity: StudioIdentity }) {
  return (
    <div className={ui.page}>
      <header className={ui.heading}>
        <div>
          <h1>系统设置</h1>
          <p>人员管理与账号安全各有清晰入口，让日常运营更从容。</p>
        </div>
      </header>
      <div className={styles.grid}>
        <section className={`${ui.card} ${ui.cardPad}`}>
          <h2>人员与权限</h2>
          <div className={styles.accountLinks}>
            {roleHasCapability(identity.role, "account:manage") && (
              <Link href="/studio/accounts">
                <span className={styles.linkIcon}>
                  <Users size={21} />
                </span>
                <span>
                  <strong>账号与权限</strong>
                  <span>开通成员、调整角色、停用或恢复账号</span>
                </span>
                <ChevronRight size={18} />
              </Link>
            )}
            {roleHasCapability(identity.role, "account:audit") && (
              <Link href="/studio/accounts/audit">
                <span className={styles.linkIcon}>
                  <History size={21} />
                </span>
                <span>
                  <strong>账号操作记录</strong>
                  <span>查看人员变更、安全操作及处理结果</span>
                </span>
                <ChevronRight size={18} />
              </Link>
            )}
            <Link href="/studio/session">
              <span className={styles.linkIcon}>
                <User size={21} />
              </span>
              <span>
                <strong>我的账号</strong>
                <span>本人密码和登录管理</span>
              </span>
              <ChevronRight size={18} />
            </Link>
          </div>
        </section>
        <section className={`${ui.card} ${ui.cardPad}`}>
          <h2>当前角色</h2>
          <div className={ui.person}>
            <AccountAvatar name={identity.label} />
            <strong>{identity.label}</strong>
          </div>
          <div className={styles.role}>
            <RoleBadge role={identity.role} />
          </div>
          <div className={ui.hint}>
            <ShieldCheck size={19} />
            <span>
              仅显示当前角色适用的设置入口。具体操作仍以服务器核验的权限为准。
            </span>
          </div>
        </section>
        <section className={`${ui.card} ${ui.cardPad}`}>
          <h2>测评分类与标签</h2>
          <p className={ui.muted}>
            维护已有测评使用的分类和标签；归档保留原测评关联。
          </p>
          <Link className={ui.button} href="/studio/taxonomy">
            <Tags size={18} />
            打开分类与标签管理
            <ChevronRight size={18} />
          </Link>
        </section>
      </div>
    </div>
  );
}
