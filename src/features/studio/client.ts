"use client";
import {
  captureStudioEpoch,
  acceptsStudioEpoch,
  invalidateCurrentStudioAuthority,
} from "./authority-events";

export class StudioClientError extends Error {
  constructor(
    readonly code: string,
    readonly currentRevision?: number,
    readonly httpStatus?: number,
  ) {
    super(code);
  }
}

export async function studioFetch<T>(
  path: string,
  options: RequestInit,
  uncertainWrite = false,
): Promise<T> {
  const epoch = captureStudioEpoch();
  const checkpoint = () => {
    if (!acceptsStudioEpoch(epoch))
      throw new StudioClientError(
        uncertainWrite ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_REQUEST_STALE",
      );
  };
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    checkpoint();
    throw new StudioClientError(
      uncertainWrite ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE",
    );
  }
  checkpoint();
  if (!response.ok) {
    let code = uncertainWrite ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE";
    let currentRevision: number | undefined;
    try {
      const value: unknown = await response.json();
      if (
        value &&
        typeof value === "object" &&
        "code" in value &&
        typeof value.code === "string"
      ) {
        code = value.code;
        if (
          (code === "METADATA_REVISION_CONFLICT" ||
            code === "TAXONOMY_REVISION_CONFLICT") &&
          "currentRevision" in value &&
          typeof value.currentRevision === "number" &&
          Number.isInteger(value.currentRevision) &&
          value.currentRevision >= 1 &&
          value.currentRevision <= 2147483647
        )
          currentRevision = value.currentRevision;
      }
    } catch {
      /* The user sees a stable message, never a response body or exception. */
    }
    checkpoint();
    if (
      [
        "UNAUTHENTICATED",
        "CAPABILITY_DENIED",
        "CSRF_REJECTED",
        "ORIGIN_REJECTED",
      ].includes(code)
    )
      invalidateCurrentStudioAuthority();
    throw new StudioClientError(code, currentRevision, response.status);
  }
  let value: T;
  try {
    value =
      response.status === 204
        ? (undefined as T)
        : ((await response.json()) as T);
  } catch {
    checkpoint();
    throw new StudioClientError(
      uncertainWrite ? "WRITE_OUTCOME_UNKNOWN" : "STUDIO_UNAVAILABLE",
    );
  }
  checkpoint();
  return value;
}

export function studioMessage(error: unknown): string {
  const code =
    error instanceof StudioClientError ? error.code : "STUDIO_UNAVAILABLE";
  switch (code) {
    case "AUTHENTICATION_FAILED":
      return "登录未成功。请检查账号与密码，或重新准备登录验证。";
    case "UNAUTHENTICATED":
      return "会话已失效，请重新登录。";
    case "RATE_LIMITED":
      return "请求过于频繁，请至少等待 60 秒后再试。";
    case "CSRF_REJECTED":
      return "登录验证已失效，请重新准备登录验证。";
    case "ORIGIN_REJECTED":
      return "当前访问地址不符合本地运营环境配置。";
    case "INVALID_REQUEST":
      return "请求格式无效，请检查字段与筛选条件。";
    case "CAPABILITY_DENIED":
      return "当前身份没有执行此操作的权限，原输入与原操作仍保留。";
    case "ACCOUNT_CONFLICT":
      return "账号信息已变化，请重新读取并保留原操作核对。";
    case "LOGIN_NAME_TAKEN":
      return "登录账号已被使用，停用账号仍保留该名称。";
    case "LAST_ACTIVE_ADMIN":
      return "不能停用或降权最后一名可登录管理员。待设置密码的管理员不算替代者。";
    case "PASSWORD_POLICY_REJECTED":
      return "密码未符合策略。请使用15–256字符长口令，避开常见弱口令。";
    case "PASSWORD_CONFIRMATION_FAILED":
      return "当前密码核对未成功。";
    case "PASSWORD_TOKEN_INVALID":
      return "一次性入口无效、已用、被撤销或已到期；未知原操作仍须单独核实。";
    case "OPERATION_BINDING_CONFLICT":
      return "原操作编号与请求不匹配，请保留原记录，不要换号重试。";
    case "PRODUCT_NOT_FOUND":
    case "TAXONOMY_NOT_FOUND":
      return "服务器上没有找到此记录。";
    case "PRODUCT_ID_CONFLICT":
      return "此稳定 ID 已被使用，归档记录也会保留 ID。";
    case "SLUG_CONFLICT":
      return "此 slug 已被使用，请核实已有记录或换一个 slug。";
    case "METADATA_REVISION_CONFLICT":
    case "TAXONOMY_REVISION_CONFLICT":
      return "服务器内容已变化。未保存输入已保留，请读取最新内容后明确选择是否重提。";
    case "PRODUCT_ARCHIVED":
    case "TAXONOMY_ARCHIVED":
      return "记录已归档。请先恢复；归档目录不能作为新增关联。";
    case "TAG_LIMIT_EXCEEDED":
      return "每个工作区最多关联 8 个标签。";
    case "REVISION_LIMIT":
      return "记录已达到修订上限，本次没有修改。";
    case "WRITE_BUSY":
      return "写入等待超时，本次已回滚。请稍后手动重试。";
    case "WRITE_OUTCOME_UNKNOWN":
      return "提交结果尚未确认。请先读取服务器状态核实，不要直接重复提交。";
    default:
      return "Studio 暂不可用，请由本机维护者检查配置与数据库。";
  }
}
