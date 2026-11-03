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
import { qianzaiExportText } from "./layout";
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
    expect(patterns.blocks).toHaveLength(2);
    expect(patterns.blocks[0]!.layout).toBe("body");
    expect(patterns.blocks[0]!.snapshot).toBeUndefined();
    expect(patterns.blocks[1]!.text).toContain(
      "文学里的相逢，可以从一句诗、一个细节开始",
    );
    expect(patterns.blocks[1]!.text).not.toMatch(
      /你愿意|看见你|本轮|选择记录/u,
    );
    expect(qianzaiConsumerCopyText()).toContain(patterns.blocks[1]!.text);
    const html = renderToStaticMarkup(
      createElement(QianzaiReportReader, {
        document: d,
        onResult: () => {},
        actions: null,
      }),
    );
    expect(html.split(patterns.blocks[1]!.text)).toHaveLength(2);
    expect(section(d, "encounter").blocks).toHaveLength(2);
    expect(section(d, "encounter").blocks[0]!.snapshot).toBeUndefined();
    expect(section(d, "encounter").blocks[0]!.text).toContain("李清照");
    expect(section(d, "closure").blocks[0]!.text).toBe(
      "这一卷不替你定下结论，先留一个与自己相处的时刻。",
    );
    expect(section(d, "closure").blocks).toHaveLength(3);
    f.body.volumes[2]!.paragraphs[0]!.status = "accepted";
    const supportedPatterns = section(document(f), "patterns").blocks;
    expect(supportedPatterns).toHaveLength(1);
    expect(supportedPatterns[0]!.layout).toBe("card");
    expect(supportedPatterns[0]!.text).not.toBe(patterns.blocks[0]!.text);
  });
  it("connects each role to supported choices in the third chapter, shared by web and full PNG, without changing the score body", async () => {
    const anchors = {
      "li-bai": "名山江流与长风关山",
      "su-shi": "诗词、文章与书画",
      "tao-yuanming": "采菊、南山、暮色与归鸟",
      "li-qingzhao": "溪亭旧游",
      "mulan-ballad": "关山远行",
    };
    for (const [role, anchor] of Object.entries(anchors)) {
      const f = await fixture(role),
        before = structuredClone(f.body),
        d = document(f);
      const connection = section(d, "patterns"),
        themes = qianzaiSupportedThemes(f.body);
      expect(d.sections).toHaveLength(6);
      expect(d.sections[2]).toBe(connection);
      expect(connection.title).toBe(`你为什么像${d.name}`);
      expect(connection.intro).toContain("不代表完整人格相同");
      expect(connection.blocks[0]!.text).toContain(anchor);
      const html = renderToStaticMarkup(
        createElement(QianzaiReportReader, {
          document: d,
          onResult: () => {},
          actions: null,
        }),
      );
      const print = qianzaiExportText(
        f.body,
        "full-report",
        d.resultPresentation,
      ).join("\n");
      expect(html).toContain(connection.title);
      expect(print).toContain(connection.title);
      for (const [i, b] of connection.blocks.entries()) {
        const [observed, literary, practical] = b.text.split("\n\n");
        expect(observed).toBe(themes[i]!.feature.text);
        expect(literary!.length).toBeGreaterThan(30);
        expect(practical!.length).toBeGreaterThan(30);
        expect(html).toContain(literary);
        expect(print).toContain(b.text);
        expect(qianzaiConsumerCopyText()).toContain(literary);
      }
      expect(displayText(d)).not.toMatch(/RAW_|Q\d{2}|authored-|accepted/u);
      expect(f.body).toEqual(before);
      // Even a perfect numeric profile cannot manufacture literary links once
      // the existing accepted support is absent.
      f.body.dimensions.forEach((dim) => {
        dim.score = 100;
      });
      f.body.volumes[2]!.paragraphs.forEach((p) => {
        p.status = "facts-only";
      });
      const neutral = document(f),
        blocks = section(neutral, "patterns").blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks.every((b) => b.snapshot === undefined)).toBe(true);
      expect(blocks[0]!.text).toContain("不替你补上性格标签");
      expect(blocks[0]!.text).toContain("五个选择方向的整体组合");
      for (const b of connection.blocks)
        expect(blocks.map((b) => b.text).join("")).not.toContain(
          b.text.split("\n\n")[1],
        );
      expect(neutral.identity!.tags).toEqual([]);
      expect(neutral.dimensions).toBe(f.body.dimensions);
    }
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
    expect(
      section(d, "patterns").blocks.map((b) => b.text.split("\n\n")[0]),
    ).toEqual(themes.map((t) => t.feature.text));
    expect(
      section(d, "patterns").blocks.every(
        (b) => b.text.split("\n\n").length === 3,
      ),
    ).toBe(true);
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
  it("restores fixed biographies before closure with identity banners, three sourced rows and complete shared print text independent of theme support", async () => {
    for (const role of [
      "li-bai",
      "su-shi",
      "tao-yuanming",
      "li-qingzhao",
      "mulan-ballad",
    ]) {
      const f = await fixture(role),
        before = structuredClone(f.body),
        d = document(f);
      const history = section(d, "literature"),
        rows = history.blocks.filter((b) => b.layout === "timeline");
      expect(d.sections.map((s) => s.id)).toEqual([
        "encounter",
        "dimensions",
        "patterns",
        "counterevidence",
        "literature",
        "closure",
      ]);
      expect(history.title).toContain("小传");
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((b) => b.title)).size).toBe(3);
      expect(history.blocks.filter((b) => b.layout === "source")).toHaveLength(
        1,
      );
      expect(history.blocks.at(-1)!.text).toContain("艺术想象");
      expect(d.identity!.lifespan).toBeTruthy();
      const html = renderToStaticMarkup(
        createElement(QianzaiReportReader, {
          document: d,
          onResult: () => {},
          actions: null,
        }),
      );
      expect(html).toContain(d.identity!.lifespan!);
      if (role === "mulan-ballad") {
        expect(d.identity!.lifespan).toContain("文学与传说");
        expect(d.identity!.lifespan).not.toMatch(/\d/u);
        expect(history.blocks.at(-1)!.text).toContain("佚名");
        expect(d.identity!.courtesyName).toBeUndefined();
      } else expect(d.identity!.courtesyName).toBeTruthy();
      const printText = qianzaiExportText(
        f.body,
        "full-report",
        d.resultPresentation,
      ).join("\n");
      for (const b of history.blocks) expect(printText).toContain(b.text);
      expect(history.blocks[0]!.layout).toBe("lead");
      expect(history.blocks[0]!.title).toBe(d.name);
      expect(history.blocks[0]!.text).toContain(d.identity!.lifespan!);
      expect(printText).toContain(d.identity!.lifespan!);
      expect(f.body).toEqual(before);
      f.body.volumes[2]!.paragraphs.forEach((p) => {
        p.status = "facts-only";
      });
      f.body.volumes[3]!.paragraphs = [];
      expect(section(document(f), "literature")).toEqual(history);
    }
  });
  it("adds one practical paragraph only to accepted themes and closes with three distinct sentences without manufacturing neutral traits", async () => {
    const f = await fixture(),
      d = document(f),
      cards = section(d, "patterns").blocks;
    const printText = qianzaiExportText(
      f.body,
      "full-report",
      d.resultPresentation,
    ).join("\n");
    const html = renderToStaticMarkup(
      createElement(QianzaiReportReader, {
        document: d,
        onResult: () => {},
        actions: null,
      }),
    );
    expect(cards).toHaveLength(3);
    const renderedCardBodies = [
      ...html.matchAll(
        /<div class="[^"]*rp-res-body[^"]*">([\s\S]*?)<\/div>/gu,
      ),
    ];
    expect(
      renderedCardBodies.map(
        (match) => (match[1]!.match(/<p>/gu) ?? []).length,
      ),
    ).toEqual([3, 3, 3]);
    for (const card of cards) {
      const parts = card.text.split("\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[1]!.length).toBeGreaterThan(30);
      expect(printText).toContain(card.text);
      expect(html).toContain(parts[1]);
      expect(card.snapshot!.status).toBe("accepted");
    }
    const closing = section(d, "closure").blocks.map((b) => b.text);
    expect(closing).toHaveLength(3);
    expect(new Set(closing).size).toBe(3);
    expect(closing[0]).toContain("投入");
    expect(closing[1]).toContain("因事而变");
    expect(closing[2]).toContain("开始");
    f.body.volumes[2]!.paragraphs.forEach((p) => {
      p.status = "facts-only";
    });
    f.body.volumes[3]!.paragraphs = [];
    const neutral = document(f);
    expect(section(neutral, "patterns").blocks[0]!.layout).toBe("body");
    expect(section(neutral, "patterns").blocks[0]!.snapshot).toBeUndefined();
    expect(section(neutral, "patterns").blocks[1]!.text).toContain("不妨问问");
    expect(section(neutral, "counterevidence").blocks[0]!.text).toContain(
      "先问问",
    );
    expect(section(neutral, "closure").blocks).toHaveLength(3);
    expect(section(neutral, "closure").blocks[1]!.text).toContain("不妨问问");
    expect(section(neutral, "closure").blocks[2]!.text).toContain("十分钟");
    expect(neutral.resultPresentation!.poster.tags).toEqual([]);
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
    expect(html.split("词中的旧游与梦境")).toHaveLength(2);
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
