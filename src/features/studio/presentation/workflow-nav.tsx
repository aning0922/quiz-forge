"use client";

import Link from "next/link";
import { useProductWorkspaceContext } from "../product-workspace/context";
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
  const workspace = useProductWorkspaceContext();
  if (workspace?.productId === productId) return null;
  const base = `/studio/products/${encodeURIComponent(productId)}`;
  const items: ReadonlyArray<{
    id: StudioWorkflowStep;
    label: string;
    href: string;
  }> = [
    { id: "product", label: "测评概览", href: base },
    { id: "imports", label: "导入与验证", href: `${base}/imports` },
    { id: "draft", label: "草稿与修订", href: `${base}/draft` },
    {
      id: "preview",
      label: previewHref ? "预览当前内容" : "预览 · 先选内容",
      href: previewHref ?? `${base}/draft`,
    },
    { id: "versions", label: "审核与版本", href: `${base}/internal-versions` },
    { id: "keys", label: "答题与访问码", href: `${base}/consumer-access` },
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
              <span className={styles.stepNumber} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.stepLabel}>{item.label}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
