/** Local content review only. Every candidate is a complete authored-option input
 * passed through the real scorer/composer. This module grants no session/DB authority. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import finalSource from "@/features/quizpack/content/private-test-registration-final-e2e.json";
import fixedSource from "@/features/quizpack/content/qianzai-local-export-parity-fixture.json";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  quizPackContentV3Schema,
  type QuizPackContentV3,
} from "@/features/quizpack/content/v3";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import { projectPreparedResultV3 } from "@/features/theme/preview/v3-projection";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { deriveQianzaiResultPresentation } from "@/features/report/qianzai-tongxin/result-presentation";
import { qianzaiSnapshotDocument } from "@/features/report/qianzai-tongxin/presentation";
import { qianzaiDimensionScale } from "@/features/report/qianzai-tongxin/dimension-scale";
import { qianzaiSupportedThemes } from "@/features/report/qianzai-tongxin/supported-themes";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
} from "@/features/report/qianzai-tongxin/role-profiles-v11";
import { QIANZAI_CONSUMER_RENDERER } from "@/features/theme/qianzai-tongxin/component-map";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";

export const contentReviewScope =
  "local-synthetic-inputs-real-score-composer-no-database-no-author-acceptance";
export const reviewSourceSha256 = fixedSource.canonicalContentSha256;
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalP1Json(value)).digest("hex");
type Answers =
  QuizPackContentV3["bindings"]["witnesses"]["entries"][number]["answers"];
export function reviewInput(content: QuizPackContentV3, answers: Answers) {
  return {
    schemaVersion: "quiz-scoring-input.v2" as const,
    answers,
    matchingContext: {
      schemaVersion: "quiz-matching-context.v1" as const,
      policyRef: content.core.scoringDefinition.matchingPolicy.ref,
      preference: "any" as const,
    },
  };
}
export function verifyReviewContent(input: unknown) {
  const content = quizPackContentV3Schema.parse(input);
  if (
    ![reviewSourceSha256, finalSource.canonicalContentSha256].includes(
      hash(content),
    )
  )
    throw Error("CONTENT_REVIEW_UNKNOWN_SOURCE");
  if (
    content.core.questions.length !== 24 ||
    new Set(content.core.questions.map((q) => q.ref.id)).size !== 24
  )
    throw Error("CONTENT_REVIEW_REQUIRES_24_QUESTIONS");
  return content;
}
export async function loadReviewContent(source: string) {
  if (!path.isAbsolute(source))
    throw Error("CONTENT_REVIEW_ABSOLUTE_SOURCE_REQUIRED");
  return verifyReviewContent(
    JSON.parse(await readFile(path.join(source, "content.json"), "utf8")),
  );
}
function completeAnswers(content: QuizPackContentV3, answers: Answers) {
  return (
    answers.length === 24 &&
    new Set(answers.map((a) => a.questionId)).size === 24 &&
    content.core.questions.every((q) =>
      answers.some(
        (a) =>
          a.questionId === q.ref.id &&
          q.options.some((o) => o.ref.id === a.optionId),
      ),
    )
  );
}
export async function buildQianzaiContentReview(input: unknown) {
  const content = verifyReviewContent(input);
  const prepared = prepareContentV3(content);
  if (!prepared.ok) throw Error("CONTENT_REVIEW_PREPARE_FAILED");
  const renderer = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai;
  if (!renderer || renderer.version !== QIANZAI_CONSUMER_RENDERER.version)
    throw Error("CONTENT_REVIEW_RENDERER_REQUIRED");
  const base = (await qianzaiExportFixture()).model.report!.view;
  const compose = (answers: Answers, origin: string) => {
    if (!completeAnswers(content, answers))
      throw Error("CONTENT_REVIEW_INCOMPLETE_ANSWERS");
    const scoringInput = reviewInput(content, answers);
    const projected = projectPreparedResultV3(prepared.value, scoringInput);
    if (!projected.ok) throw Error("CONTENT_REVIEW_COMPOSITION_FAILED");
    const { display, score } = projected.value;
    const roleId = score.score.decision.selectedResultRef.id;
    if (
      display.selectedResultRef.id !== roleId ||
      display.body.matching.selected.ref.id !== roleId ||
      hash(display.body) !== display.bodySha256
    )
      throw Error("CONTENT_REVIEW_RESULT_IDENTITY_MISMATCH");
    const presentation = deriveQianzaiResultPresentation(
      { ...base, renderer, display },
      { renderer, profileVersion: QIANZAI_PRESENTATION_V11 },
    );
    if (!presentation) throw Error("CONTENT_REVIEW_PRESENTATION_UNBOUND");
    const document = qianzaiSnapshotDocument(
      display.body,
      undefined,
      presentation,
    );
    if (!document.consumerEdition || document.sections.length !== 6)
      throw Error("CONTENT_REVIEW_DOCUMENT_INCOMPLETE");
    const themes = qianzaiSupportedThemes(display.body).map((t) => ({
      topic: t.feature.topic,
      tag: t.feature.tag,
      claimRef: t.snapshot.claimRef,
    }));
    const reflection = document.sections.find(
      (s) => s.id === "counterevidence",
    )!;
    const reflectionSupportCount = reflection.blocks.filter(
      (b) => b.snapshot,
    ).length;
    const chapterBlocks = document.sections.flatMap((c) =>
      c.blocks.map((b) => ({ chapter: c.id, text: b.text })),
    );
    const repeatedBlocks = chapterBlocks.filter((b, i) =>
      chapterBlocks.slice(0, i).some((p) => p.text === b.text),
    );
    const consumerText = document.sections
      .flatMap((c) => [c.title, c.intro ?? "", ...c.blocks.map((b) => b.text)])
      .join("\n");
    const signature = hash({
      themes,
      reflection: reflection.blocks.map((b) => b.text),
      dimensions: document.sections
        .find((s) => s.id === "dimensions")!
        .blocks.map((b) => b.text),
    });
    return {
      roleId,
      origin,
      checks: {
        reflectionSupportCount,
        neutralNarrative: themes.length === 0 && reflectionSupportCount === 0,
        revealPosterSame:
          JSON.stringify(presentation.reveal.lines) ===
          JSON.stringify(presentation.poster.lines),
        personalTagsSame:
          JSON.stringify(document.identity?.tags) ===
          JSON.stringify(presentation.poster.tags),
        repeatedTopicCount:
          themes.length - new Set(themes.map((t) => t.topic)).size,
        repeatedChapterBlocks: repeatedBlocks,
        consumerQuestionMarkers: /Q\d{2}|q\d{2}-[a-d]|facts-only|RAW_/u.test(
          consumerText,
        ),
        axisPositions: display.body.dimensions.map((d) => ({
          id: d.dimensionRef.id,
          score: d.score,
          position:
            qianzaiDimensionScale(d, display.canonicalContentSha256)
              ?.position ?? "unknown",
        })),
      },
      input: scoringInput,
      signature,
      logicHash: display.logicHash,
      inputHash: display.inputHash,
      answersHash: display.answersHash,
      bodySha256: display.bodySha256,
      selected: score.score.decision.rankings[0]!,
      decision: score.score.decision,
      dimensions: display.body.dimensions,
      themes,
      quote: presentation.quote,
      honorific: presentation.role.honorific,
      reveal: presentation.reveal,
      poster: presentation.poster,
      document: {
        name: document.name,
        subtitle: document.subtitle,
        identity: document.identity,
        legal: document.legal,
        sections: document.sections.map((s) => ({
          id: s.id,
          title: s.title,
          intro: s.intro,
          blocks: s.blocks.map((b) => ({
            title: b.title,
            text: b.text,
            layout: b.layout,
            citation: b.citation,
          })),
        })),
      },
      audit: display.body.volumes.map((v) => ({
        id: v.id,
        paragraphs: v.paragraphs.map((p) => ({
          claimRef: p.claimRef,
          kind: p.kind,
          status: p.status,
          evidence: p.evidence.map((e) => e.optionRef.id),
          counterevidence: p.counterevidence.map((e) => e.optionRef.id),
        })),
      })),
    };
  };
  type Candidate = ReturnType<typeof compose>;
  const candidates: Candidate[] = [],
    seen = new Set<string>();
  const consider = (answers: Answers, origin: string) => {
    const key = hash(answers);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(compose(answers, origin));
  };
  const witnesses = content.bindings.witnesses.entries;
  for (const role of QIANZAI_ROLE_PROFILES_V11) {
    const witness = witnesses.find(
      (w) => w.expectedResultRef.id === role.ref.id,
    );
    if (!witness || !completeAnswers(content, witness.answers))
      throw Error("CONTENT_REVIEW_WITNESS_MISSING");
    consider(witness.answers, "fixed-authored-test-witness");
    if (candidates.at(-1)!.roleId !== role.ref.id)
      throw Error("CONTENT_REVIEW_WITNESS_MISMATCH");
  }
  // Exhaust each witness's one-option neighbourhood, followed by a fixed seeded
  // pool. No selected role, score, claim, or composed paragraph is ever edited.
  for (const witness of witnesses)
    for (const question of content.core.questions)
      for (const option of question.options) {
        consider(
          witness.answers.map((a) =>
            a.questionId === question.ref.id
              ? { ...a, optionId: option.ref.id }
              : a,
          ),
          "single-option-witness-neighbour",
        );
      }
  let seed = 0x51465a;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 256; i++)
    consider(
      content.core.questions.map((q) => ({
        questionId: q.ref.id,
        optionId: q.options[(random() >>> 12) % q.options.length]!.ref.id,
      })),
      "seeded-complete-synthetic-input",
    );
  const samples: Array<Candidate & { id: string }> = [];
  const coverage = QIANZAI_ROLE_PROFILES_V11.map((role) => {
    const pool = candidates.filter((c) => c.roleId === role.ref.id);
    const a = pool[0]!;
    if (!a) throw Error("CONTENT_REVIEW_ROLE_UNREACHABLE");
    const alternatives = pool.filter(
      (c) => c.signature !== a.signature && c.answersHash !== a.answersHash,
    );
    // Prefer another supported theme mix, then another poem. Keep a separate
    // genuinely neutral example rather than making every B sample unsupported.
    const b = [...alternatives].sort(
      (x, y) =>
        Number(y.themes.length > 0) - Number(x.themes.length > 0) ||
        Number(JSON.stringify(y.themes) !== JSON.stringify(a.themes)) -
          Number(JSON.stringify(x.themes) !== JSON.stringify(a.themes)) ||
        Number(y.quote.id !== a.quote.id) - Number(x.quote.id !== a.quote.id) ||
        x.themes.length - y.themes.length ||
        x.answersHash.localeCompare(y.answersHash),
    )[0];
    if (!b)
      throw Error(
        "CONTENT_REVIEW_SECOND_REACHABLE_RESULT_MISSING:" + role.ref.id,
      );
    samples.push(
      { ...a, id: role.ref.id + "-a" },
      { ...b, id: role.ref.id + "-b" },
    );
    const unsupported =
      pool.find((c) => c.checks.neutralNarrative) ??
      pool.find((c) => c.themes.length === 0);
    if (
      unsupported &&
      ![a.answersHash, b.answersHash].includes(unsupported.answersHash)
    )
      samples.push({ ...unsupported, id: role.ref.id + "-neutral" });
    const selected = samples.filter((s) => s.roleId === role.ref.id);
    return {
      roleId: role.ref.id,
      reachableCandidates: pool.length,
      samples: selected.map((s) => s.id),
      distinctNarratives: new Set(pool.map((c) => c.signature)).size,
      zeroThemeCandidates: pool.filter((c) => c.themes.length === 0).length,
      fullNeutralCandidates: pool.filter((c) => c.checks.neutralNarrative)
        .length,
      quoteIds: [...new Set(selected.map((s) => s.quote.id))],
      compiledQuoteIds: role.quotes.map((q) => q.id),
    };
  });
  const directSources: Record<string, string> = {
    "tao-yuanming": "https://zh.wikisource.org/wiki/陶淵明集/卷三",
    "mulan-ballad": "https://zh.wikisource.org/wiki/木蘭辭",
  };
  const profiles = QIANZAI_ROLE_PROFILES_V11.map((role) => ({
    id: role.ref.id,
    name: role.displayName,
    honorific: role.honorific,
    lifespan: role.lifespan,
    courtesyName: role.courtesyName,
    kind: content.core.scoringDefinition.profiles.find(
      (p) => p.resultRef.id === role.ref.id,
    )?.kind,
    identitySubtitle: role.identitySubtitle,
    fixedLiteraryTags: role.tags,
    supplementalSourceUrl: directSources[role.ref.id] ?? null,
    posterTagline: role.posterTagline,
    quotes: role.quotes.map((q) => ({
      ...q,
      hanCharacters: [...q.text].filter((c) => /\p{Script=Han}/u.test(c))
        .length,
    })),
  }));
  const gaps = [
    ...coverage
      .filter((c) => c.zeroThemeCandidates === 0)
      .map((c) => `${c.roleId}：本次有界搜索未找到零主题结果，不代表不可达。`),
    ...coverage
      .filter((c) => c.quoteIds.length < c.compiledQuoteIds.length)
      .map(
        (c) =>
          `${c.roleId}：展示样例未覆盖全部诗句；完整编译期诗句仍列于人物资料。`,
      ),
  ];
  const contentCandidates = reviewEditorialCandidates(profiles);
  return {
    schemaVersion: "qianzai.content-review.v1",
    scope: contentReviewScope,
    sourceSha256: hash(content),
    renderer,
    logicHash: candidates[0]!.logicHash,
    contentCandidates,
    reviewGates: {
      contentAndHonorifics: "awaiting-author-finalization",
      nameArtBatch: "not-generated",
      browser: "main-controller-owned",
      supplementalSources:
        "provided-and-checked-by-main-2026-11-02-generator-does-not-fetch",
    },
    search: {
      seed: "0x51465a",
      randomInputs: 256,
      totalScoredInputs: candidates.length,
      exhaustive: false,
      preferences: ["any"],
    },
    profiles,
    coverage,
    gaps,
    samples,
    questions: content.core.questions,
  };
}
export type QianzaiContentReview = Awaited<
  ReturnType<typeof buildQianzaiContentReview>
>;

/** Complete review-only proposals. These never feed production presentation. */
function reviewEditorialCandidates(
  profiles: readonly {
    id: string;
    name: string;
    identitySubtitle: string;
    honorific: string;
    posterTagline: string;
  }[],
) {
  const subtitles: Record<string, string> = {
    "li-bai": "从山河与明月，走近李白的诗境。",
    "su-shi": "从途中风雨，走近苏轼的词境。",
    "tao-yuanming": "从东篱与南山，走近陶渊明的诗境。",
    "li-qingzhao": "从溪亭旧游与云涛星河，走近李清照的词境。",
    "mulan-ballad": "从关山远行与归家换装，走进《木兰诗》。",
  };
  const neutralDrafts: Record<string, readonly string[]> = {
    "li-bai": [
      "愿你走过山河，仍愿抬头看月亮。",
      "让眼前的一次停留，也成为风景。",
      "往后的路，照自己的步调走。",
    ],
    "mulan-ballad": [
      "愿你出发时，知道自己为何而行。",
      "行至远处，也记得照顾日常。",
      "归来以后，仍有想认真过的生活。",
    ],
  };
  return {
    status: "review-only-awaiting-author-not-applied",
    subtitles: profiles.map((p) => ({
      roleId: p.id,
      name: p.name,
      current: p.identitySubtitle,
      candidate: subtitles[p.id]!,
    })),
    neutralLines: profiles
      .filter((p) => Object.hasOwn(neutralDrafts, p.id))
      .map((p) => {
        const role = QIANZAI_ROLE_PROFILES_V11.find((r) => r.ref.id === p.id)!;
        return {
          roleId: p.id,
          name: p.name,
          current: [...role.baseLines, role.invitation],
          candidate: neutralDrafts[p.id]!,
        };
      }),
    fixedUses: profiles.map((p) => ({
      name: p.name,
      honorific: p.honorific,
      posterTagline: p.posterTagline,
    })),
    fixedUseAdvice:
      "人物称号用于身份，海报题签用于文学氛围：两者固定、用途不同，建议保留；都不作为答案推断的个人特点。",
  };
}

const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function reviewDemoOrigin(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw Error("CONTENT_REVIEW_LOOPBACK_DEMO_REQUIRED");
  return url.origin;
}
export function renderQianzaiContentReview(
  review: QianzaiContentReview,
  demoOrigin: string,
) {
  const origin = reviewDemoOrigin(demoOrigin);
  const e = escapeHtml;
  const proposals = reviewEditorialCandidates(review.profiles);
  const proposalPanel = `<details class="editorial-proposals"><summary>待作者定稿：五条文学引导、两组三行短句</summary><p>以下仅为验收页候选，生产文案未更改。</p><h3>固定副标题：改为中性文学引导</h3><div class="table-wrap"><table><thead><tr><th>人物</th><th>现文</th><th>完整候选</th></tr></thead><tbody>${proposals.subtitles.map((p) => `<tr><th>${e(p.name)}</th><td>${e(p.current)}</td><td>${e(p.candidate)}</td></tr>`).join("")}</tbody></table></div><h3>中性三行短句：去掉相邻重复</h3><div class="table-wrap"><table><thead><tr><th>人物</th><th>现有三行</th><th>完整三行候选</th></tr></thead><tbody>${proposals.neutralLines.map((p) => `<tr><th>${e(p.name)}</th><td>${p.current.map((l) => e(l)).join("<br>")}</td><td>${p.candidate.map((l) => e(l)).join("<br>")}</td></tr>`).join("")}</tbody></table></div><h3>称号与题签：固定用途可保留</h3><p>${e(proposals.fixedUseAdvice)}</p><p>${proposals.fixedUses.map((p) => `${e(p.name)}：${e(p.honorific)}／${e(p.posterTagline)}`).join("；")}。</p></details>`;
  const profileRows = review.profiles
    .map(
      (p) =>
        `<tr><th>${e(p.name)} · ${e(p.honorific)}</th><td>${e(p.kind)}<br>${e(p.lifespan ?? "未提供固定生平标签")}<br>${e(p.courtesyName)}</td><td>${e(p.identitySubtitle)}<br><small>固定文学资料：${p.fixedLiteraryTags.map(e).join(" · ")}；不作为个人特点</small></td><td>${p.quotes.map((q) => `${e(q.text)}（${q.hanCharacters}汉字）<br><a href="${e(q.sourceUrl)}" target="_blank" rel="noreferrer">${e(q.source)}</a>`).join("<hr>")}${p.supplementalSourceUrl ? `<hr><a href="${e(p.supplementalSourceUrl)}" target="_blank" rel="noreferrer">主控补充核对的直接原文</a>` : ""}</td></tr>`,
    )
    .join("");
  const overview = review.samples
    .map(
      (s) =>
        `<tr data-review-role="${e(s.roleId)}"><th><a href="#${e(s.id)}">${e(s.document.name)} · ${e(s.id.split("-").at(-1))}</a></th><td>${s.selected.narrativeIndex}%</td><td>${s.themes.length ? s.themes.map((t) => e(t.tag)).join(" · ") : s.checks.neutralNarrative ? "中性文学回退" : "同心无主题；映照仍按支持"}</td><td>${e(s.quote.text)}</td><td>${s.dimensions.map((d) => `${e(d.label)} ${d.score}`).join(" · ")}</td></tr>`,
    )
    .join("");
  const cards = review.samples
    .map((s) => {
      const p = review.profiles.find((p) => p.id === s.roleId)!;
      const href = `${origin}/?review-report=reveal&role=${encodeURIComponent(s.roleId)}&sample=${encodeURIComponent(s.id)}`;
      const chapter = s.document.sections
        .map(
          (c) =>
            `<details open><summary>${e(c.title)}</summary>${c.intro ? `<p class="intro">${e(c.intro)}</p>` : ""}${c.blocks.map((b) => `<div class="block ${e(b.layout)}">${b.title ? `<h4>${e(b.title)}</h4>` : ""}<p>${e(b.text)}</p>${b.citation ? `<small>${e(b.citation)}</small>` : ""}</div>`).join("")}</details>`,
        )
        .join("");
      const evidence = s.input.answers
        .map((a) => {
          const q = review.questions.find((q) => q.ref.id === a.questionId)!;
          const o = q.options.find((o) => o.ref.id === a.optionId)!;
          return `<tr><th>${e(a.questionId)}</th><td>${e(q.prompt)}</td><td>${e(o.label)}</td></tr>`;
        })
        .join("");
      return `<article data-role="${e(s.roleId)}" data-review-role="${e(s.roleId)}" id="${e(s.id)}"><header><h2>${e(p.name)} · ${e(s.id)}</h2><p>${s.themes.length ? s.themes.map((t) => e(t.tag)).join(" · ") : s.checks.neutralNarrative ? "无个性化主题／映照支持：中性文学回退" : "同心无主题支持；映照仍按自身支持生成"} · 实际契合指数 ${s.selected.narrativeIndex}%</p><a class="button" href="${e(href)}" target="_blank" rel="noreferrer">打开此样例的真实 demo</a></header><div class="carriers"><section><h3>揭晓短句</h3><p class="fixed">固定称号：${e(s.honorific)}</p><blockquote>${e(s.quote.text)}<cite>${e(s.quote.source)}</cite></blockquote>${s.reveal.lines.map((l) => `<p>${e(l)}</p>`).join("")}</section><section><h3>海报主线</h3><p class="fixed">固定题签：${e(s.poster.tagline)}</p>${s.poster.lines.map((l) => `<p>${e(l)}</p>`).join("")}<p>个人特点：${s.poster.tags.length ? s.poster.tags.map(e).join(" · ") : "无；不补第三特点"}</p></section><section class="report"><h3>网页／长图共享六卷正文</h3><p class="fixed">固定文学副标题：${e(s.document.subtitle)}</p>${chapter}<small>${e(s.document.legal)}</small></section></div><details class="research"><summary>合成依据与覆盖说明（24题、评分身份、主题支持）</summary><p>输入来源：${e(s.origin)}；偏好 any。所有答案均从受控选项生成，未经角色或分数改写。</p><p>inputHash ${e(s.inputHash)}<br>answersHash ${e(s.answersHash)}<br>bodySha256 ${e(s.bodySha256)}</p><p>五维实际分值：${s.dimensions.map((d) => `${e(d.label)} ${d.score}`).join(" · ")}</p><pre>${e(JSON.stringify({ checks: s.checks, themes: s.themes, decision: s.decision, audit: s.audit }, null, 2))}</pre><div class="table-wrap"><table><tbody>${evidence}</tbody></table></div></details></article>`;
    })
    .join("");
  const data = JSON.stringify(review).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千载同心 · 五角色内容验收</title><style>*{box-sizing:border-box}body{margin:0;overflow-wrap:anywhere;background:#f6f1e7;color:#263647;font:16px/1.8 system-ui}main{width:100%;max-width:1500px;min-width:0;margin:auto;padding:24px}.hash{font:inherit;overflow-wrap:anywhere;word-break:break-all}h1{font-size:30px}h2{font-size:23px}h3{font-size:20px}h4{font-size:17px;margin:12px 0 4px}p{margin:8px 0}small,.fixed,.intro{color:#655d53}nav{position:sticky;top:0;background:#f6f1e7ed;padding:12px 0;z-index:2;display:flex;gap:8px;flex-wrap:wrap}button,.button{min-height:44px;padding:8px 14px;border:1px solid #8a704b;border-radius:7px;color:#314657;background:#fffaf0;font:inherit;text-decoration:none;cursor:pointer}button[aria-pressed=true]{background:#314657;color:white}article{margin:24px 0;padding:22px;background:#fffdf8;border:1px solid #d4c4a9;border-radius:12px;scroll-margin-top:95px}.carriers{display:grid;grid-template-columns:minmax(210px,1fr) minmax(210px,1fr) minmax(320px,2fr);gap:20px}.carriers>section{min-width:0;padding:0 12px;border-left:2px solid #e5d9c6}.block{margin:14px 0}blockquote{margin:12px 0;padding:12px;background:#f7efdf}cite{display:block;font-size:14px}details{padding:10px 0;border-bottom:1px solid #e7ddce}summary{cursor:pointer;min-height:44px;font-weight:600}table{border-collapse:collapse;width:100%;font-size:15px}td,th{padding:10px;border:1px solid #d7cbb8;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.research{background:#f3efe8;padding:12px;margin-top:18px}.research p{overflow-wrap:anywhere}.notice{padding:14px;background:#ede4d5}.table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto}.table-wrap table{min-width:680px}.editorial-proposals{margin:16px 0;padding:12px;background:#f0e6d5;border:1px solid #cdbb9d;border-radius:8px}article[hidden]{display:none}@media(max-width:900px){.carriers{grid-template-columns:1fr}main{padding:14px}article{padding:14px}nav{position:static}}</style></head><body><main><h1>千载同心 · 五角色内容验收</h1><p class="notice">本页是本地研究验收工具，不是消费者产品界面。当前首个人工闸门：五角色内容与称号定稿；尚未批量生成人名图。${review.samples.length} 份完整24题合成输入，经真实评分、composer、presentation 和 consumer-copy 生成；未写数据库、未改角色或分值，尚未代表作者内容验收或实际浏览器通过。</p><p>受控源 <code class="hash">${e(review.sourceSha256)}</code> · 有界搜索 ${review.search.totalScoredInputs} 份输入；只覆盖偏好 any，不证明穷尽所有可达结果。</p><nav aria-label="角色筛选"><button data-filter="all" aria-pressed="true">全部样例</button>${review.profiles.map((p) => `<button data-filter="${e(p.id)}" aria-pressed="false">${e(p.name)} · 同角色对比</button>`).join("")}</nav>${proposalPanel}<section aria-label="样例与主题总览"><h2>同角色样例与主题总览</h2><div class="table-wrap"><table><thead><tr><th>跳转样例</th><th>实际契合</th><th>受支持主题</th><th>本次诗句</th><th>五维分值</th></tr></thead><tbody>${overview}</tbody></table></div></section><details><summary>固定人物资料与诗句出处（与答案解读分列）</summary><div class="table-wrap"><table><thead><tr><th>人物与称号</th><th>历史／文学类型</th><th>固定文学介绍</th><th>诗句／编译期出处／长度</th></tr></thead><tbody>${profileRows}</tbody></table></div><p>出处链接为现有 profile 的来源线索；本地生成不请求外网，也不把文学形象当成答题能力或人格事实。</p></details><details><summary>覆盖与限制</summary><pre>${e(JSON.stringify({ search: review.search, coverage: review.coverage, gaps: review.gaps, contentCandidates: review.contentCandidates, reviewGates: review.reviewGates }, null, 2))}</pre><p>网页与长图共用下方六卷文案；海报与揭晓共用短句。此页用于内容比较，原型版式与真实PNG仍需在 demo 中验收。</p></details>${cards}<script type="application/json" id="content-review-data">${data}</script><script>for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{for(const b of document.querySelectorAll('[data-filter]'))b.setAttribute('aria-pressed',String(b===button));for(const card of document.querySelectorAll('[data-review-role]'))card.hidden=button.dataset.filter!=='all'&&card.dataset.reviewRole!==button.dataset.filter;});</script></main></body></html>`;
}
