import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import { QianzaiReportReader } from "@/features/theme/qianzai-tongxin/report";
import {
  qianzaiSnapshotDocument,
  type QianzaiReportPresentation,
} from "./presentation";

it("renders every snapshot paragraph and both evidence directions through annotated and orphan layouts", () => {
  const body = structuredReaderFixtureV2().completed.report!.view.display.body;
  body.matching.status = "near-tie";
  body.matching.selected.narrativeIndex = 17;
  body.matching.runnerUp = {
    ...body.matching.selected,
    label: "另一位合成候选",
    narrativeIndex: 16,
  };
  const kinds = [
    "reflection-body",
    "source",
    "timeline",
    "prompt",
    "card",
    "final-verse",
  ] as const;
  const sections: NonNullable<QianzaiReportPresentation["sections"]>[number][] =
    [];
  const markers: string[] = [];
  for (const [i, v] of body.volumes.entries()) {
    const p = {
      ...v.paragraphs[0]!,
      text: `SNAPSHOT_PARAGRAPH_${i}`,
      status: "facts-only" as const,
      evidence: [{ ...body.answers[0]!, scope: `EVIDENCE_${i}` }],
      counterevidence: [{ ...body.answers[0]!, scope: `COUNTER_${i}` }],
    };
    v.paragraphs = [p];
    markers.push(p.text, `EVIDENCE_${i}`, `COUNTER_${i}`);
    sections.push({ id: v.id, paragraphs: [{ index: 0, layout: kinds[i]! }] });
  }
  const html = renderToStaticMarkup(
    createElement(QianzaiReportReader, {
      document: qianzaiSnapshotDocument(body, {
        roleRef: body.matching.selected.ref,
        version: "test",
        sourceHtmlSha256: "a".repeat(64),
        history: {
          title: "STATIC_ROLE_HISTORY",
          timeline: [{ title: "STATIC_HISTORY_ROW", text: "STATIC_ROLE_FACT" }],
          sourceNote: "STATIC_SOURCE_NOTE",
        },
        sections,
      }),
      onResult: () => {},
    }),
  );
  for (const text of markers) expect(html).toContain(text);
  for (const marker of [
    "STATIC_ROLE_HISTORY",
    "STATIC_HISTORY_ROW",
    "STATIC_ROLE_FACT",
    "STATIC_SOURCE_NOTE",
  ])
    expect(html).toContain(marker);
  expect(html).toContain("前两位接近。");
  expect(html).toContain("另一位合成候选");
  expect(html).toContain("17 / 100");
  expect(html).toContain(body.notice);
  expect(html).not.toContain("DEMO · 示例数值");
});
