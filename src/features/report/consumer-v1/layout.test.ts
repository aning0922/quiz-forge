import { expect, it } from "vitest";
import { consumerDisplayFixture } from "@/features/theme/consumer-v1/fixtures.test-support";
import { CONSUMER_REPORT_MARK, layoutConsumerPosterV1 } from "./layout";

it("uses the completed internal report mark, preserves every dimension and refuses clipping", async () => {
  const f = await consumerDisplayFixture(),
    input = structuredClone(f.poster);
  const blocks = layoutConsumerPosterV1(
    input,
    (text, size) => [...text].length * size,
  );
  expect(blocks.at(-1)!.text).toBe(CONSUMER_REPORT_MARK);
  expect(CONSUMER_REPORT_MARK).toBe("内测报告／已完成");
  expect(blocks.map((b) => b.text).join("\n")).not.toMatch(
    /待审|预览|非正式报告/,
  );
  for (const d of input.poster.dimensions)
    expect(
      blocks.some((b) => b.text === `${d.label}  ${d.normalizedText}`),
    ).toBe(true);
  expect(
    blocks.every((b) => b.y >= 1220 && b.y + b.size <= 1868 && b.x === 90),
  ).toBe(true);
  input.poster.posterLine.text = "长".repeat(200);
  expect(() =>
    layoutConsumerPosterV1(input, (text, size) => [...text].length * size),
  ).toThrow("POSTER_LIMIT_EXCEEDED");
});
