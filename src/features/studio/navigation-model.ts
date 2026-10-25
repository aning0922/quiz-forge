import type { StudioRole } from "@/lib/auth/role-policy";
export const STUDIO_SECTIONS = [
  { id: "dashboard", href: "/studio", label: "工作台" },
  { id: "products", href: "/studio/products", label: "测评管理" },
  { id: "testing", href: "/studio/testing", label: "内测运营" },
  { id: "settings", href: "/studio/settings", label: "系统设置" },
] as const;
export type StudioIdentity = { label: string; role: StudioRole };

/** Page location only, never a business stage or permission grant. */
export function studioLocation(pathname: string) {
  if (pathname === "/studio") return { section: "dashboard", title: "工作台" };
  if (pathname === "/studio/session")
    return { section: "settings", title: "我的账号" };
  if (pathname === "/studio/accounts/audit")
    return { section: "settings", title: "账号操作记录" };
  if (pathname === "/studio/accounts")
    return { section: "settings", title: "账号与权限" };
  if (pathname === "/studio/set-password")
    return { section: "settings", title: "本人设置密码" };
  if (pathname === "/studio/taxonomy")
    return { section: "settings", title: "分类与标签" };
  if (pathname === "/studio/settings")
    return { section: "settings", title: "系统设置" };
  if (pathname === "/studio/testing")
    return { section: "testing", title: "内测运营" };
  if (pathname === "/studio/new-product")
    return { section: "products", title: "新建测评" };
  if (pathname === "/studio/products")
    return { section: "products", title: "测评管理" };
  if (pathname.startsWith("/studio/products/"))
    return { section: "products", title: "测评工作区" };
  return { section: null, title: "运营后台" };
}
