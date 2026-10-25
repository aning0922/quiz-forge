import { roleHasCapability } from "@/lib/auth/role-policy";
import { roleLabel } from "./accounts/presentation";
import Link from "next/link";
import { ExternalLink, ArrowRight } from "lucide-react";
import type { StudioIdentity } from "./navigation-model";
import styles from "./settings.module.css";

export function StudioSettings({ identity }: { identity: StudioIdentity }) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>系统设置</h1>
        <p>集中维护分类标签及基础运营环境，低频技术配置不干扰日常工作。</p>
      </header>
      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.title}>
            <h2>分类与标签</h2>
            <span className={styles.available}>现有能力</span>
          </div>
          <p>
            支持分类、标签的创建、改名、归档和恢复。归档保留已有测评关联，可在原目录中恢复。
          </p>
          <Link className={styles.button} href="/studio/taxonomy">
            <ExternalLink size={16} aria-hidden="true" />
            打开分类与标签管理
          </Link>
        </section>
        <section className={styles.panel}>
          <div className={styles.title}>
            <h2>运营身份与权限</h2>
            <span className={styles.foundation}>现有基础</span>
          </div>
          <dl className={styles.facts}>
            <div>
              <dt>当前身份</dt>
              <dd>{identity.label}</dd>
            </div>
            <div>
              <dt>角色范围</dt>
              <dd>{roleLabel(identity.role)}</dd>
            </div>
            <div>
              <dt>权限策略</dt>
              <dd>以服务端授权为最终依据</dd>
            </div>
          </dl>
          {roleHasCapability(identity.role, "account:manage") && (
            <p>
              <Link className={styles.textLink} href="/studio/accounts">
                管理账号与权限 →
              </Link>
            </p>
          )}
          {roleHasCapability(identity.role, "account:audit") && (
            <p>
              <Link className={styles.textLink} href="/studio/accounts/audit">
                查看账号操作记录 →
              </Link>
            </p>
          )}
          <Link className={styles.textLink} href="/studio/session">
            查看会话与退出登录
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </section>
        <section className={styles.panel}>
          <div className={styles.title}>
            <h2>未来站点运营</h2>
            <span className={styles.future}>后续独立接入</span>
          </div>
          <p>
            作品正式上线、首页推荐、专题、展示排序和公告尚未接入。固定内测版本不代表公开发布。
          </p>
        </section>
        <section className={styles.panel}>
          <div className={styles.title}>
            <h2>维护与恢复</h2>
            <span className={styles.future}>技术维护</span>
          </div>
          <p>
            备份校验、隔离恢复与运行环境维护由本机维护者使用受管工具执行。普通运营页面不提供维护命令入口。
          </p>
        </section>
      </div>
    </div>
  );
}
