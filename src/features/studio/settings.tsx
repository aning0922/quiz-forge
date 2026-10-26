"use client";
import { useOwnedStudioSession } from "./accounts/session-owner";
import type { StudioSessionDto } from "./contracts";
import { roleHasCapability } from "@/lib/auth/role-policy";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AccountAvatar, RoleBadge } from "./accounts/account-ui";
import { AccountWorkspaceNav } from "./accounts/workspace-nav";
import styles from "./settings.module.css";

export function StudioSettings({
  session: initialSession,
}: {
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const identity = {
    label: session.operator.displayName,
    role: session.operator.role,
  };
  const manage = roleHasCapability(identity.role, "account:manage");
  const taxonomy = roleHasCapability(identity.role, "taxonomy:manage");
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>QUIZFORGE STUDIO / OPERATOR</p>
        <h1>系统设置</h1>
        <p>平台目录和账号安全分区呈现，让日常运营更从容。</p>
      </header>
      <AccountWorkspaceNav role={identity.role} />
      <div className={styles.grid}>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <div className={styles.title}>
              <div>
                <h2>人员与权限</h2>
                <p>管理运营成员与账号安全</p>
              </div>
              <span className={styles.available}>已开放</span>
            </div>
            {manage ? (
              <>
                <div className={styles.settingRow}>
                  <div>
                    <strong>账号与权限</strong>
                    <p>开通成员、调整角色、停用与设密入口</p>
                  </div>
                  <Link className={styles.button} href="/studio/accounts">
                    进入 <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                </div>
                <div className={styles.settingRow}>
                  <div>
                    <strong>账号操作记录</strong>
                    <p>查看人员变更、安全动作与处理结果</p>
                  </div>
                  <Link className={styles.button} href="/studio/accounts/audit">
                    查看 <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </>
            ) : (
              <p className={styles.notice}>
                其他成员及全体账号操作记录由管理员管理。
              </p>
            )}
            <div className={styles.settingRow}>
              <div>
                <strong>我的账号</strong>
                <p>个人身份、修改密码与退出登录</p>
              </div>
              <Link className={styles.button} href="/studio/session">
                管理 <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </section>
          <section className={styles.panel}>
            <div className={styles.title}>
              <div>
                <h2>分类与标签</h2>
                <p>组织测评目录，保留已有测评关联</p>
              </div>
              <span className={styles.available}>已开放</span>
            </div>
            <div className={styles.settingRow}>
              <div>
                <strong>测评分类和标签</strong>
                <p>
                  {taxonomy
                    ? "创建、改名、归档与恢复"
                    : "当前角色可查看已有分类和标签"}
                </p>
              </div>
              <Link className={styles.button} href="/studio/taxonomy">
                {taxonomy ? "管理" : "查看"}{" "}
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
        <div className={styles.stack}>
          <section className={styles.panel}>
            <h2>当前角色</h2>
            <div className={styles.identity}>
              <AccountAvatar name={identity.label} />
              <strong>{identity.label}</strong>
            </div>
            <div className={styles.role}>
              <RoleBadge role={identity.role} />
            </div>
            <p>角色更改或停用会撤销原登录；未结束的任务仍归原发起账号。</p>
          </section>
          <section className={styles.panel}>
            <h2>后续站点运营</h2>
            <p>支付、公开注册、消费者账号和统一参与统计尚未开放。</p>
          </section>
          <section className={styles.panel}>
            <h2>环境维护</h2>
            <p>数据库备份与恢复由独立维护流程完成。</p>
          </section>
        </div>
      </div>
    </div>
  );
}
