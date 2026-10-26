"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { StudioClientError, studioMessage } from "../client";
import { PasswordField } from "./password-field";
import { isSetupReceipt, passwordProblem } from "./presentation";
import { setupAdapter } from "./setup-adapter";
import type {
  PasswordSetupInspectionDto,
  AccountOperationDto,
} from "./contracts";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { EntryScene } from "./entry-scene";
import { AccountAvatar } from "./account-ui";
import styles from "./entry.module.css";
export function SetPasswordPage() {
  const token = useRef<string | null>(null),
    initialized = useRef(false),
    lock = useRef(false);
  const [inspection, setInspection] = useState<PasswordSetupInspectionDto>(),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(true),
    [message, setMessage] = useState("正在核对设置链接…"),
    [operationId, setOperationId] = useState<string>(),
    [receipt, setReceipt] = useState<AccountOperationDto>(),
    [originalId, setOriginalId] = useState(""),
    [definite, setDefinite] = useState(false);
  const protection = useStudioLeaveProtection({
    dirty: Boolean(password || confirm),
    pending: Boolean(operationId && !receipt),
  });
  useLayoutEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    token.current = params.get("token");
    const hint = params.get("tokenId");
    history.replaceState(
      history.state,
      "",
      location.pathname + location.search,
    );
    queueMicrotask(() => {
      if (!token.current) {
        setBusy(false);
        setMessage(
          "请重新打开收到的完整设置链接。若链接已过期，请联系管理员重新发送。",
        );
        return;
      }
      function readIndex(tokenId: string) {
        const saved = sessionStorage.getItem(
          `quizforge.studio.password-setup.v1:${tokenId}`,
        );
        if (!saved) return false;
        const index = JSON.parse(saved) as {
          tokenId: string;
          operationId: string;
        };
        if (
          Object.keys(index).length !== 2 ||
          index.tokenId !== tokenId ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            index.operationId,
          )
        )
          throw Error();
        setOperationId(index.operationId);
        return true;
      }
      if (hint !== null) {
        try {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              hint,
            )
          )
            throw Error();
          readIndex(hint);
        } catch {
          setOperationId("unavailable");
          setBusy(false);
          setMessage("暂时无法核实之前的操作。请保留此页并联系管理员。");
          return;
        }
      }
      void setupAdapter
        .inspect(token.current)
        .then(
          (value) => {
            if (hint !== null && hint !== value.tokenId) {
              setOperationId("unavailable");
              setMessage(
                "设置链接与账号信息不一致，已停止操作。请联系管理员核实。",
              );
              return;
            }
            setInspection(value);
            try {
              if (readIndex(value.tokenId)) {
                setMessage("上次设置的结果待确认，请先核实，勿重复提交。");
              } else setMessage("请本人设置新密码，完成后使用账号密码登录。");
            } catch {
              setMessage("暂时无法读取上次设置记录，请保留此页并联系管理员。");
              setOperationId("unavailable");
            }
          },
          (error) => setMessage(studioMessage(error)),
        )
        .finally(() => setBusy(false));
    });
  }, []);
  async function submit() {
    if (lock.current || busy || operationId || !inspection || !token.current)
      return;
    const problem = passwordProblem(password);
    if (problem || password !== confirm) {
      setMessage(problem ?? "两次密码不一致。");
      return;
    }
    const id = crypto.randomUUID(),
      key = `quizforge.studio.password-setup.v1:${inspection.tokenId}`;
    try {
      const text = JSON.stringify({
        tokenId: inspection.tokenId,
        operationId: id,
      });
      sessionStorage.setItem(key, text);
      if (sessionStorage.getItem(key) !== text) throw Error();
    } catch {
      setMessage("无法保留本次操作记录，尚未提交。请保留此页并联系管理员。");
      return;
    }
    const secret = password;
    setPassword("");
    setConfirm("");
    setOperationId(id);
    setBusy(true);
    lock.current = true;
    try {
      const value = await setupAdapter.submit(token.current, id, secret);
      if (!isSetupReceipt(value, id)) throw Error();
      setReceipt(value);
      setMessage(
        value.status === "completed"
          ? "密码设置成功，请使用账号密码登录。"
          : "密码设置未完成，请检查设置链接和密码要求。",
      );
    } catch (error) {
      setDefinite(
        error instanceof StudioClientError &&
          ((error.code === "RATE_LIMITED" && error.httpStatus === 429) ||
            ["PASSWORD_POLICY_REJECTED", "INVALID_REQUEST"].includes(
              error.code,
            )),
      );
      setMessage(studioMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function resolve() {
    if (!operationId || !token.current || busy || operationId === "unavailable")
      return;
    setBusy(true);
    try {
      const result = await setupAdapter.result(token.current, operationId);
      if (
        result.status === "found" &&
        isSetupReceipt(result.operation, operationId)
      ) {
        setReceipt(result.operation);
        setMessage(
          result.operation.status === "completed"
            ? "已核实上次操作：密码设置成功。"
            : "已核实上次操作：未完成密码设置。",
        );
      } else setMessage("结果待确认，请先核实，勿重复提交。");
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function endRejected() {
    if (
      busy ||
      !inspection ||
      !token.current ||
      (!definite && receipt?.status !== "rejected")
    )
      return;
    const key = `quizforge.studio.password-setup.v1:${inspection.tokenId}`;
    try {
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) throw Error();
    } catch {
      setMessage("暂时无法结束本次记录，请保留此页并联系管理员。");
      return;
    }
    setOperationId(undefined);
    setReceipt(undefined);
    setDefinite(false);
    setInspection(undefined);
    setBusy(true);
    try {
      setInspection(await setupAdapter.inspect(token.current));
      setMessage("本次记录已结束。请重新输入密码并确认设置。");
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      setBusy(false);
    }
  }
  function endCompleted() {
    if (
      busy ||
      receipt?.status !== "completed" ||
      receipt.operationId !== operationId
    )
      return;
    if (inspection) {
      const key = `quizforge.studio.password-setup.v1:${inspection.tokenId}`;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const index = JSON.parse(raw) as {
            tokenId: string;
            operationId: string;
          };
          if (
            Object.keys(index).length !== 2 ||
            index.tokenId !== inspection.tokenId ||
            index.operationId !== receipt.operationId
          )
            throw Error();
          sessionStorage.removeItem(key);
          if (sessionStorage.getItem(key) !== null) throw Error();
        }
      } catch {
        setMessage("暂时无法结束本次记录，请保留此页并联系管理员。");
        return;
      }
    }
    // A recovered receipt can outlive strict inspection. Never erase an index using an untrusted URL hint.
    protection.markSaved();
    token.current = null;
    // Re-enter the authentication boundary as a document after confirming this local operation.
    window.location.assign(
      new URL("/studio/login", window.location.origin).href,
    );
  }
  const completed = receipt?.status === "completed";
  const reset =
    inspection && !["setup", "bootstrap-admin"].includes(inspection.purpose);
  return (
    <EntryScene
      kind="setup"
      eyebrow={
        completed
          ? "ACCOUNT SECURITY / COMPLETE"
          : reset
            ? "ACCOUNT SECURITY / RESET"
            : "ACCOUNT ACTIVATION"
      }
      title={
        completed ? "密码设置成功" : reset ? "重置账号密码" : "设置登录密码"
      }
      description="一次性设置入口仅用于本账号的密码操作，设置成功后仍需重新登录。"
    >
      {completed ? (
        <div className={styles.success} role="status">
          <CheckCircle2 size={32} aria-hidden="true" />
          <h2>新密码已生效</h2>
          <p>这个账号的旧登录已失效，请使用新密码登录。</p>
        </div>
      ) : (
        inspection && (
          <section className={styles.identity} aria-label="设置目标账号">
            <div className={styles.identityHeader}>
              <AccountAvatar name={inspection.displayName} />
              <div>
                <h2>{inspection.displayName}</h2>
                <p>登录账号：{inspection.loginName}</p>
              </div>
            </div>
            <p>
              设置入口有效至{" "}
              {new Date(inspection.expiresAt).toLocaleString("zh-CN")}
              ，仅能使用一次。
            </p>
          </section>
        )
      )}
      <p
        role="status"
        aria-live="polite"
        className={`${styles.status} ${!busy && !inspection && !operationId && !receipt ? styles.error : ""}`}
      >
        {message}
      </p>
      {inspection && !receipt && !operationId && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            name="username"
            autoComplete="username"
            value={inspection.loginName}
            readOnly
            hidden
          />
          <PasswordField
            label="新密码"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            disabled={busy || Boolean(operationId)}
          />
          <PasswordField
            label="确认新密码"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            disabled={busy || Boolean(operationId)}
          />
          <p className={styles.prompt}>
            15–256 个字符，允许空格，支持粘贴和密码管理器，不自动裁剪。
          </p>
          <button
            className={`${styles.button} ${styles.primary}`}
            disabled={busy || Boolean(operationId)}
          >
            {busy ? "正在设置…" : "确认设置密码"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      )}
      {!operationId && !busy && !completed && (
        <details className={styles.recovery}>
          <summary>核实上次设置结果</summary>
          <p>
            如果上次设置结果待确认，请打开原完整设置链接，并选择原操作编号核实。请勿直接重复提交。
          </p>
          <div className={styles.form}>
            <label className={styles.field}>
              原设置操作编号
              <input
                value={originalId}
                autoComplete="off"
                onChange={(event) => setOriginalId(event.target.value)}
              />
            </label>
            <button
              className={styles.button}
              type="button"
              disabled={
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  originalId,
                )
              }
              onClick={() => {
                if (!token.current) {
                  setMessage(
                    "请重新打开原完整设置链接，再核实上次操作；这里仅填写操作编号。",
                  );
                  return;
                }
                setOperationId(originalId);
                setMessage("已选定原操作编号，请先核实，勿重复提交。");
              }}
            >
              选择原编号以核实
            </button>
          </div>
        </details>
      )}
      {operationId && !completed && (
        <section className={styles.operation} aria-label="原密码设置操作">
          <p>原操作已保留，核实前不能再次设置密码。</p>
          <code>原操作编号：{operationId}</code>
          <button
            className={styles.button}
            disabled={busy || operationId === "unavailable"}
            onClick={() => void resolve()}
          >
            {busy ? "正在核实…" : "核实原设置结果"}
          </button>
        </section>
      )}
      {inspection && (definite || receipt?.status === "rejected") && (
        <button
          className={styles.button}
          type="button"
          disabled={busy}
          onClick={() => void endRejected()}
        >
          结束本次记录并重新设置
        </button>
      )}
      {completed && (
        <>
          <button
            className={`${styles.button} ${styles.primary}`}
            type="button"
            disabled={busy}
            onClick={endCompleted}
          >
            完成并返回登录
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className={styles.prompt}>
            如当前浏览器仍登录其他账号，请使用独立窗口登录。此操作不会退出其他账号。
          </p>
        </>
      )}
      {!inspection && !busy && !operationId && !completed && (
        <p className={styles.prompt}>
          入口失效或未收到完整链接？请联系管理员核对并获取设置入口。
        </p>
      )}
    </EntryScene>
  );
}
