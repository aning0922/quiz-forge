export type ProductWorkspaceTab =
  "overview" | "content" | "preview" | "versions" | "testing" | "settings";

export function productWorkspaceTabs(productId: string) {
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  return [
    { id: "overview", label: "概览", href: base },
    { id: "content", label: "内容与素材", href: `${base}/content` },
    { id: "preview", label: "体验预览", href: `${base}/preview` },
    { id: "versions", label: "审核与版本", href: `${base}/internal-versions` },
    { id: "testing", label: "内测记录", href: `${base}/consumer-access` },
    { id: "settings", label: "基本设置", href: `${base}/settings` },
  ] as const;
}

/** Old immutable deep links keep their route, classified into their business tab. */
export function activeProductWorkspaceTab(
  pathname: string,
  productId: string,
): ProductWorkspaceTab | null {
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  if (pathname === base || pathname === `${base}/`) return "overview";
  if (!pathname.startsWith(`${base}/`)) return null;
  const relative = pathname.slice(base.length + 1).replace(/\/$/, "");
  if (relative === "settings") return "settings";
  if (
    relative === "preview" ||
    /^drafts\/[^/]+\/revisions\/[^/]+\/preview$/.test(relative)
  )
    return "preview";
  if (
    relative === "internal-versions" ||
    relative.startsWith("internal-versions/") ||
    /^drafts\/[^/]+\/revisions\/[^/]+\/internal-review$/.test(relative)
  )
    return "versions";
  if (relative === "consumer-access" || relative.startsWith("consumer-access/"))
    return "testing";
  if (
    relative === "content" ||
    relative === "draft" ||
    relative === "imports" ||
    relative.startsWith("imports/") ||
    /^drafts\/[^/]+\/revisions\/[^/]+$/.test(relative)
  )
    return "content";
  return null;
}
