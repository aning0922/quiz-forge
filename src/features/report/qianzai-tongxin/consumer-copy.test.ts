import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QianzaiReportReader } from "@/features/theme/qianzai-tongxin/report";
import {
  qianzaiConsumerCopyFixture as fixture,
  qianzaiCopyRef as ref,
} from "./consumer-copy.test-support";
import { qianzaiSupportedThemes } from "./supported-themes";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import { qianzaiSnapshotDocument } from "./presentation";
import {
  qianzaiConsumerCopy,
  qianzaiConsumerCopyText,
  QIANZAI_CONSUMER_COPY_VERSION,
} from "./consumer-copy";

type Fixture = Awaited<ReturnType<typeof fixture>>;
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
      "用新的经验与表达",
    );
    expect(section(d, "encounter").blocks[1]!.text).toContain("易安的词");
    expect(section(d, "patterns").blocks).toHaveLength(3);
    expect(section(d, "counterevidence").blocks.map((b) => b.layout)).toEqual([
      "reflection-body",
      "prompt",
    ]);
    expect(section(d, "closure").blocks).toHaveLength(3);
    expect(section(d, "closure").blocks.map((b) => b.text)).not.toContain(
      section(d, "encounter").blocks[0]!.text,
    );

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
      expect(d.resultPresentation!.poster.tags).toEqual([
        "先听感受",
        "先行体验",
      ]);
      expect(d.resultPresentation!.reveal.supportingClaimRefs).toHaveLength(2);
      expect(section(d, "patterns").blocks.map((b) => b.title)).not.toContain(
        "给新经验一个入口",
      );
      expect(section(d, "encounter").blocks[0]!.text).toContain("先听感受");
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
  it("describes both short and long term openness for the two new-direction choices, with familiarity only in the suggestion", async () => {
    const f = await fixture();
    const support = f.body.volumes[2]!.paragraphs[0]!.evidence;
    const observed = {
      claimRef: ref("authored-6986b26ef46f6048b67a"),
      kind: "fact" as const,
      status: "accepted" as const,
      text: "RAW_INTERNAL_NEW_DIRECTIONS",
      evidence: support.filter((e) =>
        ["q02-b", "q18-b"].includes(e.optionRef.id),
      ),
      counterevidence: [],
    };
    f.body.volumes[3]!.paragraphs = [observed];
    const blocks = section(document(f), "counterevidence").blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.snapshot).toBe(observed);
    expect(blocks[0]!.title).toBe("眼前与长远，都向新的方向开放");
    expect(blocks[0]!.text).toContain(
      "眼前的一次尝试，与长久投入的方向，你都愿意走向陌生之处",
    );
    expect(blocks[0]!.text).not.toMatch(/熟悉|深耕/u);
    expect(blocks[1]!.layout).toBe("prompt");
    expect(blocks[1]!.text).toContain("也可以为自己保留一处熟悉的落脚点");
    expect(qianzaiConsumerCopyText()).toContain(blocks[0]!.text);
    expect(qianzaiConsumerCopyText()).toContain(blocks[1]!.text);
    observed.evidence.pop();
    expect(section(document(f), "counterevidence").blocks[0]!.layout).toBe(
      "prompt",
    );
  });
  it("provides shared nonpersonal literary prose for sparse or facts-only paths without invented highlights", async () => {
    const f = await fixture();
    f.body.volumes[2]!.paragraphs.forEach((p) => {
      p.status = "facts-only";
    });
    f.body.volumes[3]!.paragraphs = [];
    const d = document(f);
    const patterns = section(d, "patterns");
    expect(patterns.intro).not.toContain("留一点空白");
    expect(patterns.blocks).toHaveLength(1);
    expect(patterns.blocks[0]!.layout).toBe("body");
    expect(patterns.blocks[0]!.snapshot).toBeUndefined();
    expect(patterns.blocks[0]!.text).toContain(
      "文学里的相逢，可以从一句诗、一个细节开始",
    );
    expect(patterns.blocks[0]!.text).not.toMatch(
      /你愿意|看见你|本轮|选择记录/u,
    );
    expect(qianzaiConsumerCopyText()).toContain(patterns.blocks[0]!.text);
    const html = renderToStaticMarkup(
      createElement(QianzaiReportReader, {
        document: d,
        onResult: () => {},
        actions: null,
      }),
    );
    expect(html.split(patterns.blocks[0]!.text)).toHaveLength(2);
    expect(section(d, "encounter").blocks).toHaveLength(2);
    expect(section(d, "encounter").blocks[0]!.snapshot).toBeUndefined();
    expect(section(d, "encounter").blocks[0]!.text).toContain("李清照");
    expect(section(d, "closure").blocks[0]!.text).toBe(
      "这一卷读到这里，接下来的故事由你落笔。",
    );
    expect(section(d, "closure").blocks).toHaveLength(3);
    f.body.volumes[2]!.paragraphs[0]!.status = "accepted";
    const supportedPatterns = section(document(f), "patterns").blocks;
    expect(supportedPatterns).toHaveLength(1);
    expect(supportedPatterns[0]!.layout).toBe("card");
    expect(supportedPatterns[0]!.text).not.toBe(patterns.blocks[0]!.text);
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
  it("keeps reveal, poster, personal tags and the full document on the same supported themes without filling a third trait", async () => {
    const f = await fixture();
    // A lone q02 fact must not override a different, supported two-context theme.
    const original = f.body.volumes[2]!.paragraphs[0]!;
    f.body.volumes[0]!.paragraphs.push({
      ...original,
      claimRef: ref("authored-7053c48e83fe3e6c223d"),
      kind: "fact",
      evidence: [original.evidence[0]!],
    });
    f.body.volumes[2]!.paragraphs = f.body.volumes[2]!.paragraphs.slice(1);
    const d = document(f),
      result = d.resultPresentation!,
      themes = qianzaiSupportedThemes(f.body);
    expect(themes).toHaveLength(2);
    expect(result.reveal.lines).toEqual([
      themes[0]!.feature.short[0],
      themes[1]!.feature.short[0],
      result.role.invitation,
    ]);
    expect(result.poster.lines).toBe(result.reveal.lines);
    expect(result.poster.tags).toEqual(["先听感受", "先行体验"]);
    expect(d.identity!.tags).toBe(result.poster.tags);
    expect(result.reveal.supportingClaimRefs).toEqual(
      themes.map((t) => t.snapshot.claimRef),
    );
    for (const theme of themes)
      expect(section(d, "encounter").blocks[0]!.text).toContain(
        theme.feature.seen,
      );
    expect(section(d, "patterns").blocks.map((b) => b.text)).toEqual(
      themes.map((t) => t.feature.text),
    );
    f.body.volumes[2]!.paragraphs.pop();
    const one = document(f).resultPresentation!;
    expect(one.poster.tags).toEqual(["先听感受"]);
    expect(one.reveal.supportingClaimRefs).toHaveLength(1);
    expect(one.reveal.lines.slice(0, 2)).toEqual([
      ...qianzaiSupportedThemes(f.body)[0]!.feature.short,
    ]);
    f.body.volumes[2]!.paragraphs = [];
    const neutral = document(f);
    expect(neutral.identity!.tags).toEqual([]);
    expect(neutral.resultPresentation!.reveal.lines).toEqual([
      ...result.role.baseLines,
      result.role.invitation,
    ]);
    expect(section(neutral, "patterns").blocks[0]!.layout).toBe("body");
  });
  it("selects axis prose with the existing 45..55 midpoint, without changing scores or deriving personal traits from them", async () => {
    const f = await fixture();
    // No accepted theme: even the maximum scale cannot manufacture a trait.
    f.body.volumes[2]!.paragraphs = [];
    const at = (score: number) => {
      f.body.dimensions.forEach((d) => {
        d.score = score;
      });
      return document(f);
    };
    const left = at(44),
      leftText = section(left, "dimensions").blocks.map((b) => b.text);
    const mid45 = at(45),
      middleText = section(mid45, "dimensions").blocks.map((b) => b.text);
    expect(section(at(55), "dimensions").blocks.map((b) => b.text)).toEqual(
      middleText,
    );
    const right = at(56),
      rightText = section(right, "dimensions").blocks.map((b) => b.text);
    for (let i = 0; i < 5; i++) {
      expect(leftText[i]).not.toBe(middleText[i]);
      expect(rightText[i]).not.toBe(middleText[i]);
      expect(leftText[i]).not.toBe(rightText[i]);
      expect(middleText[i]).toContain("之间");
    }
    expect(leftText[0]).toContain("先协调彼此需要");
    expect(rightText[0]).toContain("表达自身选择");
    expect(leftText[4]).toContain("局部调整");
    expect(rightText[4]).toContain("整体重新安排");
    const maximum = at(100),
      before = structuredClone(f.body);
    expect(maximum.resultPresentation!.poster.tags).toEqual([]);
    expect(maximum.dimensions).toBe(f.body.dimensions);
    document(f);
    expect(f.body).toEqual(before);
    expect(f.body.dimensions.every((d) => d.score === 100)).toBe(true);
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
      ).toHaveLength(1);
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
    expect(html.split("溪亭与云涛")).toHaveLength(2);
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
