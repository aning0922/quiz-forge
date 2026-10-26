"use client";
import type { ConsumerV2HostProps } from "@/lib/consumer-contract/v2/client-contract";
import { ConsumerExperienceV2 } from "./host";
import styles from "./consumer.module.css";

/** Parent supplies the real fixed-revision model and preview authority/events. No local scoring or HTTP. */
export function StudioStructurePreviewV2(props: ConsumerV2HostProps) {
  return (
    <section className={styles.preview} aria-label="固定修订结构预览">
      <header className={styles.banner}>
        <h2>固定修订结构预览</h2>
        <p>
          内部内容检查。预览答案与结果不构成正式消费者报告；不会生成 PNG
          或代替素材审核。
        </p>
      </header>
      <ConsumerExperienceV2 {...props} />
    </section>
  );
}
