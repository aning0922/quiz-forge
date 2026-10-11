import type {
  ImportDto,
  ReceiveErrorCode,
} from "@/features/quizpack/import/contracts";
import { StudioClientError } from "../client";
import { importMessage } from "./messages";
import styles from "../workspace/workspace.module.css";
import local from "./imports.module.css";

const labels = {
  "awaiting-upload": "等待上传原包",
  receiving: "接收中 · 尚未确认完成",
  received: "原包已隔离接收，尚未验证",
  "retryable-failed": "本次接收已失败 · 请核实或恢复",
  rejected: "原包已拒绝 · 不可修改声明重传",
};
const storageLabels = {
  clean: "已对账",
  "cleanup-required": "需要清理恢复",
  unknown: "文件与账目尚未确认",
};

const errorSummaries: Record<ReceiveErrorCode, string> = {
  RECEIVE_TIMEOUT: "接收已超过时间预算",
  RECEIVE_LENGTH_MISMATCH: "实际字节数不符",
  RECEIVE_HASH_MISMATCH: "实际 SHA-256 不符",
  RECEIVE_LOCK_LOST: "存储连接已失效",
  RECEIVE_RECOVERY_REQUIRED: "需要显式恢复",
  RECEIVE_STORAGE_CONFLICT: "存储存在冲突",
  RECEIVE_SCAN_LIMIT: "存储扫描达到限制",
  WRITE_OUTCOME_UNKNOWN: "提交结果尚未确认",
  STUDIO_UNAVAILABLE: "服务暂不可用",
};

/** List overview; complete facts and failure guidance remain in the status panel. */
export function ImportSummary({ value }: { value: ImportDto }) {
  return (
    <div className={local.summary}>
      <p className={local.summaryStatus}>{labels[value.status]}</p>
      <dl className={`${styles.facts} ${local.summaryFacts}`}>
        <div className={local.summaryIdentity}>
          <dt>接收 ID</dt>
          <dd>{value.id}</dd>
        </div>
        <div>
          <dt>声明字节数</dt>
          <dd>{value.expectedArchiveBytes}</dd>
        </div>
        <div>
          <dt>存储状态</dt>
          <dd>{storageLabels[value.storageCondition]}</dd>
        </div>
      </dl>
      <p>not-run · 不可发布</p>
      {value.lastErrorCode && (
        <p className={local.summaryError}>
          上次提示：{errorSummaries[value.lastErrorCode]}。完整说明见详情。
        </p>
      )}
    </div>
  );
}

export function ImportFacts({ value }: { value: ImportDto }) {
  return (
    <div>
      <p className={styles.status}>{labels[value.status]}</p>
      <dl className={styles.facts}>
        <div>
          <dt>接收 ID</dt>
          <dd>{value.id}</dd>
        </div>
        <div>
          <dt>状态修订</dt>
          <dd>{value.stateRevision}</dd>
        </div>
        <div>
          <dt>存储状态</dt>
          <dd>{storageLabels[value.storageCondition]}</dd>
        </div>
        <div>
          <dt>声明字节数</dt>
          <dd>{value.expectedArchiveBytes}</dd>
        </div>
        <div>
          <dt>声明 SHA-256</dt>
          <dd>{value.expectedArchiveSha256}</dd>
        </div>
        <div>
          <dt>服务器确认字节数</dt>
          <dd>{value.actualArchiveBytes ?? "尚未冻结"}</dd>
        </div>
        <div>
          <dt>服务器确认 SHA-256</dt>
          <dd>{value.actualArchiveSha256 ?? "尚未冻结"}</dd>
        </div>
        <div>
          <dt>验证 / 发布</dt>
          <dd>not-run · 不可发布</dd>
        </div>
      </dl>
      {value.lastErrorCode && (
        <p className={`${styles.status} ${styles.error}`}>
          {importMessage(new StudioClientError(value.lastErrorCode))}
        </p>
      )}
      <p className={styles.note}>
        此状态不证明 ZIP、内容
        Schema、包内工作区、合成数据、图片或商用授权已验证，也没有生成草稿。
      </p>
    </div>
  );
}
