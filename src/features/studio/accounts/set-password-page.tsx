"use client";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useStudioLeaveProtection } from "../navigation-boundary";
import { StudioClientError, studioMessage } from "../client";
import { PasswordField } from "./password-field";
import { isSetupReceipt, passwordProblem } from "./presentation";
import { setupAdapter } from "./setup-adapter";
import type {
  PasswordSetupInspectionDto,
  AccountOperationDto,
} from "./contracts";
import styles from "./accounts.module.css";
export function SetPasswordPage() {
  const token = useRef<string | null>(null),
    initialized = useRef(false),
    lock = useRef(false);
  const [inspection, setInspection] = useState<PasswordSetupInspectionDto>(),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(true),
    [message, setMessage] = useState("正在核对一次性入口…"),
    [operationId, setOperationId] = useState<string>(),
    [receipt, setReceipt] = useState<AccountOperationDto>(),
    [originalId, setOriginalId] = useState(""),
    [definite, setDefinite] = useState(false);
  useStudioLeaveProtection({
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
          "本页没有一次性入口。请使用本人收到的完整链接；刷新不会从存储恢复入口。",
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
          setMessage("入口安全索引无法核实，已保留原记录；请联系维护者。");
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
                "入口索引与服务器核实的目标不一致，已停止操作并保留原记录。",
              );
              return;
            }
            setInspection(value);
            try {
              if (readIndex(value.tokenId)) {
                setMessage(
                  "已保留原设置操作，请核实原结果，不会再次提交密码。",
                );
              } else
                setMessage(
                  "入口已核实。请本人设置密码；完成后需使用账号密码登录。",
                );
            } catch {
              setMessage(
                "原设置操作索引无法安全读取，请保留当前入口并联系维护者。",
              );
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
      setMessage("无法保存无秘密的原操作索引，未发送设置请求。");
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
          ? "本人密码设置已完成。请使用账号密码登录。"
          : "原设置请求已被拒绝，请核对入口及密码策略。",
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
            ? "原操作回执确认设置完成。"
            : "原操作回执确认设置被拒绝。",
        );
      } else
        setMessage("原结果尚未确定，继续保留 UNKNOWN；不重新提交或签发入口。");
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
      setMessage("无法确认原索引已移除，请保留现场。");
      return;
    }
    setOperationId(undefined);
    setReceipt(undefined);
    setDefinite(false);
    setInspection(undefined);
    setBusy(true);
    try {
      setInspection(await setupAdapter.inspect(token.current));
      setMessage(
        "已结束确认被拒绝的记录，入口已重新只读核实。请重新输入并明确提交。",
      );
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.page}>
      <section className={styles.panel}>
        <h1>本人设置密码</h1>
        <p>
          一次性入口已从地址栏移除，仅在当前页面内存中保留。此入口不授予后台权限，也不会登录或切换浏览器中的其他账号。
        </p>
        {inspection && (
          <>
            <h2>{inspection.displayName}</h2>
            <p>登录账号：{inspection.loginName}</p>
            <p>
              入口有效至{" "}
              {new Date(inspection.expiresAt).toLocaleString("zh-CN")}
            </p>
          </>
        )}
        <p role="status" className={styles.notice}>
          {message}
        </p>
        {inspection && !receipt && (
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
            <p>
              15–256字符长口令，保留空格，允许粘贴和密码管理器。成功后该账号已有登录全部失效。
            </p>
            <button disabled={busy || Boolean(operationId)}>
              确认设置密码
            </button>
          </form>
        )}
        {!operationId && !busy && (
          <div className={styles.form}>
            <p>
              如曾提交而结果未知，请从原安全记录取得操作编号，重新打开原完整入口后核实。入口的写权限失效，也不能据此推断原操作失败。
            </p>
            <label className={styles.field}>
              原设置操作编号
              <input
                value={originalId}
                autoComplete="off"
                onChange={(event) => setOriginalId(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  originalId,
                )
              }
              onClick={() => {
                if (!token.current) {
                  setMessage(
                    "入口只保存在内存，请重新打开原完整链接；不要在此粘贴入口秘密。",
                  );
                  return;
                }
                setOperationId(originalId);
                setMessage("原操作编号已选定。请核实，结果未知时不开放重提。");
              }}
            >
              选择原编号以核实
            </button>
          </div>
        )}
        {operationId && (
          <div className={styles.actions}>
            <button
              disabled={busy || operationId === "unavailable"}
              onClick={() => void resolve()}
            >
              核实原设置结果
            </button>
            <span>原操作编号：{operationId}</span>
          </div>
        )}
        {inspection && (definite || receipt?.status === "rejected") && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void endRejected()}
          >
            明确结束已拒绝记录并重新核对入口
          </button>
        )}
        {receipt?.status === "completed" && (
          <p>
            <Link href="/studio/login" target="_blank" rel="noopener">
              在新标签使用账号密码登录
            </Link>
            ；如当前浏览器仍登录其他账号，请使用独立窗口。
          </p>
        )}
      </section>
    </div>
  );
}
