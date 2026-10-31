import { qianzaiExportFixture } from "./export.test-support";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_V11_CONTENT_SHA256,
} from "./role-profiles-v11";
import type { QianzaiPresentationBinding } from "./result-presentation";
/** Isolated synthetic context only. Placeholder hashes are not persisted/verified report evidence. */
export async function qianzaiPresentationFixture() {
  const f = await qianzaiExportFixture(),
    view = f.model.report!.view,
    d = view.display,
    body = d.body;
  view.renderer = {
    kind: "consumer-renderer",
    id: "consumer-qianzai-tongxin",
    version: "1.2.0",
    entrySha256: "e".repeat(64),
  };
  d.canonicalContentSha256 = QIANZAI_V11_CONTENT_SHA256;
  body.provenance.canonicalContentSha256 = d.canonicalContentSha256;
  d.inputHash = body.provenance.inputHash = "1".repeat(64);
  d.answersHash = body.provenance.answersHash = "2".repeat(64);
  d.matchingContextSha256 = body.provenance.matchingContextSha256 = "3".repeat(
    64,
  );
  d.bodySha256 = "4".repeat(64);
  d.selectedResultRef = body.matching.selected.ref = {
    productId: "qianzai-tongxin",
    id: "li-bai",
    version: "1.0.0",
  };
  body.matching.selected.label = "李白";
  const labels = ["守心", "寻远", "知情", "决断", "应变"];
  body.dimensions.forEach((dim, i) => {
    dim.dimensionRef = {
      productId: "qianzai-tongxin",
      id: `axis-${i + 1}`,
      version: "1.0.0",
    };
    dim.label = labels[i]!;
  });
  const binding: QianzaiPresentationBinding = {
    renderer: { ...view.renderer },
    profileVersion: QIANZAI_PRESENTATION_V11,
  };
  return { ...f, view, binding };
}
