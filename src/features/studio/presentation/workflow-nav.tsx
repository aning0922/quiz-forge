import Link from "next/link";
import styles from "./presentation.module.css";

export type StudioWorkflowStep =
  "product" | "imports" | "draft" | "preview" | "versions" | "keys";

/** Navigation only: the current step is not a business completion claim. */
export function StudioWorkflowNav({
  productId,
  current,
  previewHref,
}: {
  productId: string;
  current: StudioWorkflowStep;
  previewHref?: string;
}) {
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const items: ReadonlyArray<{
    id: StudioWorkflowStep;
    label: string;
    href: string;
  }> = [
    { id: "product", label: "商品概览", href: base },
    { id: "imports", label: "导入与验证", href: `${base}/imports` },
    { id: "draft", label: "草稿与修订", href: `${base}/draft` },
    {
      id: "preview",
      label: previewHref ? "固定修订预览" : "预览 · 先选修订",
      href: previewHref ?? `${base}/draft`,
    },
    { id: "versions", label: "审核与版本", href: `${base}/internal-versions` },
    { id: "keys", label: "答题版本与发码", href: `${base}/consumer-access` },
  ];
  return (
    <nav className={styles.workflow} aria-label="商品操作流程">
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <Link
              href={item.href}
              aria-current={current === item.id ? "page" : undefined}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
