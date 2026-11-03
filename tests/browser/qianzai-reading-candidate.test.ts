/** Local review test: explicit already-verified synthetic samples only. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { qianzaiReadingCandidate } from "./qianzai-reading-candidate";
import { qianzaiSupportedThemeReading } from "@/features/report/qianzai-tongxin/supported-theme-reading";

const file = process.env.QZTX_READING_SAMPLES;
if (!file) throw Error("EXPLICIT_VERIFIED_READING_SAMPLES_REQUIRED");
const { selected } = JSON.parse(await readFile(file, "utf8"));

test("keeps real 3/1/0 support, original body identity and all other volumes", () => {
  for (const [i, sample] of selected.entries()) {
    const body = sample.display.body;
    const original = canonicalP1Json(body);
    const candidate = qianzaiReadingCandidate(body, sample.presentation);
    assert.equal(
      candidate.document.consumerCopyVersion,
      "qianzai-consumer-copy.v3",
    );
    assert.equal(
      candidate.baseline.consumerCopyVersion,
      "qianzai-consumer-copy.v2",
    );
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      sample.display.bodySha256,
    );
    assert.equal(canonicalP1Json(body), original);
    assert.equal(candidate.document.body, body);
    const patterns = candidate.document.sections.find(
      (s) => s.id === "patterns",
    )!;
    const prior = candidate.baseline.sections.find((s) => s.id === "patterns")!;
    assert.equal(
      patterns.blocks.filter((b) => b.snapshot).length,
      [3, 1, 0][i],
    );
    assert.deepEqual(
      candidate.document.sections.filter((s) => s.id !== "patterns"),
      candidate.baseline.sections.filter((s) => s.id !== "patterns"),
    );
    if (i === 2) assert.deepEqual(patterns, prior);
    else {
      assert.equal(patterns.blocks.length, [3, 1][i]);
      const readings = qianzaiSupportedThemeReading(body);
      for (let j = 0; j < prior.blocks.length; j++) {
        const block = patterns.blocks[j]!;
        assert.equal(block.layout, "card");
        assert.equal(block.title, readings[j]!.title);
        assert.equal(block.snapshot, prior.blocks[j]!.snapshot);
        assert.equal(block.text.split("\n\n").length, 4);
        for (const text of [
          readings[j]!.choice,
          readings[j]!.meaning,
          prior.blocks[j]!.text.split("\n\n")[1]!,
          readings[j]!.condition,
          readings[j]!.nextStep,
          "**与人物的呼应**：",
          "**放回具体条件看**：",
          "**带进日常的一小步**：",
        ])
          assert.ok(block.text.includes(text));
      }
    }
  }
});

test("does not grant the local candidate to an unknown source", () => {
  const sample = selected[0],
    body = structuredClone(sample.display.body);
  body.provenance.canonicalContentSha256 = "unknown";
  assert.throws(
    () => qianzaiReadingCandidate(body, sample.presentation),
    /READING_CANDIDATE_UNBOUND_SOURCE/u,
  );
});
