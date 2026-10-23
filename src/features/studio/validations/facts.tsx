import { TechnicalDetails } from "../presentation/technical-details";
import type { ValidationDto } from "@/features/quizpack/validation/contracts";
import { StudioClientError } from "../client";
import { validationLabels, validationMessage } from "./messages";
import styles from "../workspace/workspace.module.css";
export function ValidationFacts({ value }: { value: ValidationDto }) {
  return (
    <div>
      <h3>{validationLabels[value.status]}</h3>
      <dl className={styles.facts}>
        <div>
          <dt>检查记录版本</dt>
          <dd>{value.stateRevision}</dd>
        </div>
        <div>
          <dt>资源归档</dt>
          <dd>
            {value.archivedResourceCount} / {value.resourceCount ?? "尚未确定"}
          </dd>
        </div>
        <div>
          <dt>文件保存状态</dt>
          <dd>
            {value.storageCondition === "clean"
              ? "文件与记录一致"
              : value.storageCondition === "cleanup-required"
                ? "需要恢复对账"
                : "文件与账目尚未确认"}
          </dd>
        </div>
        <div>
          <dt>尝试次数</dt>
          <dd>
            {value.attemptCount} 次 · 剩余 {value.remainingAttempts} 次
          </dd>
        </div>
      </dl>
      <TechnicalDetails label="检查记录技术标识">
        <dl className={styles.facts}>
          <div>
            <dt>验证记录</dt>
            <dd>{value.id}</dd>
          </div>
          <div>
            <dt>包身份</dt>
            <dd>
              {value.packId
                ? `${value.packId} / ${value.packVersion}`
                : "尚未冻结"}
            </dd>
          </div>
        </dl>
      </TechnicalDetails>
      <TechnicalDetails label="检查技术信息">
        <dl className={styles.facts}>
          <div>
            <dt>操作编号（缩略）</dt>
            <dd>{value.validationKey.slice(0, 12)}…</dd>
          </div>
          <div>
            <dt>最近更新</dt>
            <dd>{value.updatedAt}</dd>
          </div>
        </dl>
      </TechnicalDetails>
      {value.lastErrorCode && (
        <p className={`${styles.status} ${styles.error}`}>
          {validationMessage(new StudioClientError(value.lastErrorCode))}
        </p>
      )}
      {value.readOnly && (
        <p className={styles.status}>
          旧策略历史记录只读。请在同一已接收内容包上准备新验证；此记录不能恢复、重试或用于新的草稿申请。
        </p>
      )}
      {value.maintenanceRequired && (
        <p className={styles.status}>
          需要维护核实；归档文件与停止情况仍未得到完整确认。
        </p>
      )}
      <p className={styles.note}>
        平台授权未审核（unverified） ·
        不可发布。归档不会自动创建或追加草稿；应用须显式确认。本批不提供网页内容编辑或发布。
      </p>
    </div>
  );
}
