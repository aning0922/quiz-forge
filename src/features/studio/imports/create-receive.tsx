"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ImportDto,
  ImportSettingsDto,
  Page,
} from "@/features/quizpack/import/contracts";
import type { StudioSessionDto } from "../contracts";
import { checkedImportFetch, checkImport, checkImportPage } from "./client";
import { importMessage, isUnknownWrite } from "./messages";
import { prepareArchive, type PendingArchive } from "./prepare-archive";
import { exactIntentQuery } from "./query";
import { ReceiveControls } from "./receive-controls";
import styles from "../workspace/workspace.module.css";
import local from "./imports.module.css";

export function CreateReceive({
  productId,
  settings,
  session,
  onChanged,
}: {
  productId: string;
  settings: ImportSettingsDto;
  session: StudioSessionDto;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<PendingArchive>();
  const [value, setValue] = useState<ImportDto>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [queriedEmpty, setQueriedEmpty] = useState(false);
  const endpoint = `/api/studio/products/${encodeURIComponent(productId)}/imports`;
  async function select(file?: File) {
    if (pending || busy || !file) return;
    setBusy(true);
    setMessage("");
    try {
      setPending(await prepareArchive(file, settings.maxArchiveBytes));
    } catch {
      setMessage(
        "文件准备未完成。请选择 1 字节到 32MiB 的本地文件，并确认浏览器支持 SHA-256。",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!pending || busy || value || (unknown && !queriedEmpty)) return;
    setBusy(true);
    setMessage("");
    setQueriedEmpty(false);
    try {
      setValue(
        await checkedImportFetch<ImportDto>(
          endpoint,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": session.csrfToken,
              "idempotency-key": pending.idempotencyKey,
            },
            body: JSON.stringify(pending.input),
          },
          (value) => checkImport(value, { productId, input: pending.input }),
          true,
          [200, 201],
        ),
      );
      setUnknown(false);
      onChanged();
    } catch (error) {
      setMessage(importMessage(error));
      setUnknown((previous) => previous || isUnknownWrite(error));
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!pending || busy) return;
    setBusy(true);
    setMessage("");
    setQueriedEmpty(false);
    try {
      const result = await checkedImportFetch<Page<ImportDto>>(
        `${endpoint}?${exactIntentQuery(pending.idempotencyKey)}`,
        {},
        (value) =>
          checkImportPage(value, {
            productId,
            input: pending.input,
            page: 1,
            pageSize: 1,
            exact: true,
          }),
      );
      if (result.items[0]) {
        setValue(result.items[0]);
        setUnknown(false);
        onChanged();
      } else {
        setQueriedEmpty(true);
        setMessage(
          "精确查询暂未返回记录。0 条不证明原请求未提交；可以显式用原 key 与完整原输入重提。",
        );
      }
    } catch (error) {
      setMessage(importMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <section className={styles.panel}>
        <h2>选择本地原包</h2>
        <p className={styles.note}>
          上限
          32MiB；本批仅隔离接收原字节。原包用途为未来新草稿，不会创建空草稿。
        </p>
        <label className={styles.field}>
          原包文件
          <input
            className={`${styles.input} ${local.file}`}
            key={pending ? "prepared" : "select"}
            type="file"
            disabled={busy || !!pending}
            onChange={(event) => void select(event.target.files?.[0])}
          />
        </label>
        {pending && (
          <dl className={styles.facts}>
            <div>
              <dt>本次请求标识</dt>
              <dd>{pending.idempotencyKey}</dd>
            </div>
            <div>
              <dt>字节数</dt>
              <dd>{pending.input.expectedArchiveBytes}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd>{pending.input.expectedArchiveSha256}</dd>
            </div>
          </dl>
        )}
        {unknown && (
          <p className={styles.compare} role="status">
            意图提交结果尚未确认。原文件、原 key
            与完整输入已保留在此页，请先精确核实。
          </p>
        )}
        {message && (
          <p className={styles.status} role="status">
            {message}
          </p>
        )}
        {busy && (
          <p className={styles.status} role="status">
            正在准备或核实请求…
          </p>
        )}
        <div className={styles.actions}>
          {pending && !value && (
            <button
              className={styles.button}
              disabled={busy || (unknown && !queriedEmpty)}
              onClick={() => void submit()}
            >
              {unknown ? "以原请求标识和原输入重提" : "创建原包接收意图"}
            </button>
          )}
          {pending && !value && (
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy}
              onClick={() => void reconcile()}
            >
              按原请求标识精确核实
            </button>
          )}
          {!unknown && !value && pending && (
            <button
              className={`${styles.button} ${styles.secondary}`}
              disabled={busy}
              onClick={() => {
                setPending(undefined);
                setMessage("");
              }}
            >
              重新选择文件
            </button>
          )}
        </div>
        <p className={styles.note}>
          文件与请求信息仅保留在当前页内存。操作期间请勿关闭或刷新页面；已有接收
          ID 可从列表继续读取和恢复。
        </p>
      </section>
      {value && (
        <div className={local.stack}>
          <ReceiveControls
            key={value.id}
            initial={value}
            productId={productId}
            session={session}
            settings={settings}
            archived={false}
            file={pending?.file}
            onUpdate={() => onChanged()}
          />
          <Link
            className={`${styles.link} ${styles.secondary}`}
            href={`/studio/products/${encodeURIComponent(productId)}/imports/${value.id}`}
          >
            打开接收状态页
          </Link>
        </div>
      )}
    </div>
  );
}
