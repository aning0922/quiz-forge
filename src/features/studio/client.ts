"use client";

export class StudioClientError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export async function studioFetch<T>(
  path: string,
  options: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new StudioClientError("STUDIO_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "STUDIO_UNAVAILABLE";
    try {
      const value: unknown = await response.json();
      if (
        value &&
        typeof value === "object" &&
        "code" in value &&
        typeof value.code === "string"
      )
        code = value.code;
    } catch {
      /* The user sees a stable message, never a response body or exception. */
    }
    throw new StudioClientError(code);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export function studioMessage(error: unknown): string {
  const code =
    error instanceof StudioClientError ? error.code : "STUDIO_UNAVAILABLE";
  switch (code) {
    case "AUTHENTICATION_FAILED":
      return "登录未成功。请检查运营凭证，或重新准备登录验证。";
    case "UNAUTHENTICATED":
      return "会话已失效，请重新登录。";
    case "RATE_LIMITED":
      return "请求过于频繁，请至少等待 60 秒后再试。";
    case "CSRF_REJECTED":
      return "登录验证已失效，请重新准备登录验证。";
    case "ORIGIN_REJECTED":
      return "当前访问地址不符合本地运营环境配置。";
    case "INVALID_REQUEST":
      return "请求格式无效，请重新准备登录验证。";
    default:
      return "Studio 暂不可用，请由本机维护者检查配置与数据库。";
  }
}
