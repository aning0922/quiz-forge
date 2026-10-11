import { StudioClientError, studioMessage } from "../client";

const messages: Record<string, string> = {
  IMPORTS_DISABLED:
    "本机原包接收已关闭。历史状态仍可读取，请由维护者通过管理 CLI 启用。",
  IDEMPOTENCY_CONFLICT:
    "此请求标识已对应另一组原包声明。请核实原意图，不能修改原输入重提。",
  IMPORT_STATE_CONFLICT: "原包状态已变化。请读取最新状态后再明确操作。",
  IMPORT_INTENT_LIMIT: "此工作区未完成的意图已达到上限，请先处理已有记录。",
  IMPORT_NOT_FOUND: "当前工作区没有找到此接收记录。",
  RECEIVE_BUSY: "当前有接收或配置操作占用存储，请稍后手动操作。",
  RECEIVE_QUOTA_EXCEEDED:
    "受管存储的接收预算不足，请由维护者核实已有原包与保留账目。",
  RECEIVE_ATTEMPT_LIMIT: "此意图已达到三次接收尝试上限，不能继续上传。",
  RECEIVE_RECOVERY_REQUIRED:
    "此记录需要显式恢复。服务器必须先确认旧接收已停止，才能处理保留文件与账目。",
  RECEIVE_STORAGE_CONFLICT:
    "受管存储存在冲突，需要维护者核实；请保留当前记录。",
  RECEIVE_SCAN_LIMIT:
    "受管存储扫描达到限制，需要维护者处理；本次没有继续接收。",
  RECEIVE_TIMEOUT:
    "接收请求已达到时间预算。请先读取服务器状态，不要直接重复上传。",
  RECEIVE_LENGTH_MISMATCH: "实际字节数与原意图声明不一致，请读取拒绝状态。",
  RECEIVE_HASH_MISMATCH: "实际 SHA-256 与原意图声明不一致，请读取拒绝状态。",
  RECEIVE_LOCK_LOST: "存储连接已失效。请读取最新状态，并按需显式恢复。",
  PAYLOAD_TOO_LARGE: "原包或请求超出大小限制。原包必须为 1 字节到 32MiB。",
};

export function importMessage(error: unknown): string {
  const message =
    error instanceof StudioClientError ? messages[error.code] : undefined;
  return message ?? studioMessage(error);
}

export function isUnknownWrite(error: unknown): boolean {
  return (
    error instanceof StudioClientError && error.code === "WRITE_OUTCOME_UNKNOWN"
  );
}
