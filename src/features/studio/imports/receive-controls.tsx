"use client";
import { useContentAuthority } from "../product-workspace/content-authority";

import { useState } from "react";
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
import { importMessage, isUnknownWrite } from "./messages";
import { ImportFacts } from "./import-facts";
import styles from "../workspace/workspace.module.css";

export function ReceiveControls({
  initial,
  productId,
  session,
  settings,
  archived,
  file,
  onUpdate,
  embedded = false,
  onState,
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
}) {
  const authority = useContentAuthority();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [mustRead, setMustRead] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}/imports/${value.id}`;
  const canWrite =
    authority.canWrite() &&
    session.operator.role === "operator" &&
    settings.enabled &&
    !archived;
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
      (action === "archive" && !file)
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
              ? file!
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
    pending: !!file && (busy || mustRead || mayUpload || mayRecover),
    message:
      "当前页仍持有本次接收所需的原文件。请先完成上传与状态核实，再离开；不会自动重传。",
  });
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
      {file && (mayUpload || mayRecover || mustRead) && (
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
