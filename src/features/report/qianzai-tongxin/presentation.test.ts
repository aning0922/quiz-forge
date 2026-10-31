import { describe, expect, it } from "vitest";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import {
  qianzaiSnapshotDocument,
  type QianzaiReportPresentation,
} from "./presentation";

describe("Qianzai snapshot presentation", () => {
  it("annotates selected-role prose without replacing scores, paragraphs, evidence or near-tie facts", () => {
    const body =
      structuredReaderFixtureV2().completed.report!.view.display.body;
    body.volumes.find((v) => v.id === "patterns")!.paragraphs[0]!.claimRef = {
      ...body.matching.selected.ref,
      id: "claim-reference",
    };
    const before = structuredClone(body);
    const annotation: QianzaiReportPresentation = {
      roleRef: body.matching.selected.ref,
      version: "reference-mapping-test",
      sourceHtmlSha256: "a".repeat(64),
      identity: { honorific: "受控称号", tags: ["受控标签"] },
      sections: [
        {
          id: "patterns",
          paragraphs: [
            {
              index: 0,
              layout: "card",
              title: "受控标题",
              claimRef: body.volumes.find((v) => v.id === "patterns")!
                .paragraphs[0]!.claimRef!,
            },
          ],
        },
      ],
    };
    const doc = qianzaiSnapshotDocument(body, annotation);
    expect(doc.mode).toBe("snapshot");
    expect(doc.dimensions).toBe(body.dimensions);
    expect(doc.body).toBe(body);
    expect(doc.sections.map((s) => s.blocks.map((b) => b.text))).toEqual(
      body.volumes.map((v) => v.paragraphs.map((p) => p.text)),
    );
    expect(
      doc.sections.flatMap((s) => s.blocks.map((b) => b.snapshot)),
    ).toEqual(body.volumes.flatMap((v) => v.paragraphs));
    expect(
      doc.sections.find((s) => s.id === "patterns")!.blocks[0]!.title,
    ).toBe("受控标题");
    expect(body).toEqual(before);
  });
  it("does not borrow a title or citation after a claim changes at the same paragraph index", () => {
    const body =
      structuredReaderFixtureV2().completed.report!.view.display.body;
    const paragraph = body.volumes[2]!.paragraphs[0]!;
    paragraph.claimRef = { ...body.matching.selected.ref, id: "current-claim" };
    const wrongRefs = [
      undefined,
      { ...paragraph.claimRef, id: "previous-claim" },
      { ...paragraph.claimRef, version: "other" },
      { ...paragraph.claimRef, productId: "elsewhere" },
    ];
    for (const claimRef of wrongRefs) {
      const doc = qianzaiSnapshotDocument(body, {
        roleRef: body.matching.selected.ref,
        version: "test",
        sourceHtmlSha256: "a".repeat(64),
        sections: [
          {
            id: "patterns",
            paragraphs: [
              {
                index: 0,
                layout: "card",
                ...(claimRef ? { claimRef } : {}),
                title: "不能串用的标题",
                citation: "不能串用的诗句",
              },
            ],
          },
        ],
      });
      const block = doc.sections[2]!.blocks[0]!;
      expect(block.layout).toBe("card");
      expect(block.title).toBeUndefined();
      expect(block.citation).toBeUndefined();
      expect(block.snapshot).toBe(paragraph);
      expect(block.text).toBe(paragraph.text);
    }
  });
  it("does not apply another role or version's identity and leaves unannotated prose complete", () => {
    const body =
      structuredReaderFixtureV2().completed.report!.view.display.body;
    for (const roleRef of [
      { ...body.matching.selected.ref, id: "other-role" },
      { ...body.matching.selected.ref, version: "other-version" },
      { ...body.matching.selected.ref, productId: "other-product" },
    ]) {
      const doc = qianzaiSnapshotDocument(body, {
        roleRef,
        version: "test",
        sourceHtmlSha256: "a".repeat(64),
        identity: { honorific: "不可借用" },
      });
      expect(doc.identity).toBeUndefined();
      expect(doc.sections.flatMap((s) => s.blocks.map((b) => b.text))).toEqual(
        body.volumes.flatMap((v) => v.paragraphs.map((p) => p.text)),
      );
    }
  });
});
