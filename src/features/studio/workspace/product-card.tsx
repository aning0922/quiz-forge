import Link from "next/link";
import type { ProductDto } from "@/features/product/workspace/contracts";
import { TechnicalDetails } from "../presentation/technical-details";
import styles from "./workspace.module.css";

/** The same current-value card is used by explicit reconciliation, never as a receipt. */
export function ProductCard({
  product,
  showIdentity = false,
}: {
  product: ProductDto;
  showIdentity?: boolean;
}) {
  return (
    <article className={`${styles.card} ${styles.productCard}`}>
      <div className={styles.productCardBody}>
        <div className={styles.productCardHeading}>
          <h2>{product.title}</h2>
          <span
            className={`${styles.badge} ${product.archivedAt ? styles.archived : ""}`}
          >
            {product.archivedAt ? "已归档" : "未归档"}
          </span>
        </div>
        <p className={styles.note}>
          {product.primaryCategory
            ? `${product.primaryCategory.name}${product.primaryCategory.archivedAt ? " · 分类已归档" : ""}`
            : "未分类"}
          {` · ${product.tags.length} 个标签`}
        </p>
        {showIdentity && (
          <p>
            测评编号：{product.id} · 信息版本：{product.metadataRevision}
          </p>
        )}
        <TechnicalDetails label="编号与标签详情">
          <p>测评编号：{product.id}</p>
          <p>英文标识：{product.slug}</p>
          <p>
            标签：
            {product.tags.length
              ? product.tags
                  .map(
                    (tag) =>
                      `${tag.name} · ${tag.slug}${tag.archivedAt ? " · 已归档" : ""}`,
                  )
                  .join("；")
              : "无"}
          </p>
        </TechnicalDetails>
      </div>
      <Link
        className={`${styles.link} ${styles.secondary}`}
        href={`/studio/products/${encodeURIComponent(product.id)}`}
        aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
      >
        查看测评<span aria-hidden="true"> →</span>
      </Link>
    </article>
  );
}
