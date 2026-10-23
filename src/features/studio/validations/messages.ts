import type { ValidationStatus } from "@/features/quizpack/validation/contracts";
import { StudioClientError, studioMessage } from "../client";
export const validationLabels: Record<ValidationStatus, string> = {
  validating: "正在检查内容 · 结果待确认",
  validated: "内容检查通过 · 素材待保存",
  archiving: "正在保存素材 · 结果待确认",
  ready: "检查通过 · 内容和素材已保存",
  rejected: "内容检查未通过",
  "retryable-failed": "本次未完成 · 请先核实状态",
};
export function validationMessage(error: unknown): string {
  if (
    error instanceof Error &&
    (error.message === "PENDING_STORAGE_UNAVAILABLE" ||
      error.message === "PENDING_REQUEST_EXISTS")
  )
    return "当前标签页的待核实记录不可读取或保存，或已有请求。操作结果需核实，请保留记录并读取服务器历史。";
  if (
    error instanceof Error &&
    error.message === "INVALID_NOT_STARTED_RESPONSE"
  )
    return "本次放弃证明已失效。原操作已保留，请按原记录读取核实。";
  const code =
    error instanceof StudioClientError ? error.code : "STUDIO_UNAVAILABLE";
  switch (code) {
    case "VALIDATION_REJECTED":
      return "内容包未通过内容或资源验证。请核实独立验证结果；本批不修改内容包。";
    case "PACK_IDENTITY_CONFLICT":
      return "包 ID 与版本和已有权威记录冲突，未授予归档结果。";
    case "RESOURCE_DECLARATION_CONFLICT":
      return "资源声明与已有版本冲突，未授予归档结果。";
    case "VALIDATION_STATE_CONFLICT":
    case "IMPORT_STATE_CONFLICT":
      return "服务器状态已变化。请读取最新状态，再明确选择恢复或重试。";
    case "VALIDATION_BUSY":
      return "此记录已有操作进行中。请先读取状态核实。";
    case "VALIDATION_IDENTITY_CHANGED":
      return "验证环境已变化。操作结果需核实，请保留原操作并读取服务器状态。";
    case "VALIDATION_REVALIDATION_REQUIRED":
      return "原验证环境无法用于归档重试；需要后续重新验证处理。";
    case "VALIDATION_ATTEMPT_LIMIT":
      return "此验证已达到尝试上限。";
    case "VALIDATION_PENDING_LIMIT":
      return "待核实记录达到限制，请先处理服务器历史。";
    case "VALIDATION_QUOTA_EXCEEDED":
      return "私有存储达到容量限制，请由维护者核实。";
    case "VALIDATION_SCAN_LIMIT":
    case "VALIDATION_STORAGE_CONFLICT":
    case "EVIDENCE_INVALID":
      return "存储或验证证据需要维护核实。本页不能假定资源已归档。";
    case "VALIDATION_RECOVERY_REQUIRED":
    case "VALIDATION_LOCK_LOST":
      return "操作需要显式恢复核实，请先读取服务器状态。";
    case "MEDIA_UNAVAILABLE":
      return "媒体验证环境暂不可用，请由维护者核实。";
    case "VALIDATION_TIMEOUT":
    case "VALIDATION_CANCELLED":
    case "WRITE_OUTCOME_UNKNOWN":
      return "这次操作的结果尚未确认。保留原操作，仅按原记录读取核实。";
    case "VALIDATION_NOT_FOUND":
    case "IMPORT_NOT_FOUND":
      return "服务器暂未找到此记录；这不证明未知请求已回滚。";
    case "IMPORTS_DISABLED":
      return "验证与归档已关闭；历史和待核实请求仍可读取。";
    default:
      return studioMessage(error);
  }
}
