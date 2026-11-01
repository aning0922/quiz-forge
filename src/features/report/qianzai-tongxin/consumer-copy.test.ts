import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QianzaiReportReader } from "@/features/theme/qianzai-tongxin/report";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import { qianzaiSnapshotDocument } from "./presentation";
import {
  qianzaiConsumerCopy,
  qianzaiConsumerCopyText,
  QIANZAI_CONSUMER_COPY_VERSION,
} from "./consumer-copy";

type Fixture = Awaited<ReturnType<typeof qianzaiPresentationFixture>>;
const ref = (id: string) => ({
  productId: "qianzai-tongxin",
  id,
  version: "1.0.0",
});
async function fixture(role = "li-qingzhao") {
  const f = await qianzaiPresentationFixture();
  f.body.matching.selected.ref = f.view.display.selectedResultRef = ref(role);
  f.body.matching.selected.label = "RAW_SELECTED_LABEL";
  if (role === "mulan-ballad")
    f.body.matching.selected.kind = "literary-legendary";
  f.body.answers = [];
  f.body.volumes.forEach((v, i) => {
    v.paragraphs = [
      {
        claimRef: null,
        kind: "fallback",
        status: "fallback",
        text: `RAW_INTERNAL_PARAGRAPH_${i}`,
        evidence: [],
        counterevidence: [],
      },
    ];
  });
  const evidence = (option: string) => {
    const question = option.split("-")[0]!;
    let answer = f.body.answers.find((a) => a.questionRef.id === question);
    if (!answer) {
      answer = {
        questionRef: ref(question),
        optionRef: ref(option),
        prompt: `RAW_QUESTION_${question}`,
        optionText: `RAW_ANSWER_${option}`,
        act: 1,
      };
      f.body.answers.push(answer);
    }
    return {
      questionRef: ref(question),
      optionRef: ref(option),
      prompt: answer.prompt,
      optionText: answer.optionText,
      scope: "RAW_EVIDENCE_SCOPE",
    };
  };
  const paragraph = (
    id: string,
    kind: "summary" | "context",
    positive: readonly string[],
    negative: readonly string[] = [],
  ) => ({
    claimRef: ref(id),
    kind,
    status: "accepted" as const,
    text: `RAW_INTERNAL_${id}`,
    evidence: positive.map(evidence),
    counterevidence: negative.map(evidence),
  });
  f.body.volumes[2]!.paragraphs = [
    paragraph("authored-be6dfe2f8a8e169562e5", "summary", [
      "q02-b",
      "q04-a",
      "q18-b",
    ]),
    paragraph("authored-32874c524c0bcefdb155", "summary", ["q03-c", "q06-c"]),
    paragraph("authored-002ddc7622c049644c55", "summary", ["q07-b", "q10-a"]),
  ];
  f.body.volumes[3]!.paragraphs = [
    paragraph(
      "authored-2327e4fe1d6e8509b490",
      "context",
      ["q09-c", "q18-b"],
      ["q15-a"],
    ),
  ];
  return f;
}
const document = (f: Fixture) =>
  qianzaiSnapshotDocument(
    f.body,
    undefined,
    deriveQianzaiResultPresentation(f.view, f.binding)!,
  );
const section = (d: ReturnType<typeof document>, id: string) =>
  d.sections.find((s) => s.id === id)!;
const displayText = (d: ReturnType<typeof document>) =>
  d.sections
    .flatMap((s) => [
      s.title,
      s.intro ?? "",
      ...s.blocks.flatMap((b) => [b.title ?? "", b.text, b.citation ?? ""]),
    ])
    .join("\n");

describe("versioned Qianzai consumer prose", () => {
  it("opens with supported characteristics and shares six final sections while preserving the complete audit body", async () => {
    const f = await fixture(),
      before = structuredClone(f.body),
      d = document(f);
    expect(d.consumerEdition).toBe(true);
    expect(d.consumerCopyVersion).toBe(QIANZAI_CONSUMER_COPY_VERSION);
    expect(d.sections.map((s) => s.id)).toEqual([
      "encounter",
      "dimensions",
      "patterns",
      "counterevidence",
      "literature",
      "closure",
    ]);
    expect(section(d, "encounter").blocks).toHaveLength(2);
    expect(section(d, "encounter").blocks[0]!.text).toContain(
      "为新经验打开一扇窗",
    );
    expect(section(d, "encounter").blocks[1]!.text).toContain("易安的词");
    expect(section(d, "patterns").blocks).toHaveLength(3);
    expect(section(d, "counterevidence").blocks.map((b) => b.layout)).toEqual([
      "reflection-body",
      "prompt",
    ]);
    expect(section(d, "closure").blocks).toHaveLength(3);
    expect(section(d, "patterns").blocks[0]!.snapshot).toBe(
      f.body.volumes[2]!.paragraphs[0],
    );
    expect(d.history).toBeUndefined();
    expect(d.body).toBe(f.body);
    expect(d.dimensions).toBe(f.body.dimensions);
    expect(f.body).toEqual(before);
    expect(displayText(d)).not.toMatch(
      /RAW_|Q\d{2}|facts-only|accepted|证据不足|本轮选择记录|第\s*\d+\s*题/u,
    );
    f.body.volumes[2]!.paragraphs.reverse();
    expect(displayText(document(f))).toBe(displayText(d));
  });
  it("requires accepted full references and exact positive support, rather than text, position or a matching claim ID alone", async () => {
    const mutations: ((f: Fixture) => void)[] = [
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.status = "facts-only";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.status = "fallback";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.kind = "fact";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.claimRef!.version = "2.0.0";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.claimRef!.productId = "foreign";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.evidence.pop();
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.evidence[0]!.optionRef.id = "q02-a";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.evidence[0]!.questionRef.version =
          "2.0.0";
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.evidence[0]!.optionText =
          "UNMATCHED_RAW_ANSWER";
      },
      (f) => {
        f.body.answers = f.body.answers.filter(
          (a) => a.questionRef.id !== "q04",
        );
      },
      (f) => {
        f.body.answers.push({
          ...f.body.answers.find((a) => a.questionRef.id === "q04")!,
          optionRef: ref("q04-b"),
        });
      },
      (f) => {
        f.body.volumes[2]!.paragraphs[0]!.counterevidence = [
          f.body.volumes[2]!.paragraphs[0]!.evidence[0]!,
        ];
      },
    ];
    for (const mutate of mutations) {
      const f = await fixture();
      mutate(f);
      const d = document(f);
      expect(section(d, "patterns").blocks).toHaveLength(2);
      expect(displayText(d)).not.toContain("给新的可能，留一扇窗");
      expect(section(d, "encounter").blocks[0]!.text).toContain(
        "为感受留一张座位",
      );
      expect(displayText(d)).not.toMatch(/RAW_|Q\d{2}/u);
    }
  });
  it("requires actual counter-support for a reflection and uses a gentle prompt when it is missing", async () => {
    for (const mode of ["answer", "counter", "status", "kind"]) {
      const f = await fixture(),
        p = f.body.volumes[3]!.paragraphs[0]!;
      if (mode === "answer")
        f.body.answers = f.body.answers.filter(
          (a) => a.questionRef.id !== "q15",
        );
      if (mode === "counter") p.counterevidence = [];
      if (mode === "status") p.status = "facts-only";
      if (mode === "kind") p.kind = "fact";
      const blocks = section(document(f), "counterevidence").blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.layout).toBe("prompt");
      expect(blocks[0]!.snapshot).toBeUndefined();
      expect(blocks[0]!.text).not.toContain("想走向新的方向");
    }
  });
  it("does not fill sparse or facts-only paths with invented highlights", async () => {
    const f = await fixture();
    f.body.volumes[2]!.paragraphs.forEach((p) => {
      p.status = "facts-only";
    });
    f.body.volumes[3]!.paragraphs = [];
    const d = document(f);
    expect(section(d, "patterns").blocks).toEqual([]);
    expect(section(d, "encounter").blocks).toHaveLength(2);
    expect(section(d, "encounter").blocks[0]!.snapshot).toBeUndefined();
    expect(section(d, "encounter").blocks[0]!.text).toContain("李清照");
    expect(section(d, "closure").blocks[0]!.text).toBe(
      "谢谢你给自己留下一段安静读卷的时间。",
    );
    expect(section(d, "closure").blocks).toHaveLength(3);
    f.body.volumes[2]!.paragraphs[0]!.status = "accepted";
    expect(section(document(f), "patterns").blocks).toHaveLength(1);
  });
  it("keeps unknown, unbound and mismatched source/role/version inputs on the existing snapshot path", async () => {
    const f = await fixture(),
      result = deriveQianzaiResultPresentation(f.view, f.binding)!;
    const d = qianzaiSnapshotDocument(f.body);
    expect(d.consumerEdition).toBeUndefined();
    expect(d.sections.flatMap((s) => s.blocks.map((b) => b.text))).toEqual(
      f.body.volumes.flatMap((v) => v.paragraphs.map((p) => p.text)),
    );
    expect(
      qianzaiConsumerCopy(f.body, {
        ...result,
        profileVersion: "unknown" as typeof result.profileVersion,
      }),
    ).toBeUndefined();
    expect(
      qianzaiConsumerCopy(f.body, {
        ...result,
        source: { ...result.source, answersHash: "f".repeat(64) },
      }),
    ).toBeUndefined();
    expect(
      qianzaiConsumerCopy(f.body, {
        ...result,
        role: { ...result.role, ref: ref("su-shi") },
      }),
    ).toBeUndefined();
    expect(
      qianzaiConsumerCopy(f.body, {
        ...result,
        role: { ...result.role, displayName: "FOREIGN_ROLE_COPY" },
      }),
    ).toBeUndefined();
    expect(
      qianzaiConsumerCopy(f.body, {
        ...result,
        quote: { ...result.quote, text: "UNREGISTERED_VERSE" },
      }),
    ).toBeUndefined();
    const foreign = structuredClone(f.body);
    foreign.provenance.canonicalContentSha256 = "f".repeat(64);
    expect(qianzaiConsumerCopy(foreign, result)).toBeUndefined();
  });
  it("uses one bound consumer mechanism for the five existing roles and includes the compiled display corpus", async () => {
    const corpus = qianzaiConsumerCopyText().join(""),
      coverage = new Set(corpus);
    for (const role of [
      "li-qingzhao",
      "li-bai",
      "su-shi",
      "tao-yuanming",
      "mulan-ballad",
    ]) {
      const f = await fixture(role),
        d = document(f);
      expect(d.consumerEdition).toBe(true);
      expect(d.resultPresentation!.role.ref.id).toBe(role);
      expect(
        section(d, "literature").blocks.filter((b) => b.layout === "timeline"),
      ).toHaveLength(3);
      expect(section(d, "closure").blocks).toHaveLength(3);
      expect(
        [...displayText(d)].filter(
          (c) => /\p{Script=Han}/u.test(c) && !coverage.has(c),
        ),
      ).toEqual([]);
    }
    expect(corpus).not.toContain("RAW_");
  });
  it("renders final prose without evidence, raw answers, technical qualifiers, old closure or duplicate history", async () => {
    const f = await fixture(),
      d = document(f),
      html = renderToStaticMarkup(
        createElement(QianzaiReportReader, {
          document: d,
          onResult: () => {},
          actions: createElement("button", null, "保存本卷"),
        }),
      );
    expect(html).toContain('data-qianzai-consumer-edition="true"');
    for (const marker of [
      "RAW_",
      "data-report-evidence",
      "data-status=",
      "本轮全部选择",
      "本轮匹配记录与说明",
      "选择摘要",
      "补充情境记录",
      "本段依据的实际选择",
      "本轮暂不展开",
      "facts-only",
    ])
      expect(html).not.toContain(marker);
    for (const value of d.resultPresentation!.closure.lines)
      expect(html).not.toContain(value);
    expect(html.split("记住一段鲜活的光阴")).toHaveLength(2);
    expect(html).toContain(section(d, "encounter").blocks[0]!.text);
    expect(html).toContain(f.body.notice);
    expect(html.match(/data-qianzai-dimension-scale=/gu)).toHaveLength(5);
    expect(html.match(/role="meter"/gu)).toHaveLength(5);
    for (const dimension of f.body.dimensions) {
      expect(html).toContain(`aria-valuenow="${dimension.score}"`);
      expect(html).toContain(
        `data-qianzai-dimension-scale="${dimension.dimensionRef.id}"`,
      );
    }
    for (const block of section(d, "dimensions").blocks) {
      expect(html.split(block.text)).toHaveLength(2);
    }
    expect(html).toContain("协调共同选择");
    expect(html).toContain("表达自身选择");
    expect(html).toContain("aria-controls=");
    expect(html).not.toContain("现有证据不足以概括广义应变能力");
  });
});
