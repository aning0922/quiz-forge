import Link from "next/link";
import type { ProductOperations } from "../operations/contracts";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import type { ProductDto } from "@/features/product/workspace/contracts";
import { directoryTime } from "./directory-time";
import { TechnicalDetails } from "../presentation/technical-details";
import styles from "./workspace.module.css";

/** The same current-value card is used by explicit reconciliation, never as a receipt. */
export function ProductCard({
  product,
  showIdentity = false,
  newTab = false,
  operations,
}: {
  product: ProductDto;
  showIdentity?: boolean;
  newTab?: boolean;
  operations?: ProductOperations;
}) {
  if (operations) {
    const facts = productPresentation(operations);
    return (
      <article className={styles.catalogCard}>
        <h2>
          <Link
            className={styles.catalogTitle}
            href={`/studio/products/${encodeURIComponent(product.id)}`}
            aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
          >
            {product.title}
          </Link>
        </h2>
        <p className={styles.catalogCategory}>
          {product.primaryCategory
            ? `${product.primaryCategory.name}${product.primaryCategory.archivedAt ? "（分类已归档）" : ""}`
            : "未分类"}
          {product.archivedAt ? " · 已归档" : ""}
        </p>
        <div className={styles.catalogStates}>
          <StatusBadge status={facts.content} />
          <StatusBadge status={facts.review} />
          <StatusBadge status={facts.testing} />
        </div>
        <div className={styles.catalogCardFooter}>
          <p>
            目录更新{" "}
            <time dateTime={product.updatedAt}>
              {directoryTime(product.updatedAt)}
            </time>
          </p>
          <Link
            className={styles.catalogAction}
            href={facts.primary.href}
            title={facts.primary.reason}
            aria-label={`${facts.primary.label} ${product.title}`}
          >
            {facts.primary.label}
            <span aria-hidden="true"> →</span>
          </Link>
        </div>
      </article>
    );
  }
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
        {product.tags.length > 0 && (
          <div className={styles.tagList}>
            {product.tags.map((tag) => (
              <span key={tag.id} className={styles.tag}>
                {tag.name}
                {tag.archivedAt ? "（已归档）" : ""}
              </span>
            ))}
          </div>
        )}
        <p className={styles.note}>
          目录更新：
          <time dateTime={product.updatedAt}>
            {directoryTime(product.updatedAt)}
          </time>
        </p>
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
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
        aria-label={`${newTab ? "在新标签查看服务器记录" : "查看测评"} ${product.title}（编号 ${product.id}）`}
      >
        {newTab ? "在新标签查看服务器记录" : "查看测评"}
        <span aria-hidden="true"> →</span>
      </Link>
    </article>
  );
}
