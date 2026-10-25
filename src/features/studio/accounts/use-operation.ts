"use client";
import { useEffect, useRef, useState } from "react";
import { useStudioAccountOwner } from "./session-owner";
import { captureStudioEpoch, acceptsStudioEpoch } from "../authority-events";
import type { StudioSessionDto } from "../contracts";
import { StudioClientError, studioFetch, studioMessage } from "../client";
import type {
  AccountAction,
  AccountMutationDto,
  AccountOperationDto,
  AccountOperationResultDto,
} from "./contracts";
type Pending = {
  operationId: string;
  actorId: string;
  action: AccountAction;
  targetId: string | null;
};
/** Only a non-secret receipt index is persisted. A new submission never replaces UNKNOWN. */
export function useAccountOperation(session: StudioSessionDto, scope: string) {
  const authority = useStudioAccountOwner();
  const [owner] = useState(session.operator.id);
  const key = `quizforge.studio.account-operation.v1:${owner}:${scope}`;
  const [pending, setPending] = useState<Pending>();
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState<AccountOperationDto>(),
    [mutation, setMutation] = useState<AccountMutationDto>();
  const [definite, setDefinite] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = sessionStorage.getItem(key);
        if (raw) {
          const item = JSON.parse(raw) as Pending;
          if (
            item.actorId !== owner ||
            !/^[0-9a-f-]{36}$/.test(item.operationId) ||
            typeof item.action !== "string"
          )
            throw Error();
          setPending(item);
          setMessage("上次操作的结果待确认，请先核实，勿重复提交。");
        }
        setReady(true);
      } catch {
        setMessage(
          "无法读取之前的操作记录，暂时不能提交。请保留此页并联系管理员。",
        );
      }
    });
    return () => {
      active = false;
    };
  }, [key, owner]);
  useEffect(() => {
    if (!authority?.revoked) return;
    queueMicrotask(() => setMutation(undefined));
  }, [authority?.revoked]);
  function matches(op: AccountOperationDto, original: Pending) {
    if (
      !op ||
      !["completed", "rejected"].includes(op.status) ||
      !/^[0-9a-f-]{36}$/i.test(op.targetId) ||
      !Number.isFinite(Date.parse(op.createdAt)) ||
      (op.errorCode !== null && typeof op.errorCode !== "string") ||
      op.operationId !== original.operationId ||
      op.actorId !== owner ||
      op.action !== original.action ||
      (original.targetId && op.targetId !== original.targetId)
    )
      throw Error("ACCOUNT_RECEIPT_MISMATCH");
  }
  async function submit(
    path: string,
    method: "POST" | "PATCH",
    action: AccountAction,
    targetId: string | null,
    body: Record<string, unknown>,
  ) {
    if (
      !ready ||
      pending ||
      locked.current ||
      authority?.revoked ||
      session.operator.id !== owner
    )
      return;
    const epoch = captureStudioEpoch();
    const original: Pending = {
      operationId: crypto.randomUUID(),
      actorId: owner,
      action,
      targetId,
    };
    try {
      const raw = JSON.stringify(original);
      sessionStorage.setItem(key, raw);
      if (sessionStorage.getItem(key) !== raw) throw Error();
    } catch {
      setReady(false);
      setMessage("无法保留本次操作记录，尚未提交。请保留此页并联系管理员。");
      return;
    }
    locked.current = true;
    setBusy(true);
    setPending(original);
    setDefinite(false);
    setReceipt(undefined);
    setMutation(undefined);
    setMessage("正在提交，请等待结果…");
    try {
      const value = await studioFetch<AccountMutationDto | AccountOperationDto>(
        path,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          },
          body: JSON.stringify({ ...body, operationId: original.operationId }),
        },
        true,
      );
      if (!acceptsStudioEpoch(epoch))
        throw new StudioClientError("WRITE_OUTCOME_UNKNOWN");
      const operation = "operation" in value ? value.operation : value;
      matches(operation, original);
      setReceipt(operation);
      if ("operation" in value) setMutation(value);
      setMessage(
        operation.status === "completed"
          ? "操作已完成。"
          : "操作未完成，请检查提示后再处理。",
      );
      return value;
    } catch (error) {
      setDefinite(
        error instanceof StudioClientError &&
          ((error.code === "RATE_LIMITED" && error.httpStatus === 429) ||
            [
              "ACCOUNT_CONFLICT",
              "LOGIN_NAME_TAKEN",
              "LAST_ACTIVE_ADMIN",
              "PASSWORD_POLICY_REJECTED",
              "PASSWORD_CONFIRMATION_FAILED",
              "INVALID_REQUEST",
            ].includes(error.code)),
      );
      setMessage(studioMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function resolve() {
    if (
      !pending ||
      locked.current ||
      authority?.revoked ||
      session.operator.id !== owner
    )
      return;
    const epoch = captureStudioEpoch();
    locked.current = true;
    setBusy(true);
    setMessage("正在核实上次操作，请稍候…");
    try {
      const result = await studioFetch<AccountOperationResultDto>(
        `/api/studio/accounts/operations/${encodeURIComponent(pending.operationId)}`,
        {},
      );
      if (!acceptsStudioEpoch(epoch)) return;
      if (result.status === "found") {
        matches(result.operation, pending);
        setReceipt(result.operation);
        setMessage("已核实原操作，请查看处理结果。");
      } else {
        if (
          result.status !== "unknown" ||
          result.operationId !== pending.operationId
        )
          throw Error();
        setMessage("结果待确认，请先核实，勿重复提交。");
      }
    } catch (error) {
      setMessage(studioMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  function finish() {
    if (busy || authority?.revoked || (!receipt && !definite)) return;
    try {
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) throw Error();
    } catch {
      setReady(false);
      setMessage("暂时无法结束本次记录，请保留此页并联系管理员。");
      return;
    }
    setPending(undefined);
    setReceipt(undefined);
    setMutation(undefined);
    setDefinite(false);
    setMessage("");
    return true;
  }
  return {
    ready,
    pending,
    busy,
    message,
    receipt,
    mutation,
    submit,
    resolve,
    finish,
    canFinish: Boolean(receipt || definite),
    blocked: Boolean(authority?.revoked) || !ready || busy || Boolean(pending),
  };
}
