"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type {
  ImportDto,
  ImportSettingsDto,
} from "@/features/quizpack/import/contracts";
import type {
  ValidationDto,
  StartValidationResult,
  Page,
} from "@/features/quizpack/validation/contracts";
import type { StudioSessionDto } from "../contracts";
import { Pagination } from "../workspace/primitives";
import {
  checkedValidationFetch,
  checkValidation,
  checkValidationPage,
  validationEndpoint,
} from "./client";
import {
  abandonNotStarted,
  continuePrepared,
  prepareAndStart,
  reconcilePending,
} from "./flow";
import {
  acquirePair,
  cancelPrepared,
  readPending,
  type PendingEntry,
  type PendingStorage,
  type PendingTuple,
} from "./pending";
import { validationMessage } from "./messages";
import { ValidationFacts } from "./facts";
import { useValidationRead } from "./use-read";
import { mergeValidationSnapshots } from "./snapshots";
import styles from "../workspace/workspace.module.css";
const storage: PendingStorage = {
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
};
export function ValidationOverview({ value }: { value: ImportDto }) {
  const pair = { productId: value.productId, importId: value.id };
  const history = useValidationRead(
    `${validationEndpoint(pair)}?page=1&pageSize=1`,
    (data) => checkValidationPage(data, { ...pair, page: 1, pageSize: 1 }),
  );
  return (
    <div>
      {history.loading && <p role="status">正在读取独立验证摘要…</p>}
      {history.error && (
        <p role="alert">验证摘要暂不可读取，请进入详情核实。</p>
      )}
      {history.value &&
        (history.value.items[0] ? (
          <p>
            最新验证：
            {history.value.items[0].status === "ready"
              ? "检查通过 · 内容和素材已保存"
              : "已有验证记录 · 请进入详情核实"}{" "}
            · 不可发布
          </p>
        ) : (
          <p>尚无独立验证记录 · 不可发布</p>
        ))}
    </div>
  );
}
export function ValidationPanel({
  value,
  settings,
  archived,
  session,
}: {
  value: ImportDto;
  settings: ImportSettingsDto;
  archived: boolean;
  session: StudioSessionDto;
}) {
  const pair = { productId: value.productId, importId: value.id };
  const [page, setPage] = useState(1);
  const endpoint = validationEndpoint(pair);
  const [snapshots, setSnapshots] = useState<Record<string, ValidationDto>>({});
  const remember = (rows: readonly ValidationDto[]) =>
    setSnapshots((previous) => mergeValidationSnapshots(previous, rows));
  const history = useValidationRead<Page<ValidationDto>>(
    `${endpoint}?page=${page}&pageSize=20`,
    (data) => checkValidationPage(data, { ...pair, page, pageSize: 20 }),
    (data) => remember(data.items),
  );
  const [pending, setPending] = useState<PendingEntry>();
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [currentId, setCurrentId] = useState<string>();
  const [halted, setHalted] = useState<Record<string, boolean>>({});
  const [refusal, setRefusal] = useState<{
    tuple: PendingTuple;
    result: StartValidationResult;
  }>();
  const active = useRef(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const readOnly = session.operator.role !== "operator";
  const writable = !readOnly && settings.enabled && !archived;
  const reloadPending = () => {
    try {
      setPending(
        readPending(storage).find(
          (entry) =>
            entry.tuple.productId === pair.productId &&
            entry.tuple.importId === pair.importId,
        ),
      );
      setStorageError("");
    } catch (error) {
      setStorageError(validationMessage(error));
    }
  };
  useEffect(() => {
    active.current = true;
    const captured = ++generation.current;
    // Reading on mount is safe; sent entries only GET the captured original key.
    void Promise.resolve().then(async () => {
      let entry: PendingEntry | undefined;
      try {
        entry = readPending(storage).find(
          (item) =>
            item.tuple.productId === value.productId &&
            item.tuple.importId === value.id,
        );
        if (!active.current || captured !== generation.current) return;
        setPending(entry);
        if (entry?.mayHaveBeenSent) {
          const row = await reconcilePending(storage, entry.tuple);
          if (!active.current || captured !== generation.current) return;
          if (row) {
            remember([row]);
            setCurrentId(row.id);
            setPending(undefined);
          } else
            setMessage(
              "原操作暂未找到；这不证明已回滚。请保留待核实记录，再次读取原操作。",
            );
        }
      } catch (error) {
        if (active.current && captured === generation.current) {
          setMessage(validationMessage(error));
          if (!entry) setStorageError(validationMessage(error));
        }
      }
    });
    return () => {
      active.current = false;
      generation.current = captured + 1;
    };
  }, [value.productId, value.id]);
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    const captured = generation.current;
    try {
      await work();
    } catch (error) {
      if (active.current && captured === generation.current)
        setMessage(validationMessage(error));
    } finally {
      busyRef.current = false;
      if (active.current && captured === generation.current) {
        setBusy(false);
        reloadPending();
      }
    }
  }
  async function start(tuple?: PendingTuple) {
    const captured = generation.current;
    const result = tuple
      ? await continuePrepared(storage, tuple, session.csrfToken)
      : await prepareAndStart(
          storage,
          {
            ...pair,
            expectedImportStateRevision: value.stateRevision,
            archiveSha256: value.expectedArchiveSha256,
            archiveBytes: value.expectedArchiveBytes,
          },
          session.csrfToken,
          (prepared) => {
            if (active.current && captured === generation.current)
              setPending({ tuple: prepared, mayHaveBeenSent: false });
          },
        );
    if (!active.current || captured !== generation.current) return;
    if (result.outcome === "record") {
      remember([result.validation]);
      setCurrentId(result.validation.id);
      setRefusal(undefined);
      history.refresh();
    } else {
      const entry = readPending(storage).find(
        (item) =>
          item.tuple.productId === pair.productId &&
          item.tuple.importId === pair.importId,
      );
      if (entry) {
        setRefusal({ tuple: entry.tuple, result });
        setMessage(
          "本次尚未开始。服务器已明确确认这次调用未提交验证；可以放弃本次准备。",
        );
      }
    }
  }
  async function verify(tuple: PendingTuple) {
    const captured = generation.current;
    const row = await reconcilePending(storage, tuple);
    if (!active.current || captured !== generation.current) return;
    if (row) {
      remember([row]);
      setCurrentId(row.id);
      setRefusal(undefined);
      history.refresh();
    } else setMessage("原操作暂未找到；这不证明已回滚。待核实记录已保留。");
  }
  async function recordAction(
    row: ValidationDto,
    action: "read" | "recover" | "retry",
  ) {
    const captured = generation.current;
    const release = action === "read" ? undefined : acquirePair(pair);
    if (action !== "read")
      setHalted((states) => ({ ...states, [row.id]: true }));
    let next: ValidationDto;
    try {
      next = await checkedValidationFetch(
        `${endpoint}/${row.id}${action === "read" ? "" : `/${action}`}`,
        action === "read"
          ? {}
          : {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-csrf-token": session.csrfToken,
              },
              body: JSON.stringify({
                expectedStateRevision: row.stateRevision,
              }),
            },
        (data) => {
          const result = checkValidation(data, {
            ...pair,
            validationId: row.id,
          });
          if (
            result.stateRevision < row.stateRevision ||
            result.validationKey !== row.validationKey ||
            result.archiveSha256 !== row.archiveSha256 ||
            result.archiveBytes !== row.archiveBytes ||
            result.identitySha256 !== row.identitySha256
          )
            throw new Error("INVALID_VALIDATION_RESPONSE");
          return result;
        },
        action !== "read",
      );
    } finally {
      release?.();
    }
    if (!active.current || captured !== generation.current) return;
    remember([next]);
    setCurrentId(next.id);
    setHalted((states) => ({ ...states, [row.id]: false }));
    history.refresh();
  }
  const current = currentId ? snapshots[currentId] : undefined;
  const rows = current
    ? [
        current,
        ...(history.value?.items ?? [])
          .filter((row) => row.id !== current.id)
          .map((row) => snapshots[row.id] || row),
      ]
    : (history.value?.items ?? []).map((row) => snapshots[row.id] || row);
  return (
    <section className={styles.panel} aria-labelledby="validation-heading">
      <h2 id="validation-heading">检查内容并保存素材</h2>
      <p className={styles.note}>
        检查内容包结构并保存所需素材。检查通过后，仍需明确建立或更新草稿；检查不代表内容、素材已获审核批准，也不会发布商品。
      </p>
      {!writable && (
        <p className={styles.status}>
          {readOnly
            ? "当前身份只读，可读取历史与原操作。"
            : archived
              ? "工作区已归档，可读取历史与原操作。"
              : "验证与归档已关闭，可读取历史与原操作。"}
        </p>
      )}
      {storageError && (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {storageError}
        </p>
      )}
      {pending && (
        <div className={styles.compare}>
          <h3>
            {storageError
              ? "当前标签页状态待核实"
              : pending.mayHaveBeenSent
                ? "当前标签页有待核实请求"
                : busy
                  ? "正在处理验证请求"
                  : "当前标签页有尚未发送的准备"}
          </h3>
          <p>操作编号：{pending.tuple.expectedValidationKey.slice(0, 12)}…</p>
          <p>
            {storageError
              ? "当前标签页的记录当前无法读取或保存，发送状态仍待核实。请保留记录并读取服务器历史。"
              : pending.mayHaveBeenSent
                ? "请求可能已发送。刷新、超时或暂未找到记录都不能证明回滚；仅按原操作读取核实。"
                : busy
                  ? "本次操作尚未结束，结果仍待确认。请等待操作完成。"
                  : "准备已保存。请明确选择继续验证归档或取消本次准备。"}
          </p>
          <div className={styles.actions}>
            {pending.mayHaveBeenSent ? (
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void run(() => verify(pending.tuple))}
              >
                读取原操作核实
              </button>
            ) : (
              <>
                <button
                  className={styles.button}
                  disabled={busy || !writable || !!storageError}
                  onClick={() => void run(() => start(pending.tuple))}
                >
                  继续检查内容并保存素材
                </button>
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  disabled={busy || !!storageError}
                  onClick={() =>
                    void run(async () => {
                      cancelPrepared(storage, pending.tuple);
                    })
                  }
                >
                  {busy || storageError ? "取消准备" : "取消尚未发送的准备"}
                </button>
              </>
            )}
            {refusal && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy || !!storageError}
                onClick={() =>
                  void run(async () => {
                    abandonNotStarted(storage, refusal.tuple, refusal.result);
                    setRefusal(undefined);
                  })
                }
              >
                {storageError ? "放弃准备" : "放弃本次未开始准备"}
              </button>
            )}
          </div>
        </div>
      )}
      {!pending && (
        <button
          className={styles.button}
          disabled={
            busy ||
            !writable ||
            !!storageError ||
            value.status !== "received" ||
            value.storageCondition !== "clean" ||
            history.loading ||
            !!history.error
          }
          onClick={() => void run(() => start())}
        >
          检查内容并保存素材
        </button>
      )}
      {value.status !== "received" && (
        <p className={styles.note}>
          请先完成内容包接收；当前接收状态尚不能验证。
        </p>
      )}
      {busy && (
        <p className={styles.status} role="status">
          正在处理显式操作…
        </p>
      )}
      {message && (
        <p className={styles.status} role="status">
          {message}
        </p>
      )}
      <h3>内容检查记录</h3>
      <button
        className={`${styles.button} ${styles.secondary}`}
        disabled={busy || history.loading}
        onClick={history.refresh}
      >
        刷新检查记录
      </button>
      {history.loading && <p role="status">正在读取验证历史…</p>}
      {history.error && (
        <p className={`${styles.status} ${styles.error}`} role="alert">
          {history.error}
        </p>
      )}
      {history.value && rows.length === 0 && (
        <p className={styles.status}>
          尚无验证记录。列表为空不证明未知请求未提交。
        </p>
      )}
      <ul className={styles.cards}>
        {rows.map((row) => (
          <li className={styles.card} key={row.id}>
            <ValidationFacts value={row} />
            {halted[row.id] && (
              <p className={styles.status}>
                当前操作已暂停。请查询此次检查结果，再明确选择恢复或重试。
              </p>
            )}
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy}
                onClick={() => void run(() => recordAction(row, "read"))}
              >
                查询此次检查结果
              </button>
              {!row.readOnly &&
                (row.maintenanceRequired ||
                  row.storageCondition !== "clean" ||
                  row.status === "validating" ||
                  row.status === "archiving") && (
                  <button
                    className={styles.button}
                    disabled={
                      busy ||
                      !writable ||
                      !!pending ||
                      !!storageError ||
                      !!halted[row.id] ||
                      history.loading ||
                      !!history.error
                    }
                    onClick={() => void run(() => recordAction(row, "recover"))}
                  >
                    恢复核实与对账
                  </button>
                )}
              {!row.readOnly &&
                (row.status === "validated" ||
                  row.status === "retryable-failed") && (
                  <button
                    className={styles.button}
                    disabled={
                      busy ||
                      !writable ||
                      !!pending ||
                      !!storageError ||
                      !!halted[row.id] ||
                      history.loading ||
                      !!history.error ||
                      row.maintenanceRequired ||
                      row.storageCondition !== "clean" ||
                      row.remainingAttempts === 0
                    }
                    onClick={() => void run(() => recordAction(row, "retry"))}
                  >
                    明确重试验证或归档
                  </button>
                )}
              <Link
                className={`${styles.link} ${styles.secondary}`}
                href={`/studio/products/${encodeURIComponent(pair.productId)}/imports/${pair.importId}/validations/${row.id}`}
              >
                查看验证详情
              </Link>
            </div>
          </li>
        ))}
      </ul>
      {history.value && (
        <Pagination
          page={page}
          hasNext={history.value.hasNext}
          busy={busy || history.loading}
          onPage={setPage}
        />
      )}
    </section>
  );
}
