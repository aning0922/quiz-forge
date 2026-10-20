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
      <h2>消费者内测</h2>
      <p>固定消费者体验版本、发放访问 Key，并核对本标签保留的原请求。</p>
      <Link
        className={styles.link}
        href={`/studio/products/${parsed.data}/consumer-access`}
      >
        消费者内测与访问 Key
      </Link>
    </section>
  );
}
