"use client";
import { useOwnedStudioSession } from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";
import { StudioPageHeader } from "../presentation/page-header";
import Link from "next/link";
import { useState } from "react";
import { useStudioLeaveProtection } from "../navigation-boundary";
import type {
  ImportDto,
  ImportSettingsDto,
} from "@/features/quizpack/import/contracts";
import type { ProductDto } from "@/features/product/workspace/contracts";
import type { StudioSessionDto } from "../contracts";
import { ReadOnlyNotice } from "../workspace/primitives";
import { useImportRead } from "./use-read";
import { ReceiveControls } from "./receive-controls";
import { ValidationPanel } from "../validations/panel";
import { checkImport, checkSettings } from "./client";
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
function ExistingReceive({
  value,
  settings,
  product,
  session: initialSession,
}: {
  value: ImportDto;
  settings: ImportSettingsDto;
  product: ProductDto;
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
  const [current, setCurrent] = useState(value);
  const [file, setFile] = useState<Blob>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useStudioLeaveProtection({
    dirty: false,
    pending: busy,
    message: "正在核实原文件，请完成本地摘要计算后再离开。",
  });
  const canSelect =
    roleHasCapability(session.operator.role, "import:create") &&
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
  session: initialSession,
}: {
  productId: string;
  importId: string;
  session: StudioSessionDto;
}) {
  const session = useOwnedStudioSession(initialSession);
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
        <Link
          className={`${styles.link} ${styles.secondary}`}
          href={`/studio/products/${encodeURIComponent(productId)}?task=content&panel=imports`}
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
            readOnly={
              !roleHasCapability(session.operator.role, "import:create")
            }
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
