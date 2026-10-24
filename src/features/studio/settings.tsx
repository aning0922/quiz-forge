import Link from "next/link";
import type { StudioIdentity } from "./navigation-model";
import ui from "./studio.module.css";
import styles from "./platform.module.css";

export function StudioSettings({ identity }: { identity: StudioIdentity }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>系统设置</h1>
          <p>维护分类标签，核对运营身份。低频技术维护由本机维护者处理。</p>
        </div>
      </header>
      <div className={styles.settingsGrid}>
        <section className={styles.panel}>
          <h2>分类与标签</h2>
          <p>
            沿用现有分类和标签管理，支持创建、改名、归档和恢复。归档不删除已有测评关联。
          </p>
          <Link
            className={`${ui.link} ${ui.secondary}`}
            href="/studio/taxonomy"
          >
            打开分类与标签管理
          </Link>
        </section>
        <section className={styles.panel}>
          <h2>运营身份与权限</h2>
          <dl className={ui.facts}>
            <div>
              <dt>当前身份</dt>
              <dd>{identity.label}</dd>
            </div>
            <div>
              <dt>角色</dt>
              <dd>{identity.role === "operator" ? "运营者" : "只读"}</dd>
            </div>
          </dl>
          <p>每个页面和操作都由服务器重新核验权限。</p>
          <Link className={`${ui.link} ${ui.secondary}`} href="/studio/session">
            查看会话与退出登录
          </Link>
        </section>
        <section className={styles.panel}>
          <h2>维护与恢复</h2>
          <p>备份校验、隔离恢复和运行环境维护由本机维护者使用受管工具执行。</p>
          <p>
            此页不执行命令，也不覆盖现有环境。需要维护时，请联系本机维护者。
          </p>
        </section>
        <section className={styles.panel}>
          <h2>当前能力</h2>
          <p>
            后台用于管理测评内容与内测。正式公开发布、推荐位和业务分析尚未接入，不将内测版本视为公开发布。
          </p>
          <Link className={styles.textLink} href="/studio/products">
            返回测评管理 →
          </Link>
        </section>
      </div>
    </div>
  );
}
