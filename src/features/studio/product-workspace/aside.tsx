"use client";
import { Check, Eye, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ProductOperations } from "../operations/contracts";
import { sameRevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import styles from "./task-workspace.module.css";

export function WorkspaceAside({
  value,
  onHistory,
}: {
  value?: ProductOperations | undefined;
  onHistory: () => void;
}) {
  const current =
    value?.content.draft.state === "present"
      ? value.content.draft.value.target
      : undefined;
  const facts = value && productPresentation(value);
  const version =
    current &&
    value?.versions.current.state === "present" &&
    sameRevisionTarget(current, value.versions.current.value.target)
      ? value.versions.current.value
      : undefined;
  const testing =
    current &&
    value?.testing.current.state === "present" &&
    sameRevisionTarget(current, value.testing.current.value.target);
  return (
    <aside className={styles.aside} aria-label="测评对象与操作说明">
      <section className={styles.panel}>
        <div className={styles.cardHead}>
          <h3>当前对象关系</h3>
          <span className={styles.chip}>
            {current ? `r${current.revision}` : "无当前目标"}
          </span>
        </div>
        <p>以下只说明当前修订，不会借用历史审核或版本。</p>
        {current && facts ? (
          <>
            <div className={styles.objectFlow}>
              <span className={styles.chip}>草稿 r{current.revision}</span>
              <span aria-hidden="true">→</span>
              <StatusBadge status={facts.review} />
            </div>
            <div className={styles.flowLine}>
              <strong>
                固定内测内容：
                {version
                  ? "已有精确匹配版本"
                  : value?.versions.current.state === "none"
                    ? "尚无当前版本"
                    : "待读取核实"}
              </strong>
              <p>历史封存记录不属于当前修订。</p>
            </div>
            <div className={styles.flowLine}>
              <strong>
                答题版本：
                {testing
                  ? "已有当前版本"
                  : value?.testing.current.state === "none" ||
                      value?.testing.current.state === "not-applicable"
                    ? "尚无当前版本"
                    : "待读取核实"}
              </strong>
              <p>只有选定固定内容版本才能创建。</p>
            </div>
          </>
        ) : (
          <p>
            {value?.content.draft.state === "none"
              ? "先完成接收、检查与草稿建立。"
              : "当前目标尚未可靠读取。"}
          </p>
        )}
      </section>
      <section className={styles.panel}>
        <div className={styles.cardHead}>
          <h3>保留的历史</h3>
          <button onClick={onHistory}>查看</button>
        </div>
        <p>历史信息用于追溯，不授予当前草稿资格。</p>
        <div className={styles.flowLine}>
          <strong>{facts?.historicalNote ?? "尚无可确认的历史代表项"}</strong>
          <p>按各自固定来源独立查看。</p>
        </div>
      </section>
      <section className={styles.panel}>
        <div className={styles.cardHead}>
          <h3>本页操作约定</h3>
          <ShieldCheck size={18} aria-hidden="true" />
        </div>
        <ul className={styles.rules}>
          <li>
            <Check aria-hidden="true" />
            一项主要任务只出现一个突出操作。
          </li>
          <li>
            <LockKeyhole aria-hidden="true" />
            原文件、私密链接和未知回执按原任务保留，关闭浮层不表示已清除。
          </li>
          <li>
            <Eye aria-hidden="true" />
            预览不自动成为审核通过。
          </li>
        </ul>
        <p className={styles.asideNote}>
          状态来自真实只读接口。写入须满足当前身份权限和精确对象条件。
        </p>
      </section>
    </aside>
  );
}
