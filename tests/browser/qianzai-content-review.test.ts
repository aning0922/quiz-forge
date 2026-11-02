/** Local-only evidence test. Invoke with explicit private fixture and generated
 * review artifact; this is deliberately outside the production unit-test discovery glob. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { before, test } from "node:test";
import {
  loadReviewContent,
  renderQianzaiContentReview,
  reviewDemoOrigin,
  verifyReviewContent,
  type QianzaiContentReview,
} from "./qianzai-content-review";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import { projectPreparedResultV3 } from "@/features/theme/preview/v3-projection";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { deriveQianzaiResultPresentation } from "@/features/report/qianzai-tongxin/result-presentation";
import { qianzaiSnapshotDocument } from "@/features/report/qianzai-tongxin/presentation";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
} from "@/features/report/qianzai-tongxin/role-profiles-v11";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";
let review: QianzaiContentReview;
let content: Awaited<ReturnType<typeof loadReviewContent>>;
before(async () => {
  const source = process.env.QZTX_CONTENT_REVIEW_SOURCE,
    artifact = process.env.QZTX_CONTENT_REVIEW_JSON;
  if (!source || !artifact)
    throw Error("EXPLICIT_LOCAL_REVIEW_SOURCE_AND_ARTIFACT_REQUIRED");
  content = await loadReviewContent(source);
  review = JSON.parse(await readFile(artifact, "utf8"));
});
test("rejects changed/unknown source identity and non-loopback demo origins", () => {
  const changed = structuredClone(content);
  changed.core.title += " changed";
  assert.throws(
    () => verifyReviewContent(changed),
    /CONTENT_REVIEW_UNKNOWN_SOURCE/u,
  );
  for (const origin of [
    "https://127.0.0.1:63220",
    "http://example.com",
    "http://user@127.0.0.1:63220",
    "http://127.0.0.1:63220/other",
  ])
    assert.throws(
      () => reviewDemoOrigin(origin),
      /CONTENT_REVIEW_LOOPBACK_DEMO_REQUIRED/u,
    );
});
test("replays every complete 24-answer sample through the actual score/composer and bound presentation without role/score overrides", async () => {
  const prepared = prepareContentV3(content);
  assert.equal(prepared.ok, true);
  if (!prepared.ok) return;
  const renderer = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
  const base = (await qianzaiExportFixture()).model.report!.view;
  for (const s of review.samples) {
    assert.equal(s.input.answers.length, 24);
    assert.equal(new Set(s.input.answers.map((a) => a.questionId)).size, 24);
    const result = projectPreparedResultV3(prepared.value, s.input);
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    const { display, score } = result.value;
    assert.equal(score.score.decision.selectedResultRef.id, s.roleId);
    assert.equal(display.body.matching.selected.ref.id, s.roleId);
    assert.deepEqual(score.score.decision, s.decision);
    assert.deepEqual(display.body.dimensions, s.dimensions);
    assert.equal(display.bodySha256, s.bodySha256);
    assert.equal(display.answersHash, s.answersHash);
    assert.equal(display.inputHash, s.inputHash);
    const presentation = deriveQianzaiResultPresentation(
      { ...base, renderer, display },
      { renderer, profileVersion: QIANZAI_PRESENTATION_V11 },
    );
    assert.ok(presentation);
    assert.deepEqual(presentation.reveal, s.reveal);
    assert.deepEqual(presentation.poster, s.poster);
    const doc = qianzaiSnapshotDocument(display.body, undefined, presentation);
    assert.deepEqual(
      doc.sections.map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.intro ? { intro: c.intro } : {}),
        blocks: c.blocks.map((b) => ({
          ...(b.title ? { title: b.title } : {}),
          text: b.text,
          layout: b.layout,
          ...(b.citation ? { citation: b.citation } : {}),
        })),
      })),
      s.document.sections,
    );
    const broken = structuredClone(s.input);
    broken.answers.pop();
    assert.equal(projectPreparedResultV3(prepared.value, broken).ok, false);
  }
});
test("provides five actual role pairs and genuine neutral cases, with both compiled poems and no fabricated third personal trait", () => {
  assert.equal(review.coverage.length, 5);
  assert.ok(review.samples.length >= 10);
  for (const p of QIANZAI_ROLE_PROFILES_V11) {
    const samples = review.samples.filter((s) => s.roleId === p.ref.id),
      a = samples.find((s) => s.id.endsWith("-a"))!,
      b = samples.find((s) => s.id.endsWith("-b"))!;
    assert.ok(a && b);
    assert.notEqual(a.answersHash, b.answersHash);
    assert.notEqual(a.signature, b.signature);
    assert.ok(a.themes.length > 0);
    assert.ok(b.themes.length > 0);
    assert.deepEqual(
      new Set(samples.map((s) => s.quote.id)),
      new Set(p.quotes.map((q) => q.id)),
    );
    const neutral = samples.find((s) => s.checks.neutralNarrative);
    assert.ok(neutral);
    assert.equal(neutral.poster.tags.length, 0);
    assert.equal(neutral.checks.reflectionSupportCount, 0);
    assert.deepEqual(neutral.reveal.lines, [...p.baseLines, p.invitation]);
    for (const s of samples) {
      assert.equal(s.honorific, p.honorific);
      assert.equal(s.poster.tagline, p.posterTagline);
      assert.deepEqual(
        s.poster.tags,
        s.themes.map((t) => t.tag),
      );
      assert.ok(s.poster.tags.length <= 3);
      assert.equal(s.checks.repeatedTopicCount, 0);
      assert.equal(s.checks.consumerQuestionMarkers, false);
      assert.deepEqual(s.checks.repeatedChapterBlocks, []);
      assert.equal(s.checks.revealPosterSame, true);
      assert.equal(s.checks.personalTagsSame, true);
      assert.equal(s.document.sections.length, 6);
      assert.ok(s.document.sections.every((c) => c.blocks.length > 0));
      assert.ok(
        p.quotes.some(
          (q) =>
            q.id === s.quote.id &&
            q.text === s.quote.text &&
            q.source === s.quote.source,
        ),
      );
    }
  }
  const mulan = review.profiles.find((p) => p.id === "mulan-ballad")!;
  assert.equal(mulan.kind, "literary-legendary");
  assert.ok(mulan.quotes.every((q) => q.source.startsWith("佚名")));
});
test("keeps raw synthetic answers in collapsed research sections, exposes exact demo sample links, and escapes embedded data", () => {
  const html = renderQianzaiContentReview(review, "http://127.0.0.1:63220");
  assert.equal(
    (html.match(/<article data-role=/gu) ?? []).length,
    review.samples.length,
  );
  assert.equal(
    (html.match(/<details class="research">/gu) ?? []).length,
    review.samples.length,
  );
  assert.ok(!html.includes('<details class="research" open'));
  assert.ok(
    html.includes(
      "http://127.0.0.1:63220/?review-report=reveal&amp;role=li-qingzhao&amp;sample=li-qingzhao-b",
    ),
  );
  assert.ok(html.includes("https://zh.wikisource.org/wiki/陶淵明集/卷三"));
  assert.ok(html.includes("https://zh.wikisource.org/wiki/木蘭辭"));
  assert.ok(html.includes("五角色内容与称号定稿"));
  assert.ok(
    html.includes('<code class="hash">' + review.sourceSha256 + "</code>"),
  );
  assert.ok(
    html.includes(
      ".hash{font:inherit;overflow-wrap:anywhere;word-break:break-all}",
    ),
  );
  assert.ok(
    html.includes(
      ".table-wrap{width:100%;max-width:100%;min-width:0;overflow-x:auto}",
    ),
  );
  assert.equal(
    (html.match(/<div class="table-wrap"><table>/gu) ?? []).length,
    review.samples.length + 4,
  );
  const proposalStart = html.indexOf('<details class="editorial-proposals">');
  assert.ok(
    proposalStart > 0 &&
      proposalStart < html.indexOf('<section aria-label="样例与主题总览">'),
  );
  assert.ok(!html.includes('<details class="editorial-proposals" open'));
  for (const line of [
    "从山河与明月，走近李白的诗境。",
    "从途中风雨，走近苏轼的词境。",
    "从东篱与南山，走近陶渊明的诗境。",
    "从溪亭旧游与云涛星河，走近李清照的词境。",
    "从关山远行与归家换装，走进《木兰诗》。",
    "让眼前的一次停留，也成为风景。",
    "往后的路，照自己的步调走。",
    "愿你出发时，知道自己为何而行。",
    "行至远处，也记得照顾日常。",
    "归来以后，仍有想认真过的生活。",
  ])
    assert.ok(html.includes(line));
  assert.ok(html.includes("人物称号用于身份，海报题签用于文学氛围"));
  const changed = structuredClone(review);
  changed.samples[0]!.document.sections[0]!.blocks[0]!.text =
    "</script><img src=x onerror=alert(1)>";
  const escaped = renderQianzaiContentReview(changed, "http://127.0.0.1:63220");
  assert.ok(!escaped.includes("</script><img"));
  assert.ok(escaped.includes("&lt;/script&gt;&lt;img"));
});
