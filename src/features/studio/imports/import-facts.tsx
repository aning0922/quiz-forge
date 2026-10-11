import type { ImportDto } from "@/features/quizpack/import/contracts";
import { StudioClientError } from "../client";
import { importMessage } from "./messages";
import styles from "../workspace/workspace.module.css";

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
