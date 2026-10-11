"use client";

import { useState } from "react";
import type {
  ImportDto,
  ImportSettingsDto,
} from "@/features/quizpack/import/contracts";
import type { StudioSessionDto } from "../contracts";
import { studioFetch } from "../client";
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
}: {
  initial: ImportDto;
  productId: string;
  session: StudioSessionDto;
  settings: ImportSettingsDto;
  archived: boolean;
  file?: Blob | undefined;
  onUpdate?: (value: ImportDto) => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [mustRead, setMustRead] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}/imports/${value.id}`;
  const canWrite =
    session.operator.role === "operator" && settings.enabled && !archived;
  function adopt(next: ImportDto) {
    setValue(next);
    onUpdate?.(next);
  }
  async function read() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      adopt(await studioFetch<ImportDto>(endpoint, {}));
      setMustRead(false);
      setUnknown(false);
      setMessage("已读取服务器当前状态。新的接收与恢复仍需显式操作。");
    } catch (error) {
      setMessage(importMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function write(action: "archive" | "recover") {
    if (busy || mustRead || !canWrite || (action === "archive" && !file))
      return;
    setBusy(true);
    setMessage("");
    try {
      const result = await studioFetch<ImportDto>(
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
        true,
      );
      adopt(result);
      setUnknown(false);
      setMessage(
        action === "archive"
          ? "服务器已确认本次原包接收状态。"
          : "服务器已确认本次恢复状态。",
      );
    } catch (error) {
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
  return (
    <section className={styles.panel} aria-label="原包状态">
      <h2>接收状态</h2>
      <ImportFacts value={value} />
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
            上传所选原包
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
          此页未持有原文件。回到原包列表选择文件并以原声明核实后，才能上传。
        </p>
      )}
    </section>
  );
}
