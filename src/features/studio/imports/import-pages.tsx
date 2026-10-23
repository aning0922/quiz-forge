"use client";
import { StudioPageHeader } from "../presentation/page-header";
import { StudioWorkflowNav } from "../presentation/workflow-nav";
import Link from "next/link";
import { useState } from "react";
import type {
  ImportDto,
  ImportSettingsDto,
  Page,
} from "@/features/quizpack/import/contracts";
import type { ProductDto } from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { Pagination, ReadOnlyNotice } from "../workspace/primitives";
import { useImportRead } from "./use-read";
import { CreateReceive } from "./create-receive";
import { ImportSummary } from "./import-facts";
import { ReceiveControls } from "./receive-controls";
import { ValidationOverview, ValidationPanel } from "../validations/panel";
import { checkImport, checkImportPage, checkSettings } from "./client";
import { prepareArchiveInput } from "./prepare-archive";
import styles from "../workspace/workspace.module.css";
import local from "./imports.module.css";

function ImportEnvironment({
  settings,
  archived,
  readOnly,
}: {
  settings: ImportSettingsDto;
  archived: boolean;
  readOnly: boolean;
}) {
  return (
    <>
      <p className={styles.status}>
        {settings.enabled
          ? "内容包接收已启用（只读配置快照）"
          : "内容包接收已关闭（只读配置快照）"}
      </p>
      {!settings.enabled && (
        <p className={styles.note}>
          历史记录仍可查看。仅本机维护者可通过管理 CLI 启用；此页没有启用按钮。
        </p>
      )}
      {archived && (
        <p className={styles.status}>
          工作区已归档，只能读取历史。请先在工作区详情恢复，再进行接收或业务恢复。
        </p>
      )}
      {readOnly && <ReadOnlyNotice />}
      <p className={styles.note}>
        配置和权限会由每次写入重新核实。接收步骤记录内容包大小与哈希；包结构验证、资源归档和草稿应用分别记录，内容与素材授权另行人工审核。
      </p>
    </>
  );
}
function ReadFeedback({
  loading,
  error,
  refresh,
}: {
  loading: boolean;
  error?: string | undefined;
  refresh: () => void;
}) {
  return (
    <>
      {loading && (
        <p className={styles.status} role="status">
          正在读取服务器…
        </p>
      )}
      {error && (
        <div className={`${styles.status} ${styles.error}`} role="alert">
          <p>{error}</p>
          <button className={styles.button} onClick={refresh}>
            重新读取
          </button>
        </div>
      )}
    </>
  );
}
export function ImportList({
  productId,
  session,
}: {
  productId: string;
  session: StudioSessionDto;
}) {
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}`;
  const product = useImportRead<ProductDto>(endpoint);
  const settings = useImportRead<ImportSettingsDto>(
    `${endpoint}/imports/settings`,
    checkSettings,
  );
  const [page, setPage] = useState(1);
  const imports = useImportRead<Page<ImportDto>>(
    `${endpoint}/imports?page=${page}&pageSize=20`,
    (value) => checkImportPage(value, { productId, page, pageSize: 20 }),
  );
  const readOnly = session.operator.role !== "operator";
  return (
    <div className={styles.workspace}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="内容包接收"
          description="先接收内容包，再验证结构与资源。接收成功不等于已验证、已创建草稿或已发布。"
        />
        <StudioWorkflowNav productId={productId} current="imports" />
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}`}
        >
          返回工作区详情
        </Link>
        <ReadFeedback {...product} />
        <ReadFeedback {...settings} />
        {product.value && settings.value && (
          <>
            <h2>{product.value.title}</h2>
            <ImportEnvironment
              settings={settings.value}
              archived={!!product.value.archivedAt}
              readOnly={readOnly}
            />
          </>
        )}
      </section>
      {product.value &&
        settings.value &&
        !product.value.archivedAt &&
        !readOnly &&
        settings.value.enabled && (
          <CreateReceive
            productId={productId}
            session={session}
            settings={settings.value}
            onChanged={imports.refresh}
          />
        )}
      <section className={styles.panel}>
        <h2>接收记录</h2>
        <p className={styles.note}>
          接收记录只说明内容包接收与存储事实；独立验证与资源归档分别记录，仍不可发布。完整事实及失败说明请进入详情。
        </p>
        <ReadFeedback {...imports} />
        <button
          className={`${styles.button} ${styles.secondary}`}
          onClick={imports.refresh}
        >
          刷新接收列表
        </button>
        {imports.value && (
          <>
            {imports.value.items.length === 0 && (
              <p className={styles.status}>
                尚无接收记录。此列表不执行恢复，也不推断未提交请求的结果。
              </p>
            )}
            <ul className={styles.cards}>
              {imports.value.items.map((value) => (
                <li className={styles.card} key={value.id}>
                  <ImportSummary value={value} />
                  <ValidationOverview value={value} />
                  <Link
                    className={`${styles.link} ${styles.secondary}`}
                    href={`/studio/products/${encodeURIComponent(productId)}/imports/${value.id}`}
                    aria-label={`查看接收记录 ${value.id}`}
                  >
                    查看接收与检查结果
                  </Link>
                </li>
              ))}
            </ul>
            <div className={local.pagination}>
              <Pagination
                page={page}
                hasNext={imports.value.hasNext}
                busy={imports.loading}
                onPage={setPage}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function ExistingReceive({
  value,
  settings,
  product,
  session,
}: {
  value: ImportDto;
  settings: ImportSettingsDto;
  product: ProductDto;
  session: StudioSessionDto;
}) {
  const [current, setCurrent] = useState(value);
  const [file, setFile] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canSelect =
    session.operator.role === "operator" &&
    settings.enabled &&
    !product.archivedAt &&
    (current.status === "awaiting-upload" ||
      current.status === "retryable-failed");
  async function select(selected?: File) {
    if (!selected || busy) return;
    setBusy(true);
    setFile(undefined);
    setMessage("");
    try {
      const prepared = await prepareArchiveInput(
        selected,
        settings.maxArchiveBytes,
      );
      if (
        prepared.expectedArchiveBytes !== current.expectedArchiveBytes ||
        prepared.expectedArchiveSha256 !== current.expectedArchiveSha256
      ) {
        setMessage(
          "此文件与原意图字节数或 SHA-256 不符，不能上传或修改原声明。",
        );
      } else {
        setFile(selected);
        setMessage("本地文件与原声明一致；上传仍由服务器独立核实。");
      }
    } catch {
      setMessage("文件准备未完成。请选择符合原声明且不超过 32MiB 的文件。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {canSelect && (
        <section className={styles.panel}>
          <h2>核实原文件</h2>
          <label className={styles.field}>
            与原声明一致的文件
            <input
              className={`${styles.input} ${local.file}`}
              type="file"
              disabled={busy || !!file}
              onChange={(event) => void select(event.target.files?.[0])}
            />
          </label>
          {message && (
            <p className={styles.status} role="status">
              {message}
            </p>
          )}
          {busy && <p role="status">正在计算本地 SHA-256…</p>}
        </section>
      )}
      <ReceiveControls
        initial={current}
        productId={product.id}
        session={session}
        settings={settings}
        archived={!!product.archivedAt}
        file={file}
        onUpdate={setCurrent}
      />
      <ValidationPanel
        key={`${current.productId}/${current.id}`}
        value={current}
        settings={settings}
        archived={!!product.archivedAt}
        session={session}
      />
    </>
  );
}
export function ImportDetail({
  productId,
  importId,
  session,
}: {
  productId: string;
  importId: string;
  session: StudioSessionDto;
}) {
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}`;
  const product = useImportRead<ProductDto>(endpoint);
  const settings = useImportRead<ImportSettingsDto>(
    `${endpoint}/imports/settings`,
    checkSettings,
  );
  const record = useImportRead<ImportDto>(
    `${endpoint}/imports/${encodeURIComponent(importId)}`,
    (value) => checkImport(value, { productId, importId }),
  );
  return (
    <div className={styles.workspace}>
      <section className={styles.panel}>
        <StudioPageHeader
          title="内容包接收状态"
          description="查看本次接收事实，核实未确认操作，再进入验证归档。"
        />
        <StudioWorkflowNav productId={productId} current="imports" />
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}/imports`}
        >
          返回内容包列表
        </Link>
        <ReadFeedback {...product} />
        <ReadFeedback {...settings} />
        <ReadFeedback {...record} />
        {product.value && settings.value && (
          <ImportEnvironment
            settings={settings.value}
            archived={!!product.value.archivedAt}
            readOnly={session.operator.role !== "operator"}
          />
        )}
      </section>
      {product.value && settings.value && record.value && (
        <ExistingReceive
          key={record.value.id}
          value={record.value}
          product={product.value}
          settings={settings.value}
          session={session}
        />
      )}
    </div>
  );
}
