import Link from "next/link";
import { consumerIdSchema } from "@/lib/consumer-contract/v1/primitives";
import styles from "../workspace/workspace.module.css";
/** A route composition entry, independent from preview/review components and their frozen bytes. */
export function StudioConsumerWorkspaceLink({
  productId,
}: {
  productId: string;
}) {
  const parsed = consumerIdSchema.safeParse(productId);
  if (!parsed.success) return null;
  return (
    <section className={styles.panel}>
      <h2>答题版本与访问码</h2>
      <p>
        从固定内测内容版本创建答题版本，再发放访问码；上次操作未确认时先查询处理结果。
      </p>
      <Link
        className={styles.link}
        href={`/studio/products/${parsed.data}?task=testing`}
      >
        答题版本与访问码
      </Link>
    </section>
  );
}
