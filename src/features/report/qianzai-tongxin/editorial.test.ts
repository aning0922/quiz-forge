import { describe, expect, it } from "vitest";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { qianzaiSnapshotDocument } from "./presentation";
import {
  qianzaiChapterEditorial,
  qianzaiParagraphEditorial,
} from "./editorial";
import { layoutQianzaiExport, qianzaiExportText, type Measure } from "./layout";
import { deriveQianzaiResultPresentation } from "./result-presentation";
const measure: Measure = (s, size) => ({
  width: [...s].length * size,
  left: 0,
  right: [...s].length * size,
  ascent: size * 0.8,
  descent: size * 0.2,
});
async function fixture() {
  const f = await qianzaiPresentationFixture();
  const known = (id: string, kind: "summary" | "context", text: string) => ({
    claimRef: { productId: "qianzai-tongxin", id, version: "1.0.0" },
    kind,
    status: "accepted" as const,
    text,
    evidence: [
      {
        questionRef: f.body.answers[0]!.questionRef,
        optionRef: f.body.answers[0]!.optionRef,
        prompt: "SYNTHETIC_QUESTION",
        optionText: "SYNTHETIC_CHOICE",
        scope: "SYNTHETIC_SCOPE",
      },
    ],
    counterevidence: [],
  });
  f.body.volumes[2]!.paragraphs = [
    known(
      "authored-be6dfe2f8a8e169562e5",
      "summary",
      "SYNTHETIC_FULL_RESONANCE",
    ),
    known("authored-e716458dd62fba60133b", "context", "SYNTHETIC_FULL_CONTEXT"),
  ];
  f.body.volumes[3]!.paragraphs = [
    known("authored-6986b26ef46f6048b67a", "context", "SYNTHETIC_UNKNOWN_KIND"),
    known(
      "authored-2327e4fe1d6e8509b490",
      "context",
      "SYNTHETIC_FULL_REFLECTION",
    ),
  ];
  f.body.volumes[3]!.paragraphs[1]!.counterevidence = [
    {
      ...f.body.volumes[3]!.paragraphs[1]!.evidence[0]!,
      prompt: "SYNTHETIC_COUNTER",
      optionText: "SYNTHETIC_COUNTER_CHOICE",
    },
  ];
  return f;
}
describe("Qianzai pinned editorial display", () => {
  it("binds annotations to source, complete reference, volume, kind and status rather than position", async () => {
    const f = await fixture(),
      p = f.body.volumes[2]!.paragraphs[0]!,
      before = structuredClone(f.body);
    const annotation = qianzaiParagraphEditorial(f.body, "patterns", p)!;
    expect(annotation.title).toBe("向陌生的光走去");
    const first = qianzaiSnapshotDocument(f.body);
    f.body.volumes[2]!.paragraphs.reverse();
    const next = qianzaiSnapshotDocument(f.body);
    expect(next.sections[2]!.blocks[1]!.editorial).toEqual(
      first.sections[2]!.blocks[0]!.editorial,
    );
    f.body.volumes[2]!.paragraphs.reverse();
    expect(f.body).toEqual(before);
    for (const ref of [
      { ...p.claimRef!, productId: "other" },
      { ...p.claimRef!, version: "2.0.0" },
      { ...p.claimRef!, id: "unknown" },
      null,
    ])
      expect(
        qianzaiParagraphEditorial(f.body, "patterns", { ...p, claimRef: ref }),
      ).toBeUndefined();
    expect(
      qianzaiParagraphEditorial(f.body, "counterevidence", p),
    ).toBeUndefined();
    expect(
      qianzaiParagraphEditorial(f.body, "patterns", {
        ...p,
        status: "facts-only",
      }),
    ).toBeUndefined();
    expect(
      qianzaiParagraphEditorial(f.body, "patterns", { ...p, kind: "fact" }),
    ).toBeUndefined();
    f.body.provenance.canonicalContentSha256 = "0".repeat(64);
    expect(qianzaiParagraphEditorial(f.body, "patterns", p)).toBeUndefined();
    expect(qianzaiChapterEditorial(f.body, f.body.volumes[2]!)).toBeUndefined();
  });
  it("keeps facts-only and empty chapters as ordinary records without manufactured summaries or prompts", async () => {
    const f = await fixture();
    const p = f.body.volumes[2]!.paragraphs[0]!;
    Object.assign(p, {
      claimRef: {
        productId: "qianzai-tongxin",
        id: "authored-3a4d6c0ad9a0fa847194",
        version: "1.0.0",
      },
      status: "facts-only",
    });
    const doc = qianzaiSnapshotDocument(f.body);
    expect(doc.sections[2]!.blocks[0]!.editorial).toMatchObject({
      kind: "record",
    });
    expect(
      doc.sections[2]!.blocks[0]!.editorial?.choiceSummary,
    ).toBeUndefined();
    f.body.volumes[2]!.paragraphs = [
      {
        ...p,
        claimRef: null,
        kind: "fallback",
        status: "fallback",
        text: "SYNTHETIC_FALLBACK",
        evidence: [],
        counterevidence: [],
      },
    ];
    f.body.volumes[3]!.paragraphs = [{ ...f.body.volumes[2]!.paragraphs[0]! }];
    const empty = qianzaiSnapshotDocument(f.body);
    expect(empty.sections[2]!.blocks[0]!.editorial).toBeUndefined();
    expect(empty.sections[3]!.editorial?.featureClaimId).toBeUndefined();
    expect(empty.sections[3]!.editorial?.prompts).toBeUndefined();
  });
  it("chooses reflection by pinned semantic priority, retains all prose/evidence in PNG, and uses the same name-art image port without changing body metrics", async () => {
    const f = await fixture(),
      before = structuredClone(f.body),
      presentation = deriveQianzaiResultPresentation(f.view, f.binding)!;
    const chapter = qianzaiChapterEditorial(f.body, f.body.volumes[3]!)!;
    expect(chapter.featureClaimId).toBe("authored-2327e4fe1d6e8509b490");
    expect(chapter.prompts).toHaveLength(1);
    const layout = layoutQianzaiExport(
      f.body,
      "full-report",
      measure,
      undefined,
      { presentation },
    );
    const text = layout.operations
      .filter((o) => o.kind === "text")
      .map((o) => o.text)
      .join("");
    const fontInput = qianzaiExportText(
      f.body,
      "full-report",
      presentation,
    ).join("");
    for (const s of [
      "SYNTHETIC_FULL_RESONANCE",
      "SYNTHETIC_FULL_REFLECTION",
      "SYNTHETIC_UNKNOWN_KIND",
      "SYNTHETIC_COUNTER",
      "SYNTHETIC_QUESTION",
      "向陌生的光走去",
      chapter.dedication!,
      chapter.prompts![0]!.text,
    ]) {
      expect(text).toContain(s);
      expect(fontInput).toContain(s);
    }
    expect(
      layout.operations.some((o) => o.kind === "image" && o.role === "nameArt"),
    ).toBe(true);
    expect(f.body).toEqual(before);
    f.body.volumes[3]!.paragraphs.reverse();
    expect(
      qianzaiChapterEditorial(f.body, f.body.volumes[3]!)!.featureClaimId,
    ).toBe(chapter.featureClaimId);
    const legacy = layoutQianzaiExport(f.body, "poster", measure);
    expect(
      legacy.operations.some((o) => o.kind === "image" && o.role === "nameArt"),
    ).toBe(true);
  });
});
