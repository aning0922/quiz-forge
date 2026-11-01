import { afterEach, describe, expect, it, vi } from "vitest";
import type { QianzaiSnapshotDocument } from "./presentation";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import {
  layoutQianzaiExport,
  qianzaiExportText,
  qianzaiExportBrushText,
  type Measure,
} from "./layout";
const port = vi.hoisted(() => ({
  doc: null as QianzaiSnapshotDocument | null,
}));
vi.mock("./presentation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./presentation")>();
  return {
    ...actual,
    qianzaiSnapshotDocument: (
      ...args: Parameters<typeof actual.qianzaiSnapshotDocument>
    ) => port.doc ?? actual.qianzaiSnapshotDocument(...args),
  };
});
afterEach(() => {
  port.doc = null;
});
const measure: Measure = (s, size) => ({
  width: [...s].length * size,
  left: 0,
  right: [...s].length * size,
  ascent: size * 0.8,
  descent: size * 0.2,
});
async function fixture() {
  const f = await qianzaiPresentationFixture(),
    p = deriveQianzaiResultPresentation(f.view, f.binding)!;
  const raw = "Q01 原始题干 原始选项 facts-only 反向证据";
  for (const v of f.body.volumes)
    for (const paragraph of v.paragraphs) paragraph.text = raw;
  const blocks = [
    [
      {
        text: "愿你走向远方，也珍惜自己选择留下的地方。",
        layout: "lead" as const,
      },
    ],
    f.body.dimensions.map((d) => ({
      title: d.label,
      text: `本轮在${d.label}方向，你的选择呈现一种可供细读的偏好。`,
      layout: "body" as const,
    })),
    ["向远方", "在身边", "与自己"].map((title) => ({
      title,
      text: "你愿意为新的可能留一扇窗，也愿在熟悉的生活里慢慢积累。",
      layout: "card" as const,
    })),
    [
      {
        title: "另一面的心意",
        text: "尝新与求稳可以同时存在，无须把每一次选择解释成同一种样子。",
        layout: "body" as const,
      },
    ],
    [
      {
        title: "人物与作品",
        text: "人物的作品是一条阅读线索，照见多面的生活，也留下想象与距离。",
        layout: "body" as const,
      },
    ],
    ["愿你继续热爱。", "愿你珍惜相遇。", "愿你自在前行。"].map((text) => ({
      text,
      layout: "body" as const,
    })),
  ];
  port.doc = {
    mode: "snapshot",
    body: f.body,
    name: p.role.displayName,
    subtitle: p.role.identitySubtitle,
    identity: { honorific: p.role.honorific, tags: p.role.tags },
    heroCaption: "山河相逢",
    openingTitle: "与你相逢",
    dimensionBadge: "本轮偏好",
    dimensions: f.body.dimensions,
    legal: f.body.notice,
    resultPresentation: p,
    sections: f.body.volumes.map((v, i) => ({
      id: v.id,
      title: [
        "与你相逢",
        "五维详解",
        "同心气质",
        "山河自照",
        "人物映照",
        "赠你寄语",
      ][i]!,
      blocks: blocks[i]!.map((b) => ({ ...b, snapshot: v.paragraphs[0]! })),
    })),
    consumerEdition: true,
  } as QianzaiSnapshotDocument;
  return { ...f, p, raw };
}
describe("consumer edition exports", () => {
  it("prints the complete shared consumer blocks without raw snapshot, questions, answers, qualifiers or runner-up", async () => {
    const f = await fixture(),
      before = JSON.stringify(f.body),
      doc = port.doc!;
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    const text = layout.operations
      .flatMap((o) => (o.kind === "text" ? [o.text] : []))
      .join("");
    for (const s of doc.sections) {
      expect(text).toContain(s.title);
      for (const b of s.blocks) {
        expect(text).toContain(b.text);
        if (b.title) expect(text).toContain(b.title);
      }
    }
    for (const hidden of [
      f.raw,
      "原始题干",
      "原始选项",
      "facts-only",
      "反向证据",
      "选择依据",
      "第二候选：",
    ])
      expect(text).not.toContain(hidden);
    expect(JSON.stringify(f.body)).toBe(before);
    const collected = qianzaiExportText(f.body, "full-report", f.p).join("");
    expect(collected).not.toContain(f.raw);
    expect([...text].filter((c) => !new Set(collected).has(c))).toEqual([]);
    const brush = layout.operations
      .flatMap((o) =>
        o.kind === "text" && o.style === "brush" ? [o.text] : [],
      )
      .join("");
    expect(
      [...brush].filter(
        (c) =>
          !new Set(
            qianzaiExportBrushText(f.body, "full-report", f.p).join(""),
          ).has(c),
      ),
    ).toEqual([]);
    expect(layout.operations.filter((o) => o.kind === "bar")).toHaveLength(5);
  });
  it("uses measured prototype poster anchors with actual scores and no invented QR region", async () => {
    const f = await fixture();
    f.body.matching.selected.narrativeIndex = 43;
    const layout = layoutQianzaiExport(f.body, "poster", measure, undefined, {
      presentation: f.p,
    });
    expect(layout.operations).toContainEqual({
      kind: "ornament",
      box: { x: 43, y: 577, width: 325, height: 191 },
      style: "frame",
    });
    expect(layout.operations.find((o) => o.kind === "radar")).toMatchObject({
      x: 333,
      y: 1265,
      radius: 171,
      scores: f.body.dimensions.map((d) => d.score),
    });
    expect(layout.operations).toContainEqual({
      kind: "ornament",
      box: { x: 84, y: 1512, width: 151, height: 56 },
      style: "tag",
    });
    const text = layout.operations
      .flatMap((o) => (o.kind === "text" ? [o.text] : []))
      .join("");
    expect(text).toContain("43%");
    expect(text).not.toContain("二维码");
    expect(text).not.toContain("89%");
    expect(text).not.toContain("Q01");
    const printed = layout.operations.filter((o) => o.kind === "text");
    for (const line of f.p.poster.lines)
      expect(printed.find((o) => o.text === line)?.x).toBe(60);
  });
  it("keeps complete endpoint labels and closing punctuation on a readable line", async () => {
    const f = await fixture(),
      doc = port.doc!;
    port.doc = {
      ...doc,
      sections: doc.sections.map((s) =>
        s.id === "dimensions"
          ? {
              ...s,
              blocks: s.blocks.map((b) => ({
                ...b,
                text: "叙".repeat(10) + "。",
              })),
            }
          : s,
      ),
    };
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    const printed = layout.operations.filter((o) => o.kind === "text");
    expect(printed.some((o) => o.text === "保留结构局部调整")).toBe(true);
    expect(
      printed.filter((o) => /^[，。！？、；：）》」』】〕〉]/.test(o.text)),
    ).toEqual([]);
    expect(printed.map((o) => o.text).join("")).toContain(
      "叙".repeat(10) + "。",
    );
  });
  it("grows to retain the final consumer paragraph and rejects genuine height overflow", async () => {
    const f = await fixture(),
      doc = port.doc!;
    const short = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    const last = doc.sections.at(-1)!.blocks.at(-1)!;
    const extra = "最后一段仍然完整。".repeat(30);
    port.doc = {
      ...doc,
      sections: doc.sections.map((s, i) =>
        i === 5 ? { ...s, blocks: [...s.blocks, { ...last, text: extra }] } : s,
      ),
    };
    const longer = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    expect(longer.height).toBeGreaterThan(short.height);
    expect(
      longer.operations
        .flatMap((o) => (o.kind === "text" ? [o.text] : []))
        .join(""),
    ).toContain(extra);
    port.doc = {
      ...doc,
      sections: doc.sections.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) => ({ ...b, text: "满".repeat(4000) })),
      })),
    };
    expect(() =>
      layoutQianzaiExport(f.body, "full-report", measure, undefined, {
        presentation: f.p,
      }),
    ).toThrow("CONTENT_LIMIT");
  });
});
