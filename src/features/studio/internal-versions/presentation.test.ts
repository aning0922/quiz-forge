import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StudioSessionDto } from "../contracts";
import { summary } from "../drafts/fixtures.test-support";
import { binding, fixture, sha, uuid } from "./fixtures.test-support";
import { ReviewFacts, VersionMetadataFacts } from "./facts";
import { InternalEvidenceFacts } from "./pending-panel";
import {
  InternalReviewPage,
  InternalVersionDetailPage,
  InternalVersionsPage,
} from "./pages";
import { ProductDetail } from "../workspace/product-detail";
import { internalVersionsPageUrl, internalVersionPageUrl } from "./paths";
const reads = vi.hoisted(() => ({
  error: "synthetic unavailable",
  draft: undefined as unknown,
}));
vi.mock("./use-read", () => ({
  useInternalRead: (path: string) => ({
    value: path.endsWith("/draft") ? reads.draft : undefined,
    loading: false,
    error: reads.error,
    refresh: () => {},
  }),
}));
vi.mock("../drafts/use-read", () => ({
  useDraftRead: () => ({
    value: undefined,
    loading: false,
    error: reads.error,
    refresh: () => {},
  }),
}));
vi.mock("../workspace/use-request", () => ({
  useWorkspaceRead: () => ({
    value: undefined,
    loading: false,
    error: reads.error,
    refresh: () => {},
  }),
}));
const session: StudioSessionDto = {
  operator: { id: uuid(4), label: "Synthetic read-only", role: "read-only" },
  csrfToken: "synthetic-not-a-session-token",
  idleExpiresAt: "2026-10-18T00:00:00.000Z",
  absoluteExpiresAt: "2026-10-18T00:00:00.000Z",
};
describe("internal metadata and recovery presentation, server markup only", () => {
  it("keeps Product recovery mounted after Product detail GET error", () => {
    const html = renderToStaticMarkup(
      createElement(ProductDetail, { productId: binding.productId, session }),
    );
    expect(html).toContain("测评信息暂未读取");
    expect(html).toContain('aria-label="审核依据记录操作查询"');
    expect(html).toContain('aria-label="内容版本固定操作查询"');
    expect(html.match(/<details open=""/g)).toHaveLength(2);
    expect(html).toContain(
      "正在检查上次操作，请稍候；检查完成前不能继续提交。",
    );
    expect(html).not.toContain("暂无待处理操作");
    expect(html).toContain(internalVersionsPageUrl(binding.productId));
  });
  it("keeps both original operations mounted after each review/list/detail GET error", () => {
    const pages = [
      createElement(InternalReviewPage, {
        scope: {
          productId: binding.productId,
          draftId: binding.target.draftId,
          revision: binding.target.revision,
        },
        session,
      }),
      createElement(InternalVersionsPage, {
        productId: binding.productId,
        session,
      }),
      createElement(InternalVersionDetailPage, {
        productId: binding.productId,
        versionId: uuid(8),
        session,
      }),
    ];
    for (const page of pages) {
      const html = renderToStaticMarkup(page);
      expect(html).toContain(reads.error);
      expect(html).toContain('aria-label="审核依据记录操作查询"');
      expect(html).toContain('aria-label="内容版本固定操作查询"');
      expect(html).not.toContain("确认并发送此固定请求");
      expect(html).toContain("不授予对外发布资格");
    }
  });
  it("renders a loaded full DraftSummaryDto by projecting only the strict revision link scope", () => {
    reads.draft = {
      kind: "draft",
      draft: { ...summary, productId: binding.productId },
    };
    try {
      const html = renderToStaticMarkup(
        createElement(InternalVersionsPage, {
          productId: binding.productId,
          session,
        }),
      );
      expect(html).toContain(
        `/studio/products/${binding.productId}/drafts/${summary.draftId}/revisions/${summary.revision}/internal-review`,
      );
      expect(html).toContain('aria-label="审核依据记录操作查询"');
      expect(html).toContain('aria-label="内容版本固定操作查询"');
    } finally {
      reads.draft = undefined;
    }
  });
  it("synthetic evidence never acquires author approval or an approval date", async () => {
    const { review } = await fixture(),
      html = renderToStaticMarkup(createElement(ReviewFacts, { review }));
    expect(html).toContain("合成测试证据（非作者批准）");
    expect(html).toContain("不适用：合成测试不表示作者批准");
    expect(html).toContain("运营记录人 / 时间");
    expect(html).toContain(review.recordedBy);
    expect(html).toContain(review.facts.approval.evidenceSha256);
    expect(html).not.toContain("作者既有内测基线批准");
  });
  it("existing author source/date remains separate from operational recording identity/time", async () => {
    const { review } = await fixture();
    review.facts.approval = {
      kind: "author-baseline",
      sourceRecordId: "original-review-record",
      approvedOn: "2026-10-17",
      evidenceSha256: sha(),
      scope: "internal-test-content-and-visual-baseline",
    };
    const html = renderToStaticMarkup(createElement(ReviewFacts, { review }));
    expect(html).toContain("作者既有内测基线批准");
    expect(html).toContain("original-review-record");
    expect(html).toContain("2026-10-17");
    expect(html).toContain(review.recordedAt);
    expect(html).toContain("不授予对外发布资格");
  });
  it("other-key target-used review and seal evidence never becomes this request's success", async () => {
    const f = await fixture();
    let html = renderToStaticMarkup(
      createElement(InternalEvidenceFacts, {
        evidence: {
          operation: "review",
          value: {
            kind: "not-recorded-target-used",
            binding: { ...binding, idempotencyKey: uuid(99) },
            fingerprint: sha(),
            observedCurrentRevision: 2,
            consumed: f.review,
          },
        },
      }),
    );
    expect(html).toContain("其他操作的处理结果，不表示本次操作成功");
    expect(html).not.toContain("原操作已记录");
    html = renderToStaticMarkup(
      createElement(InternalEvidenceFacts, {
        evidence: {
          operation: "seal",
          value: {
            kind: "not-sealed-target-used",
            binding: { ...f.seal, idempotencyKey: uuid(99) },
            fingerprint: sha(),
            observedCurrentRevision: 2,
            consumed: f.version,
            snapshotSha256: f.version.snapshotSha256,
          },
        },
      }),
    );
    expect(html).toContain("其他操作创建的版本，不表示本次操作成功");
    expect(html).not.toContain("原操作已封存");
  });
  it("unresolved and capacity evidence explain anchor/capacity without rollback or publication authority", async () => {
    const f = await fixture();
    const unresolved = renderToStaticMarkup(
      createElement(InternalEvidenceFacts, {
        evidence: {
          operation: "review",
          value: {
            kind: "unresolved",
            binding,
            fingerprint: sha(),
            observedCurrentRevision: 2,
          },
        },
      }),
    );
    expect(unresolved).toContain("未找到处理结果不能证明原操作未执行");
    const full = renderToStaticMarkup(
      createElement(InternalEvidenceFacts, {
        evidence: {
          operation: "seal",
          value: {
            kind: "not-sealed-capacity-exhausted",
            binding: f.seal,
            fingerprint: sha(),
            observedCurrentRevision: 2,
            limit: 100,
            occupiedCount: 100,
          },
        },
      }),
    );
    expect(full).toContain("解除本地操作记录不会恢复封存容量");
  });
  it("historical metadata uses its fixed version link and distinguishes unknown/current/newer head", async () => {
    const f = await fixture(),
      { snapshot, version } = f,
      metadata = {
        id: version.id,
        productId: binding.productId,
        slot: version.slot,
        target: snapshot.target,
        reviewId: snapshot.reviewId,
        reviewSha256: snapshot.reviewSha256,
        snapshotSha256: version.snapshotSha256,
        renderer: snapshot.renderer,
        rendererCapability: snapshot.rendererCapability,
        engine: snapshot.engine,
        purpose: version.purpose,
        publicationApproved: version.publicationApproved,
        createdAt: version.createdAt,
        createdBy: version.createdBy,
      };
    for (const [currentRevision, label] of [
      [undefined, "当前 head 尚未可靠读取"],
      [2, "本次读取的当前修订"],
      [3, "历史修订的固定内测版本"],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(VersionMetadataFacts, {
          version: metadata,
          currentRevision,
        }),
      );
      expect(html).toContain(label);
      expect(html).toContain(
        internalVersionPageUrl(binding.productId, version.id),
      );
      expect(html).toContain("对外发布批准：未授予");
      expect(html).toContain("仅 Studio 内部预览");
    }
  });
});
