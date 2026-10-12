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
              ? "归档完成 · 待后续草稿导入"
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
  const history = useValidationRead<Page<ValidationDto>>(
    `${endpoint}?page=${page}&pageSize=20`,
    (data) => checkValidationPage(data, { ...pair, page, pageSize: 20 }),
  );
  const [pending, setPending] = useState<PendingEntry>();
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState<ValidationDto>();
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
            setCurrent(row);
            setPending(undefined);
          } else
            setMessage(
              "原请求暂未找到；这不证明已回滚。请保留待核实记录，再次读取原请求。",
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
      setCurrent(result.validation);
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
      setCurrent(row);
      setRefusal(undefined);
      history.refresh();
    } else setMessage("原请求暂未找到；这不证明已回滚。待核实记录已保留。");
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
    setCurrent(next);
    setHalted((states) => ({ ...states, [row.id]: false }));
    history.refresh();
  }
  const latestCurrent =
    current &&
    history.value?.items.find(
      (row) =>
        row.id === current.id && row.stateRevision >= current.stateRevision,
    );
  const rows = current
    ? [
        latestCurrent || current,
        ...(history.value?.items ?? []).filter((row) => row.id !== current.id),
      ]
    : (history.value?.items ?? []);
  return (
    <section className={styles.panel} aria-labelledby="validation-heading">
      <h2 id="validation-heading">验证与私有资源归档</h2>
      <p className={styles.note}>
        本批只验证 synthetic/v1
        合成样本，与四卡内容草案分开。原包接收事实、独立验证结果和资源归档分别记录；本批不发布。
      </p>
      {!writable && (
        <p className={styles.status}>
          {readOnly
            ? "当前身份只读，可读取历史与原请求。"
            : archived
              ? "工作区已归档，可读取历史与原请求。"
              : "验证与归档已关闭，可读取历史与原请求。"}
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
            {pending.mayHaveBeenSent
              ? "本标签有待核实请求"
              : "本标签有尚未发送的准备"}
          </h3>
          <p>请求标识：{pending.tuple.expectedValidationKey.slice(0, 12)}…</p>
          <p>
            {pending.mayHaveBeenSent
              ? "请求可能已发送。刷新、超时或暂未找到记录都不能证明回滚；仅按原请求读取核实。"
              : "准备已保存。请明确选择继续验证归档或取消本次准备。"}
          </p>
          <div className={styles.actions}>
            {pending.mayHaveBeenSent ? (
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => void run(() => verify(pending.tuple))}
              >
                读取原请求核实
              </button>
            ) : (
              <>
                <button
                  className={styles.button}
                  disabled={busy || !writable || !!storageError}
                  onClick={() => void run(() => start(pending.tuple))}
                >
                  继续验证并归档
                </button>
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      cancelPrepared(storage, pending.tuple);
                    })
                  }
                >
                  取消尚未发送的准备
                </button>
              </>
            )}
            {refusal && (
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    abandonNotStarted(storage, refusal.tuple, refusal.result);
                    setRefusal(undefined);
                  })
                }
              >
                放弃本次未开始准备
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
          验证并归档
        </button>
      )}
      {value.status !== "received" && (
        <p className={styles.note}>
          请先完成原包接收；当前接收状态尚不能验证。
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
      <h3>独立验证历史</h3>
      <button
        className={`${styles.button} ${styles.secondary}`}
        disabled={busy || history.loading}
        onClick={history.refresh}
      >
        刷新验证历史
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
                当前操作已暂停。请读取此验证状态，再明确选择恢复或重试。
              </p>
            )}
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.secondary}`}
                disabled={busy}
                onClick={() => void run(() => recordAction(row, "read"))}
              >
                读取此验证状态
              </button>
              {(row.maintenanceRequired ||
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
                    !!halted[row.id]
                  }
                  onClick={() => void run(() => recordAction(row, "recover"))}
                >
                  恢复核实与对账
                </button>
              )}
              {(row.status === "validated" ||
                row.status === "retryable-failed") && (
                <button
                  className={styles.button}
                  disabled={
                    busy ||
                    !writable ||
                    !!pending ||
                    !!storageError ||
                    !!halted[row.id] ||
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
