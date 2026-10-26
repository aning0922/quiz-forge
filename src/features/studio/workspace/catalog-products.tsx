import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { StudioRole } from "@/lib/auth/role-policy";
import type { ProductOperations } from "../operations/contracts";
import { productPresentation } from "../operations-ui/presentation";
import { StatusBadge } from "../operations-ui/status-badge";
import { ProductCard, catalogPrimaryAction } from "./product-card";
import styles from "./workspace.module.css";
import parity from "./catalog-parity.module.css";

export function CatalogProducts({
  products,
  role,
}: {
  products: ProductOperations[];
  role: StudioRole;
}) {
  return (
    <>
      <table className={`${styles.catalogTable} ${parity.table}`}>
        <caption className={styles.tableCaption}>
          测评目录 · 按创建时间从新到旧排列
        </caption>
        <thead>
          <tr>
            <th scope="col">测评</th>
            <th scope="col">分类</th>
            <th scope="col">当前内容</th>
            <th scope="col">审核状态</th>
            <th scope="col">内测情况</th>
            <th scope="col">下一步</th>
          </tr>
        </thead>
        <tbody>
          {products.map((operations) => {
            const product = operations.directory;
            const facts = productPresentation(operations);
            const action = catalogPrimaryAction(operations, role);
            return (
              <tr key={product.id}>
                <th scope="row">
                  <div className={parity.productIdentity}>
                    <span className={parity.productIcon}>
                      <BookOpen size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <Link
                        className={styles.catalogTitle}
                        href={`/studio/products/${encodeURIComponent(product.id)}`}
                        aria-label={`查看测评 ${product.title}（编号 ${product.id}）`}
                      >
                        {product.title}
                      </Link>
                      <span className={parity.identifier}>
                        {product.slug}
                        {product.archivedAt ? " · 已归档" : ""}
                      </span>
                    </div>
                  </div>
                </th>
                <td>
                  <span className={parity.category}>
                    {product.primaryCategory
                      ? `${product.primaryCategory.name}${product.primaryCategory.archivedAt ? "（分类已归档）" : ""}`
                      : "未分类"}
                  </span>
                </td>
                <td>
                  <div className={parity.contentState}>
                    <StatusBadge status={facts.content} />
                  </div>
                </td>
                <td>
                  <StatusBadge status={facts.review} />
                </td>
                <td>
                  <span title={facts.historicalNote ?? undefined}>
                    <StatusBadge status={facts.testing} />
                  </span>
                </td>

                <td>
                  <Link
                    className={styles.catalogAction}
                    href={action.href}
                    title={action.reason}
                    aria-label={`${action.label} ${product.title}`}
                  >
                    {action.label}
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
              role={role}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
