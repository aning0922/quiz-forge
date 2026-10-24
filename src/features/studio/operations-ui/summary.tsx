import Link from "next/link";
import type { ReactNode } from "react";
import type { RevisionTarget } from "@/features/product/internal-versions/identity-contracts";
import type {
  Observation,
  ProductOperations,
  NextAction,
} from "../operations/contracts";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import styles from "./summary.module.css";

const receptionLabels = {
  "awaiting-upload": "等待上传",
  receiving: "接收中",
  received: "已接收",
  "retryable-failed": "失败，可恢复",
  rejected: "已拒绝",
};
const validationLabels = {
  validating: "检查中",
  validated: "检查已完成",
  archiving: "封存中",
  ready: "已就绪",
  rejected: "已拒绝",
  "retryable-failed": "失败，可恢复",
};
const actionLabels: Record<NextAction["kind"], string> = {
  directory: "目录信息",
  imports: "接收与检查",
  draft: "当前草稿",
  preview: "内容预览",
  review: "审核依据",
  versions: "固定内容版本",
  testing: "试玩版本",
};

export function ObservationValue<T>({
  observation,
  absent,
  children,
}: {
  observation: Observation<T>;
  absent: string;
  children: (value: T) => ReactNode;
}) {
  if (observation.state === "present")
    return <>{children(observation.value)}</>;
  return (
    <span>
      {observation.state === "none"
        ? absent
        : observation.state === "not-applicable"
          ? "不适用"
          : "无法判定"}
    </span>
  );
}

export function AsOf({ value }: { value: string }) {
  return (
    <p className={styles.note}>
      摘要读取时间：<time dateTime={value}>{directoryTime(value)}</time>
    </p>
  );
}

function Target({ value }: { value: RevisionTarget }) {
  return (
    <dl className={styles.identity}>
      <dt>草稿编号</dt>
      <dd>{value.draftId}</dd>
      <dt>修订</dt>
      <dd>r{value.revision}</dd>
      <dt>内容 SHA-256</dt>
      <dd>{value.canonicalContentSha256}</dd>
      <dt>素材集 SHA-256</dt>
      <dd>{value.assetSetSha256}</dd>
      <dt>Manifest SHA-256</dt>
      <dd>{value.canonicalManifestSha256}</dd>
    </dl>
  );
}

/** One read model, separate evidence dimensions. Never supplies a mutation target. */
export function OperationsSummary({
  value,
  compact = false,
  showActions = true,
}: {
  value: ProductOperations;
  compact?: boolean;
  showActions?: boolean;
}) {
  const { content, review, versions, testing } = value;
  return (
    <div className={styles.summary}>
      <dl className={styles.facts}>
        <div>
          <dt>接收 / 检查</dt>
          <dd>
            <ObservationValue
              observation={content.reception.latest}
              absent="暂无接收记录"
            >
              {(item) => <>接收：{receptionLabels[item.status]}</>}
            </ObservationValue>
            {" / "}
            <ObservationValue
              observation={content.validation.latest}
              absent="暂无检查记录"
            >
              {(item) => <>检查：{validationLabels[item.status]}</>}
            </ObservationValue>
            <span className={styles.note}>
              （接收 {content.reception.total} · 检查 {content.validation.total}
              ）
            </span>
          </dd>
        </div>
        <div>
          <dt>当前草稿</dt>
          <dd>
            <ObservationValue observation={content.draft} absent="暂无当前草稿">
              {(item) => <>r{item.target.revision}</>}
            </ObservationValue>
          </dd>
        </div>
        <div>
          <dt>当前匹配审核</dt>
          <dd>
            <ObservationValue
              observation={review.current}
              absent="缺少当前草稿的精确匹配审核"
            >
              {(item) => (
                <>
                  r{item.target.revision} ·{" "}
                  {item.approval.kind === "synthetic-test"
                    ? "合成测试依据，非作者批准"
                    : "作者内测基线依据"}
                </>
              )}
            </ObservationValue>
            <span className={styles.note}>
              历史审核 {review.historicalCount} 条
              {review.latestHistorical.state === "present" &&
                ` · 最近 r${review.latestHistorical.value.target.revision}`}
            </span>
          </dd>
        </div>
        <div>
          <dt>固定内容版本</dt>
          <dd>
            当前匹配 {versions.currentCount} 个 · 历史{" "}
            {versions.historicalCount} 个
            <span className={styles.note}>
              当前：
              <ObservationValue observation={versions.current} absent="暂无">
                {(item) => (
                  <>
                    r{item.target.revision} · {item.id}
                  </>
                )}
              </ObservationValue>
            </span>
            <span className={styles.note}>
              历史：
              <ObservationValue observation={versions.historical} absent="暂无">
                {(item) => (
                  <>
                    r{item.target.revision} · {item.id}
                  </>
                )}
              </ObservationValue>
            </span>
          </dd>
        </div>
        <div>
          <dt>试玩版本关联</dt>
          <dd>
            当前匹配 {testing.currentCount} 个 · 历史 {testing.historicalCount}{" "}
            个
            <span className={styles.note}>
              当前：
              <ObservationValue observation={testing.current} absent="暂无">
                {(item) => (
                  <>
                    r{item.target.revision} · 父版本 {item.parentVersionId}
                  </>
                )}
              </ObservationValue>
            </span>
            <span className={styles.note}>
              历史：
              <ObservationValue observation={testing.historical} absent="暂无">
                {(item) => (
                  <>
                    r{item.target.revision} · 父版本 {item.parentVersionId}
                  </>
                )}
              </ObservationValue>
            </span>
          </dd>
        </div>
      </dl>
      <TechnicalDetails label="摘要依据与完整目标">
        <p>
          目录：{value.directory.id} · 信息版本{" "}
          {value.directory.metadataRevision} ·{" "}
          {value.directory.archivedAt ? "已归档" : "未归档"}
        </p>
        <h3>独立接收与检查依据</h3>
        <ObservationValue
          observation={content.reception.latest}
          absent="暂无接收记录"
        >
          {(item) => (
            <p>
              接收编号：{item.id} · 状态版本 {item.stateRevision} · 存储状态{" "}
              {item.storageCondition}
            </p>
          )}
        </ObservationValue>
        <ObservationValue
          observation={content.validation.latest}
          absent="暂无检查记录"
        >
          {(item) => (
            <p>
              检查编号：{item.id} · 来源接收 {item.importId} · 状态版本{" "}
              {item.stateRevision} · 存储状态 {item.storageCondition}
            </p>
          )}
        </ObservationValue>
        <h3>当前草稿完整目标</h3>
        <ObservationValue observation={content.draft} absent="暂无当前草稿目标">
          {(item) => <Target value={item.target} />}
        </ObservationValue>
        <h3>当前审核目标</h3>
        <ObservationValue
          observation={review.current}
          absent="暂无精确匹配审核"
        >
          {(item) => (
            <>
              <p>审核编号：{item.id}</p>
              <Target value={item.target} />
            </>
          )}
        </ObservationValue>
        <h3>最近历史审核目标</h3>
        <ObservationValue
          observation={review.latestHistorical}
          absent="暂无历史审核"
        >
          {(item) => (
            <>
              <p>审核编号：{item.id}</p>
              <Target value={item.target} />
            </>
          )}
        </ObservationValue>
        <p>
          接收、检查及历史代表记录按各自时间选取，不表示来自同一次导入。历史版本不授予当前草稿完成权。
        </p>
      </TechnicalDetails>
      {!compact && (
        <p className={styles.note}>
          浏览器未决操作：无法由服务器摘要判定。请在原工作区保留的操作中核对和恢复。
        </p>
      )}
      <AsOf value={value.asOf} />
      {showActions && value.nextActions.length > 0 && (
        <nav
          className={styles.actions}
          aria-label={`测评 ${value.directory.title} 的下一步`}
        >
          {value.nextActions.map((action) => (
            <Link key={action.kind} href={action.href} title={action.reason}>
              {actionLabels[action.kind]} →
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
