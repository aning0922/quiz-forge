import Link from "next/link";
import type { ProductOperations } from "../operations/contracts";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { ProductCard } from "./product-card";
import { directoryTime } from "./directory-time";
import styles from "./workspace.module.css";

export function CatalogProducts({
  products,
}: {
  products: ProductOperations[];
}) {
  return (
    <>
      <table className={styles.catalogTable}>
        <caption className={styles.tableCaption}>
          测评目录 · 按创建时间从新到旧排列
        </caption>
        <thead>
          <tr>
            <th scope="col">测评名称 / 分类</th>
            <th scope="col">当前内容与审核</th>
            <th scope="col">内测状态</th>
            <th scope="col">目录更新时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          {products.map((operations) => {
            const product = operations.directory;
            const facts = productPresentation(operations);
            return (
              <tr key={product.id}>
                <th scope="row">
                  <Link
                    className={styles.catalogTitle}
                    href={`/studio/products/${encodeURIComponent(product.id)}`}
                    aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
                  >
                    {product.title}
                  </Link>
                  <span className={styles.catalogCategory}>
                    {product.primaryCategory
                      ? `${product.primaryCategory.name}${product.primaryCategory.archivedAt ? "（分类已归档）" : ""}`
                      : "未分类"}
                    {product.archivedAt ? " · 已归档" : ""}
                  </span>
                </th>
                <td>
                  <div className={styles.catalogStates}>
                    <StatusBadge status={facts.content} />
                    <StatusBadge status={facts.review} />
                  </div>
                </td>
                <td>
                  <span title={facts.historicalNote ?? undefined}>
                    <StatusBadge status={facts.testing} />
                  </span>
                </td>
                <td>
                  <time dateTime={product.updatedAt}>
                    {directoryTime(product.updatedAt)}
                  </time>
                </td>
                <td>
                  <Link
                    className={styles.catalogAction}
                    href={`/studio/products/${encodeURIComponent(product.id)}`}
                    aria-label={`进入工作区 ${product.title}`}
                  >
                    进入工作区
                    <span aria-hidden="true"> →</span>
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul
        className={`${styles.cards} ${styles.catalogMobile}`}
        aria-label="测评目录"
      >
        {products.map((operations) => (
          <li key={operations.directory.id}>
            <ProductCard
              product={operations.directory}
              operations={operations}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
