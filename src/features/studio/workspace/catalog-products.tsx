import Link from "next/link";
import type { ProductDto } from "@/features/product/workspace/contracts";
import { ProductCard } from "./product-card";
import styles from "./workspace.module.css";

import { directoryTime } from "./directory-time";

export function CatalogProducts({ products }: { products: ProductDto[] }) {
  return (
    <>
      <table className={styles.catalogTable}>
        <caption className={styles.tableCaption}>
          测评目录 · 按创建时间从新到旧排列
        </caption>
        <thead>
          <tr>
            <th scope="col">测评名称</th>
            <th scope="col">分类与标签</th>
            <th scope="col">目录状态</th>
            <th scope="col">目录更新时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <th scope="row">
                <span className={styles.catalogTitle}>{product.title}</span>
                <span className={styles.catalogIdentity}>
                  编号：{product.id}
                  <br />
                  英文标识：{product.slug}
                </span>
              </th>
              <td>
                <p className={styles.categoryName}>
                  {product.primaryCategory
                    ? `${product.primaryCategory.name}${product.primaryCategory.archivedAt ? "（已归档）" : ""}`
                    : "未分类"}
                </p>
                <div className={styles.tagList}>
                  {product.tags.length ? (
                    product.tags.map((tag) => (
                      <span className={styles.tag} key={tag.id}>
                        {tag.name}
                        {tag.archivedAt ? "（已归档）" : ""}
                      </span>
                    ))
                  ) : (
                    <span className={styles.catalogIdentity}>暂无标签</span>
                  )}
                </div>
              </td>
              <td>
                <span
                  className={`${styles.badge} ${product.archivedAt ? styles.archived : styles.activeBadge}`}
                >
                  {product.archivedAt ? "已归档" : "未归档"}
                </span>
              </td>
              <td>
                <time dateTime={product.updatedAt}>
                  {directoryTime(product.updatedAt)}
                </time>
              </td>
              <td>
                <Link
                  className={`${styles.link} ${styles.secondary}`}
                  href={`/studio/products/${encodeURIComponent(product.id)}`}
                  aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
                >
                  查看测评<span aria-hidden="true"> →</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul
        className={`${styles.cards} ${styles.catalogMobile}`}
        aria-label="测评目录"
      >
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </>
  );
}
