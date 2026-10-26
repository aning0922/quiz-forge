"use client";
import {
  useOwnedStudioSession,
  useStudioRecoveryReset,
} from "../accounts/session-owner";
import { roleHasCapability } from "@/lib/auth/role-policy";
import { useContentAuthority } from "../product-workspace/content-authority";

import { useState, type ReactNode } from "react";
import { prepareArchiveInput } from "./prepare-archive";
import compact from "../product-workspace/content-workbench.module.css";
import { TechnicalDetails } from "../presentation/technical-details";
import {
  useContentTaskState,
  type ContentStateObserver,
} from "../product-workspace/content-task-state";
import { useStudioLeaveProtection } from "../navigation-boundary";
import type {
  ImportDto,
  ImportSettingsDto,
} from "@/features/quizpack/import/contracts";
import type { StudioSessionDto } from "../contracts";
import { checkedImportFetch, checkImport } from "./client";
import { StudioClientError } from "../client";
import { importMessage, isUnknownWrite } from "./messages";
import { ImportFacts } from "./import-facts";
import styles from "../workspace/workspace.module.css";

export function ReceiveControls({
  initial,
  productId,
  session: initialSession,
  settings,
  archived,
  file,
  onUpdate,
  embedded = false,
  onState,
  renderActions,
  onInspectSource,
}: {
  initial: ImportDto;
  productId: string;
  session: StudioSessionDto;
  settings: ImportSettingsDto;
  archived: boolean;
  file?: Blob | undefined;
  onUpdate?: (value: ImportDto) => void;
  embedded?: boolean;
  onState?: ContentStateObserver | undefined;
  renderActions?: ((actions: ReactNode) => ReactNode) | undefined;
  onInspectSource?: ((importId: string) => void) | undefined;
}) {
  const session = useOwnedStudioSession(initialSession);
  const authority = useContentAuthority();
  const [value, setValue] = useState(initial);
  const [selectedFile, setSelectedFile] = useState<File>();
  const activeFile = file ?? selectedFile;
  const [busy, setBusy] = useState(false);
  const [mustRead, setMustRead] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}/imports/${value.id}`;
  const canWrite =
    authority.canWrite() &&
    roleHasCapability(session.operator.role, "import:create") &&
    settings.enabled &&
    !archived;
  useStudioRecoveryReset(() => setMustRead(true));
  function adopt(next: ImportDto) {
    setValue(next);
    onUpdate?.(next);
  }
  async function read() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      adopt(
        await checkedImportFetch<ImportDto>(endpoint, {}, (next) =>
          checkImport(next, {
            productId,
            importId: value.id,
            input: {
              expectedArchiveBytes: value.expectedArchiveBytes,
              expectedArchiveSha256: value.expectedArchiveSha256,
              target: { kind: "new-draft" },
            },
          }),
        ),
      );
      setMustRead(false);
      setUnknown(false);
      setMessage("已读取服务器当前状态。新的接收与恢复仍需显式操作。");
    } catch (error) {
      authority.observe(error);
      setMessage(importMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function write(action: "archive" | "recover") {
    if (
      !authority.canWrite() ||
      busy ||
      mustRead ||
      !canWrite ||
      (action === "archive" && !activeFile)
    )
      return;
    setBusy(true);
    setMessage("");
    try {
      const result = await checkedImportFetch<ImportDto>(
        `${endpoint}/${action}`,
        {
          method: action === "archive" ? "PUT" : "POST",
          headers: {
            "content-type":
              action === "archive"
                ? "application/octet-stream"
                : "application/json",
            "x-csrf-token": session.csrfToken,
          },
          body:
            action === "archive"
              ? activeFile!
              : JSON.stringify({ expectedStateRevision: value.stateRevision }),
        },
        (next) =>
          checkImport(next, {
            productId,
            importId: value.id,
            input: {
              expectedArchiveBytes: value.expectedArchiveBytes,
              expectedArchiveSha256: value.expectedArchiveSha256,
              target: { kind: "new-draft" },
            },
          }),
        true,
      );
      adopt(result);
      setUnknown(false);
      setMessage(
        action === "archive"
          ? "服务器已确认本次内容包接收状态。"
          : "服务器已确认本次恢复状态。",
      );
    } catch (error) {
      authority.observe(error);
      setMessage(importMessage(error));
      setMustRead(true);
      setUnknown(isUnknownWrite(error));
    } finally {
      setBusy(false);
    }
  }
  const mayUpload =
    (value.status === "awaiting-upload" ||
      value.status === "retryable-failed") &&
    value.storageCondition === "clean";
  const mayRecover =
    value.status === "receiving" ||
    value.status === "retryable-failed" ||
    value.storageCondition !== "clean";
  useContentTaskState(onState, {
    busy,
    pending: mustRead || unknown || mayUpload || mayRecover,
    retained: true,
    message:
      unknown || mustRead
        ? "上传结果待核实；原文件和接收记录继续保留。"
        : undefined,
  });
  useStudioLeaveProtection({
    dirty: false,
    pending: !!activeFile && (busy || mustRead || mayUpload || mayRecover),
    message:
      "当前页仍持有本次接收所需的原文件。请先完成上传与状态核实，再离开；不会自动重传。",
  });
  async function selectOriginal(selected?: File) {
    if (!selected || activeFile || busy || mustRead || unknown || !canWrite)
      return;
    setBusy(true);
    setMessage("");
    try {
      const input = await prepareArchiveInput(
        selected,
        settings.maxArchiveBytes,
      );
      if (
        input.expectedArchiveBytes !== value.expectedArchiveBytes ||
        input.expectedArchiveSha256 !== value.expectedArchiveSha256
      ) {
        setMessage(
          "此文件与原接收声明的字节数或 SHA-256 不符，不能上传。原声明保持不变。",
        );
        return;
      }
      setSelectedFile(selected);
      setMessage("原文件字节与声明一致，等待明确上传。");
    } catch {
      setMessage("原文件尚未核实，请重新选择符合原声明的文件。");
    } finally {
      setBusy(false);
    }
  }
  if (embedded) {
    const actions = (
      <div className={compact.footerActions}>
        {canWrite && mayUpload && activeFile && (
          <button
            className={compact.primary}
            disabled={busy || mustRead}
            onClick={() => void write("archive")}
          >
            上传本次文件
          </button>
        )}
        {(mustRead || unknown || mayRecover) && (
          <button
            className={compact.secondary}
            disabled={busy}
            onClick={() => void read()}
          >
            读取原接收结果
          </button>
        )}
        {canWrite && mayRecover && (
          <button
            className={compact.primary}
            disabled={busy || mustRead}
            onClick={() => void write("recover")}
          >
            核实并恢复接收
          </button>
        )}
      </div>
    );
    return (
      <div className={compact.stage}>
        <h3>
          {value.status === "received"
            ? "内容包已有明确接收结果"
            : value.status === "rejected" && value.storageCondition === "clean"
              ? "本次内容包已确认拒绝"
              : "本次接收记录已建立"}
        </h3>
        <p
          className={
            value.status === "received" ? compact.success : compact.intro
          }
        >
          {value.status === "received"
            ? "接收成功不等于检查通过。下一步需独立检查内容与素材。"
            : value.status === "rejected" && value.storageCondition === "clean"
              ? "此来源保留为拒绝记录，不能修改原声明后重传。"
              : "原始文件尚需上传或核实；此步骤不会检查内容或生成草稿。"}
        </p>
        <dl className={compact.checkCard}>
          <div>
            <dt>接收结果</dt>
            <dd>
              {value.status === "received"
                ? "已接收"
                : value.status === "awaiting-upload"
                  ? "等待上传原文件"
                  : value.status === "rejected"
                    ? "已拒绝"
                    : "待核实或恢复"}
            </dd>
          </div>
          <div>
            <dt>文件大小</dt>
            <dd>{Math.ceil(value.expectedArchiveBytes / 1024)} KB</dd>
          </div>
          <div>
            <dt>存储状态</dt>
            <dd>
              {value.storageCondition === "clean"
                ? "记录一致"
                : "需要核实，暂不能继续"}
            </dd>
          </div>
        </dl>
        {(unknown || mustRead) && (
          <div className={compact.pending} role="status">
            <strong>原上传结果需要核实</strong>
            <p>原文件与接收记录保持，不自动重传；请先读取原接收结果。</p>
          </div>
        )}
        {value.lastErrorCode && (
          <p className={compact.warning}>
            {importMessage(new StudioClientError(value.lastErrorCode))}
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {busy && <p role="status">正在处理本次接收，请等待确认…</p>}
        {canWrite && mayUpload && !activeFile && !mustRead && !unknown && (
          <label className={compact.fileField}>
            重新选择同一原文件
            <input
              type="file"
              accept=".quizpack"
              disabled={busy}
              onChange={(event) => void selectOriginal(event.target.files?.[0])}
            />
            <span className={compact.caption}>
              仅核对原字节和声明，不建立新接收记录。
            </span>
          </label>
        )}
        {activeFile && (
          <p className={compact.caption}>
            原文件保留在本任务中；隐藏浮层不会卸载文件。
          </p>
        )}
        {!canWrite && (
          <p className={compact.warning}>
            {!authority.canWrite() ? (
              <>
                当前写入身份已失效，原任务保持。
                <a href="/studio/login" target="_blank" rel="noopener">
                  在新标签重新登录
                </a>
                不会恢复本页旧权限。
              </>
            ) : !roleHasCapability(session.operator.role, "import:create") ? (
              "当前身份只读，可读取原操作，不能上传或恢复接收。"
            ) : archived ? (
              "工作区已归档，不能上传或恢复接收。"
            ) : (
              "本机接收写入已关闭，原操作仍可读取核实。"
            )}
          </p>
        )}
        {onInspectSource && (
          <button
            className={compact.textButton}
            disabled={busy}
            onClick={() => onInspectSource(value.id)}
          >
            查看此来源记录
          </button>
        )}
        {renderActions ? renderActions(actions) : actions}
      </div>
    );
  }
  return (
    <section className={styles.panel} aria-label="内容包状态">
      <h2>接收状态</h2>
      {embedded ? (
        <>
          <p>
            {value.status === "received" && value.storageCondition === "clean"
              ? "文件已接收。下一步需独立检查内容与素材。"
              : "本次文件仍需完成上传或核实接收状态。"}
          </p>
          <TechnicalDetails label="本次接收记录">
            <ImportFacts value={value} />
          </TechnicalDetails>
        </>
      ) : (
        <ImportFacts value={value} />
      )}
      {unknown && (
        <p className={styles.compare} role="status">
          提交结果尚未确认。已保留接收
          ID，不会自动重传。先读取权威状态，再按需显式恢复。
        </p>
      )}
      {message && (
        <p className={styles.status} role="status">
          {message}
        </p>
      )}
      <div className={styles.actions}>
        <button
          className={`${styles.button} ${styles.secondary}`}
          disabled={busy}
          onClick={() => void read()}
        >
          读取最新接收状态
        </button>
        {canWrite && mayUpload && file && (
          <button
            className={styles.button}
            disabled={busy || mustRead}
            onClick={() => void write("archive")}
          >
            上传所选内容包
          </button>
        )}
        {canWrite && mayRecover && (
          <button
            className={`${styles.button} ${styles.secondary}`}
            disabled={busy || mustRead}
            onClick={() => void write("recover")}
          >
            显式恢复接收
          </button>
        )}
      </div>
      {busy && (
        <p className={styles.status} role="status">
          正在请求服务器，请等待确认。上传结束不代表事务成功。
        </p>
      )}
      {mustRead && (
        <p className={styles.note}>
          当前操作已暂停，必须读取最新状态后才能再次显式操作。
        </p>
      )}
      {mayUpload && !file && (
        <p className={styles.note}>
          此页未持有原文件。请在当前页上方选择文件并核实与原声明一致后，再显式上传。
        </p>
      )}
      {file &&
        (mayUpload || mayRecover || mustRead) &&
        (!embedded || !canWrite || unknown || mustRead) && (
          <div className={styles.note}>
            <p>
              若运营身份已失效，可在新标签重新登录，再打开原接收记录 {value.id}{" "}
              查询状态。原页继续保留文件与现场，但不会因此恢复旧权限；新页上传前仍需重新选择与原声明一致的文件。
            </p>
            <a
              className={`${styles.link} ${styles.secondary}`}
              href={endpoint.replace("/api/studio/", "/studio/")}
              target="_blank"
              rel="noopener"
            >
              在新标签打开原接收记录
            </a>
          </div>
        )}
    </section>
  );
}
