import type { StudioRole } from "@/lib/auth/role-policy";
import type { StudioOperatorDto } from "../contracts";
export const roleLabel = (role: StudioRole) =>
  ({ admin: "管理员", operator: "运营者", "read-only": "只读" })[role];
export const operatorName = (operator: StudioOperatorDto) =>
  operator.displayName ?? operator.label;
export function passwordProblem(value: string): string | null {
  if (!value.isWellFormed()) return "密码包含无效字符，请重新输入。";
  const normalized = value.normalize("NFC"),
    length = [...normalized].length;
  if (
    length < 15 ||
    length > 256 ||
    new TextEncoder().encode(normalized).byteLength > 1024
  )
    return "请使用 15–256 个字符的长口令（最多 1024 字节），空格可保留。";
  return null;
}

export const accountActionLabel = (
  action: import("./contracts").AccountAction,
) =>
  ({
    create: "开通账号",
    "display-name": "修改显示名",
    role: "调整角色",
    disable: "停用账号",
    restore: "恢复账号",
    "issue-setup": "签发设置入口",
    "issue-reset": "签发重置入口",
    "password-setup": "本人设置密码",
    "password-change": "本人修改密码",
    "logout-all": "本人退出全部登录",
    "revoke-sessions": "撤销账号全部登录",
    "bootstrap-admin": "初始化管理员",
    enroll: "登记旧账号",
    "admin-recovery": "恢复管理员",
  })[action];
