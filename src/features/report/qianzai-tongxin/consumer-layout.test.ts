import { afterEach, describe, expect, it, vi } from "vitest";
import type { QianzaiSnapshotDocument } from "./presentation";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import {
  layoutQianzaiExport,
  qianzaiExportText,
  qianzaiExportBrushText,
  type Measure,
  type ExportOperation,
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
      title: `${d.label} · 相处步调`,
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
  it("keeps reader traits separate from the historical character profile", async () => {
    const f = await fixture();
    port.doc = {
      ...port.doc!,
      identity: { honorific: f.p.role.honorific, tags: ["个人选择标签"] },
    };
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    const portrait = layout.operations.find(
      (o) => o.kind === "image" && o.role === "portrait",
    );
    expect(portrait?.kind).toBe("image");
    if (portrait?.kind !== "image") throw Error("PORTRAIT_MISSING");
    const profileText = layout.operations
      .flatMap((o) =>
        o.kind === "text" && o.y >= portrait.box.y ? [o.text] : [],
      )
      .join("");
    expect(profileText).toContain(f.p.role.tags.join(" · "));
    expect(profileText).not.toContain("个人选择标签");
    const declared = new Set(
      qianzaiExportText(f.body, "full-report", f.p).join(""),
    );
    expect(
      [...f.p.role.tags.join(" · ")].filter((c) => !declared.has(c)),
    ).toEqual([]);
  });
  it("keeps the top radar text clear of the plotted area", async () => {
    const f = await fixture();
    const layout = layoutQianzaiExport(f.body, "poster", measure, undefined, {
      presentation: f.p,
    });
    const radar = layout.operations.find((o) => o.kind === "radar");
    if (radar?.kind !== "radar") throw Error("RADAR_MISSING");
    const topText = layout.operations.filter(
      (o): o is Extract<ExportOperation, { kind: "text" }> =>
        o.kind === "text" &&
        o.x >= 254 &&
        o.x <= 420 &&
        o.y >= 1047 &&
        o.y < 1175,
    );
    expect(topText.length).toBeGreaterThanOrEqual(3);
    expect(
      Math.max(
        ...topText.map((o) => o.y + measure(o.text, o.size, o.style).descent),
      ),
    ).toBeLessThanOrEqual(radar.y - radar.radius - 12);
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
      y: 1320,
      radius: 145,
      scores: f.body.dimensions.map((d) => d.score),
    });
    const tags = layout.operations.filter(
      (o): o is Extract<ExportOperation, { kind: "ornament" }> =>
        o.kind === "ornament" && o.style === "tag",
    );
    expect(tags).toHaveLength(f.p.poster.tags.length);
    if (tags.length)
      expect(tags[0]!.box).toEqual({
        x: 84 + ((3 - tags.length) * 171) / 2,
        y: 1512,
        width: 151,
        height: 56,
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
  it("draws only the 0–3 supported tags within the fixed tag area", async () => {
    const f = await fixture();
    for (const count of [0, 1, 2, 3]) {
      const p = {
        ...f.p,
        poster: {
          ...f.p.poster,
          tags: ["听见心意", "留住热爱", "自在前行"].slice(0, count),
        },
      };
      port.doc = { ...port.doc!, resultPresentation: p };
      const layout = layoutQianzaiExport(f.body, "poster", measure, undefined, {
        presentation: p,
      });
      const tags = layout.operations.filter(
        (o): o is Extract<ExportOperation, { kind: "ornament" }> =>
          o.kind === "ornament" && o.style === "tag",
      );
      expect(tags).toHaveLength(count);
      if (count) {
        expect(tags[0]!.box.x).toBe(84 + ((3 - count) * 171) / 2);
        expect(
          tags.every(
            (o) =>
              o.box.y === 1512 && o.box.width === 151 && o.box.height === 56,
          ),
        ).toBe(true);
      }
      expect(layout.operations.find((o) => o.kind === "radar")).toMatchObject({
        x: 333,
        y: 1320,
        radius: 145,
      });
      expect(layout.height).toBe(1672);
    }
  });
  it("keeps a single dimension name and complete prose in each wide scale row, and starts literary prose beside the portrait", async () => {
    const f = await fixture();
    f.body.dimensions[0]!.score = 100;
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation: f.p },
    );
    const text = layout.operations.filter((o) => o.kind === "text");
    expect(text.some((o) => o.text === "100" && o.style === "number")).toBe(
      true,
    );
    // Radar and scale scores use the same controlled numeric face, while the
    // literary explanation remains independent from that face.
    expect(text.filter((o) => o.style === "number")).toHaveLength(10);
    const dimBlocks = port.doc!.sections.find(
      (s) => s.id === "dimensions",
    )!.blocks;
    for (const [i, b] of dimBlocks.entries()) {
      const rowText = text.map((o) => o.text).join("");
      expect(rowText.split(b.title!).length - 1).toBe(1);
      const title = text.find(
        (o) =>
          o.text.startsWith(port.doc!.dimensions[i]!.label) &&
          o.style === "brush",
      )!;
      const explanation = text.find(
        (o) => b.text.startsWith(o.text) && o.x === 59,
      )!;
      expect(explanation.y).toBeGreaterThan(title.y);
      expect(explanation.size).toBe(22);
    }
    expect(layout.operations.filter((o) => o.kind === "bar")).toHaveLength(5);
    for (const bar of layout.operations.filter((o) => o.kind === "bar")) {
      expect(bar.prototypeScale).toBeCloseTo(724 / 390);
      expect(bar.width).toBeGreaterThan(570);
      expect(bar.scale?.midpointPercent).toBe(50);
      expect(bar.scale?.positionPercent).toBe(bar.score);
    }
    const portrait = layout.operations.find(
      (o): o is Extract<ExportOperation, { kind: "image" }> =>
        o.kind === "image" && o.role === "portrait" && !o.blend,
    )!;
    const first = port.doc!.sections.find((s) => s.id === "literature")!
      .blocks[0]!;
    const literaryStart = text.find(
      (o) => first.text.startsWith(o.text) && o.x === 327,
    )!;
    expect(literaryStart.y).toBeLessThan(portrait.box.y + portrait.box.height);
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
