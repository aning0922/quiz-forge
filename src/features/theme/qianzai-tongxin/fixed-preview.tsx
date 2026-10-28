"use client";
import type { StudioStructurePreviewV2Props } from "../consumer-v2/studio-structure-preview";
import { StructuredReportContentV2 } from "../consumer-v2/components";

/** A fixed authored display preview is not a consumer session or a persisted report receipt.
 * Private art is shown only by the actual authorized consumer resource runtime.
 * The current-draft Studio preview continues to use its structured-only implementation. */
export function QianzaiFixedPreview({
  entry,
  result,
  message,
}: StudioStructurePreviewV2Props) {
  const display = result ?? entry;
  if (!display || display.presentationMode !== "authored-product")
    return <p role="status">固定版本内容尚未就绪。</p>;
  return (
    <section aria-label="千载同心固定版本内容核对">
      <p>固定版本只读内容核对；完整图层和交互请使用对应的授权消费者体验。</p>
      {message && <p role="status">{message}</p>}
      {result ? (
        <StructuredReportContentV2 body={result.body} />
      ) : (
        <>
          <h2>{entry!.product.title}</h2>
          <p>
            人物偏好场景：
            {entry!.slots.preferenceScene ? "已绑定" : "缺少独立场景"}
          </p>
          <p>共 {entry!.questions.length} 道题目。</p>
        </>
      )}
    </section>
  );
}
