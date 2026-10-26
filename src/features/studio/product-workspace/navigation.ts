import { productWorkspaceHref, type WorkspaceTask } from "./routes";
export type ProductWorkspaceTab = WorkspaceTask;
export function productWorkspaceTabs(productId: string) {
  return [
    {
      id: "content",
      label: "内容制作",
      href: productWorkspaceHref(productId, "content"),
    },
    {
      id: "preview",
      label: "体验预览",
      href: productWorkspaceHref(productId, "preview"),
    },
    {
      id: "review",
      label: "审核封存",
      href: productWorkspaceHref(productId, "review"),
    },
    {
      id: "testing",
      label: "内测发放",
      href: productWorkspaceHref(productId, "testing"),
    },
  ] as const;
}
/** Formal immutable object details belong to the same four tasks. Removed landing pages have no mapping. */
export function activeProductWorkspaceTab(
  pathname: string,
  productId: string,
): WorkspaceTask | null {
  const base = `/studio/products/${encodeURIComponent(productId)}/`;
  if (!pathname.startsWith(base)) return null;
  const path = pathname.slice(base.length).replace(/\/$/, "");
  if (/^drafts\/[^/]+\/revisions\/[^/]+\/preview$/.test(path)) return "preview";
  if (
    /^drafts\/[^/]+\/revisions\/[^/]+\/internal-review$/.test(path) ||
    /^internal-versions\/[^/]+$/.test(path)
  )
    return "review";
  if (
    /^imports\/[^/]+(?:\/validations\/[^/]+)?$/.test(path) ||
    /^drafts\/[^/]+\/revisions\/[^/]+$/.test(path)
  )
    return "content";
  return null;
}
