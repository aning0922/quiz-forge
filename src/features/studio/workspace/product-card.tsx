import { directoryTime } from "./directory-time";
import type { StudioRole } from "@/lib/auth/role-policy";
import Link from "next/link";
import type { ProductOperations } from "../operations/contracts";
import {
  productPresentation,
  productPrimaryAction,
} from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import type { ProductDto } from "@/features/product/workspace/contracts";
import { TechnicalDetails } from "../presentation/technical-details";
import styles from "./workspace.module.css";
import parity from "./catalog-parity.module.css";

/** Catalog callers always supply the live role; no route inference or default write role. */
export function catalogPrimaryAction(
  operations: ProductOperations,
  role: StudioRole,
) {
  return productPrimaryAction(operations, role);
}

/** The same current-value card is used by explicit reconciliation, never as a receipt. */
export function ProductCard({
  product,
  showIdentity = false,
  newTab = false,
  operations,
  role,
}: {
  product: ProductDto;
  showIdentity?: boolean;
  newTab?: boolean;
} & (
  | { operations: ProductOperations; role: StudioRole }
  | { operations?: never; role?: never }
)) {
  if (operations) {
    const facts = productPresentation(operations);
    const action = productPrimaryAction(operations, role);
    return (
      <article className={parity.mobileCard}>
        <div className={parity.mobileIdentity}>
          <div>
            <h2>
              <Link
                className={styles.catalogTitle}
                href={`/studio/products/${encodeURIComponent(product.id)}`}
                aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
              >
                {product.title}
              </Link>
            </h2>
            <p>
              {product.primaryCategory?.name ?? "未分类"} ·{" "}
              {facts.content.label}
              {product.archivedAt ? " · 已归档" : ""}
            </p>
          </div>
          <StatusBadge
            status={
              operations.content.draft.state === "present"
                ? facts.review
                : facts.content
            }
          />
        </div>
        <Link
          className={parity.mobileAction}
          href={action.href}
          title={action.reason}
        >
          {action.label} <span aria-hidden="true">→</span>
        </Link>
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
