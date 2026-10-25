"use client";

import { useMemo } from "react";
import { useInternalAuthority } from "../internal-versions/authority";
import { invalidateCurrentStudioAuthority } from "../authority-events";
import { ContentAuthorityContext } from "./content-authority";
import type { ImportDto } from "@/features/quizpack/import/contracts";
import type { StudioSessionDto } from "../contracts";
import { checkImport } from "../imports/client";
import { useImportRead } from "../imports/use-read";
import { checkValidationPage, validationEndpoint } from "../validations/client";
import { useValidationRead } from "../validations/use-read";
import { validationLabels, validationMessage } from "../validations/messages";
import { importMessage } from "../imports/messages";
import { StudioClientError } from "../client";
import { TechnicalDetails } from "../presentation/technical-details";
import { directoryTime } from "../workspace/directory-time";
import styles from "./content-workbench.module.css";

type SourceDetailsProps = {
  productId: string;
  sourceId: string;
  session: StudioSessionDto;
  onContinue: (importId: string) => void;
};
export function ContentSourceDetails(props: SourceDetailsProps) {
  const authority = useInternalAuthority();
  const scope = useMemo(
    () => ({
      canWrite: () => !authority.isRevoked,
      observe(error: unknown) {
        const wasRevoked = authority.isRevoked;
        authority.observe(error);
        if (!wasRevoked && authority.isRevoked)
          invalidateCurrentStudioAuthority();
      },
    }),
    [authority],
  );
  return (
    <ContentAuthorityContext.Provider value={scope}>
      <SourceDetailsRead {...props} />
    </ContentAuthorityContext.Provider>
  );
}
function SourceDetailsRead({
  productId,
  sourceId,
  session,
  onContinue,
}: SourceDetailsProps) {
  const read = useImportRead(
    `/api/studio/products/${encodeURIComponent(productId)}/imports/${encodeURIComponent(sourceId)}`,
    (value) => checkImport(value, { productId, importId: sourceId }),
  );
  return (
    <div className={styles.source}>
      {read.loading && <p role="status">正在读取此来源…</p>}
      {read.error && (
        <p className={styles.warning} role="alert">
          {read.error}
        </p>
      )}
      {read.value && (
        <SourceRecord
          key={`${productId}/${sourceId}`}
          value={read.value}
          session={session}
          onContinue={onContinue}
        />
      )}
      <button
        className={styles.textButton}
        disabled={read.loading}
        onClick={read.refresh}
      >
        重新读取此来源
      </button>
    </div>
  );
}
function SourceRecord({
  value,
  session,
  onContinue,
}: {
  value: ImportDto;
  session: StudioSessionDto;
  onContinue: (importId: string) => void;
}) {
  const pair = { productId: value.productId, importId: value.id };
  const checks = useValidationRead(
    `${validationEndpoint(pair)}?page=1&pageSize=20`,
    (data) => {
      const result = checkValidationPage(data, {
        ...pair,
        page: 1,
        pageSize: 20,
      });
      if (
        result.items.some(
          (row) =>
            row.archiveSha256 !== value.expectedArchiveSha256 ||
            row.archiveBytes !== value.expectedArchiveBytes,
        )
      )
        throw new Error("INVALID_SOURCE_VALIDATION");
      return result;
    },
  );
  const terminal =
    value.status === "rejected" && value.storageCondition === "clean";
  const labels = {
    "awaiting-upload": "等待原文件上传",
    receiving: "接收结果待核实",
    received: "内容包已接收",
    "retryable-failed": "接收未完成，需核实恢复",
    rejected: "接收已拒绝",
  };
  return (
    <>
      <div>
        <h3>准确来源</h3>
        <p className={styles.intro}>
          此处按原接收编号读取，检查记录只属于这个文件来源。
        </p>
      </div>
      <dl className={styles.checkCard}>
        <div>
          <dt>接收结果</dt>
          <dd>{labels[value.status]}</dd>
        </div>
        <div>
          <dt>文件大小</dt>
          <dd>{Math.ceil(value.expectedArchiveBytes / 1024)} KB</dd>
        </div>
        <div>
          <dt>接收时间</dt>
          <dd>{directoryTime(value.createdAt)}</dd>
        </div>
        <div>
          <dt>存储状态</dt>
          <dd>
            {value.storageCondition === "clean"
              ? "记录一致"
              : "待核实，不能直接继续下一步"}
          </dd>
        </div>
      </dl>
      {value.lastErrorCode && (
        <p className={styles.warning}>
          {importMessage(new StudioClientError(value.lastErrorCode))}
        </p>
      )}
      {!terminal && (
        <button
          className={styles.secondary}
          onClick={() => onContinue(value.id)}
        >
          {session.operator.role === "operator"
            ? "返回任务继续处理此来源"
            : "查看原任务并核实结果"}
        </button>
      )}
      {terminal && (
        <p className={styles.notice}>
          此接收已确认拒绝，记录只读，不重新提交原文件。
        </p>
      )}
      <div className={styles.division} />
      <h3>此来源的检查记录</h3>
      {checks.loading && <p role="status">正在读取此来源的检查…</p>}
      {checks.error && (
        <p className={styles.warning} role="alert">
          {checks.error}
        </p>
      )}
      {checks.value?.items.length === 0 && (
        <p>尚无已读取的检查记录；这不能证明未知请求没有执行。</p>
      )}
      <ol className={styles.recordList}>
        {checks.value?.items.map((row) => (
          <li className={styles.compactRow} key={row.id}>
            <strong>{validationLabels[row.status]}</strong>
            <p className={styles.caption}>
              {row.packId
                ? `${row.packId} / ${row.packVersion}`
                : "尚未冻结内容包身份"}{" "}
              · {directoryTime(row.updatedAt)}
            </p>
            <p>
              素材 {row.archivedResourceCount} / {row.resourceCount ?? "待确定"}
            </p>
            {row.lastErrorCode && (
              <p className={styles.warning}>
                {validationMessage(new StudioClientError(row.lastErrorCode))}
              </p>
            )}
            {row.maintenanceRequired && (
              <p className={styles.warning}>需要维护核实归档与停止情况。</p>
            )}
            {row.readOnly && (
              <p className={styles.notice}>
                此历史检查只读，不能作为新草稿来源。
              </p>
            )}
            <TechnicalDetails label="检查身份与技术依据">
              <p>检查编号：{row.id}</p>
              <p>检查版本：{row.stateRevision}</p>
              <p>候选：{row.candidateSha256 ?? "尚未形成"}</p>
              <p>操作编号：{row.validationKey}</p>
            </TechnicalDetails>
          </li>
        ))}
      </ol>
      {checks.value?.hasNext && (
        <p className={styles.caption}>
          当前展示最近 20 条检查，未将其余历史推断为不存在。
        </p>
      )}
      <button
        className={styles.textButton}
        disabled={checks.loading}
        onClick={checks.refresh}
      >
        重新读取此来源的检查
      </button>
      <TechnicalDetails label="接收身份与文件声明">
        <p>接收编号：{value.id}</p>
        <p>SHA-256：{value.expectedArchiveSha256}</p>
        <p>字节数：{value.expectedArchiveBytes}</p>
      </TechnicalDetails>
    </>
  );
}
