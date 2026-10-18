import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { CONSUMER_COMPONENTS_V1 as views } from "@/features/theme/consumer-v1/components";
import { exportConsumerPosterV1 } from "@/features/report/consumer-v1/export";
import type {
  DisplayEntryBodyV1,
  ResultDisplaySnapshotV1,
  DisplayPosterExportBodyV1,
  DisplayFontDescriptorV1,
} from "@/lib/assessment-contract/display-v1";
import type {
  ConsumerBlockedReason,
  ConsumerMediaPresentation,
} from "@/features/theme/consumer-v1/interfaces";

const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as {
  entry: DisplayEntryBodyV1;
  display: ResultDisplaySnapshotV1;
  poster: DisplayPosterExportBodyV1;
  font: DisplayFontDescriptorV1;
};
type State = "cover" | "question" | "resume" | "result" | "report" | "poster";
type Variant =
  "normal" | "long" | "missing" | "loading" | "saved" | "duplicate";
const root = createRoot(document.getElementById("root")!);
const events: string[] = [];
const event = (name: string) => () => {
  events.push(name);
};
function render(
  state: State,
  variant: Variant = "normal",
  reason?: ConsumerBlockedReason,
) {
  const entry = structuredClone(fixture.entry),
    display = structuredClone(fixture.display);
  if (variant === "duplicate")
    display.report.baseline.title = `${display.result.displayName} · ${display.result.subtitle}`;
  if (variant === "long") {
    entry.product.title = "长文案边界验证·".repeat(10);
    entry.questions.forEach((q) => {
      q.prompt = "这是合成长题目，用于验证完整换行与可读性。".repeat(10);
      q.options.forEach(
        (o) => (o.label = "合成长选项，不代表任何真实测评内容。".repeat(6)),
      );
    });
    entry.visualPresentation.sections.forEach(
      (s) => (s.introduction = "合成长篇厅堂说明。".repeat(30)),
    );
    display.report.baseline.summary = "合成长篇报告摘要，用于测试布局。".repeat(
      90,
    );
    display.report.baseline.strengths = ["合成长篇优势说明。".repeat(100)];
    display.result.displayName = "合成长名称".repeat(8);
    display.result.subtitle = "合成长副标题。".repeat(20);
    if (display.poster.kind === "ready")
      display.poster.posterDisclosure = "合成长海报说明。".repeat(40);
  }
  const media: ConsumerMediaPresentation =
    variant === "missing"
      ? { kind: "unavailable", onRetry: event("media-retry") }
      : variant === "loading"
        ? { kind: "loading" }
        : {
            kind: "ready",
            content: h("img", {
              src:
                state === "cover" || state === "question"
                  ? "/neutral.png"
                  : "/portrait.png",
              alt: "既有合成测试像素，不是正式人物立绘",
              width: 48,
              height: 48,
            }),
          };
  const answers = Object.fromEntries(
    entry.questions.map((q) => [q.id, q.options[0]!.id]),
  );
  const actions = {
    onStart: event("start"),
    onChoose: (q: string, o: string) => {
      events.push(`choose:${q}:${o}`);
    },
    onMove: event("move"),
    onOverview: event("overview"),
    onContinue: event("continue"),
    onQuestion: event("question"),
    onCover: event("cover"),
    onReviewCompletion: event("review-completion"),
  };
  const controls = reason
    ? { kind: "blocked" as const, reason }
    : {
        kind: "enabled" as const,
        save:
          variant === "saved"
            ? {
                kind: "saved" as const,
                stateRevision: 9,
                savedAt: "2026-10-18T13:00:00.000Z",
              }
            : { kind: "unsaved" as const },
        actions,
      };
  switch (state) {
    case "cover":
      root.render(
        h(views["consumer-folio-cover"], { entry, media, answers, controls }),
      );
      break;
    case "question":
      root.render(
        h(views["consumer-folio-question"], {
          entry,
          media,
          answers,
          controls,
          questionId: entry.questions[0]!.id,
        }),
      );
      break;
    case "resume":
      root.render(
        h(views["consumer-folio-resume"], { entry, answers, controls }),
      );
      break;
    case "result":
      root.render(
        h(views["consumer-cabinet-result"], {
          display,
          media,
          onReport: event("report"),
          onPoster: event("poster"),
        }),
      );
      break;
    case "report":
      root.render(
        h(views["consumer-folio-report"], {
          display,
          media,
          onResult: event("result"),
          onPoster: event("poster"),
        }),
      );
      break;
    case "poster":
      root.render(
        h(views["consumer-folio-poster"], {
          display,
          media,
          onReport: event("report"),
          exportState: { kind: "idle", onExport: event("export") },
        }),
      );
      break;
  }
}
Object.assign(window, {
  renderConsumerProbe: render,
  consumerEvents: events,
  exportConsumerProbe: async (
    mode: "normal" | "wrong-hash" | "missing-font" | "stale",
  ) => {
    const value = structuredClone(fixture.poster),
      font = { ...fixture.font };
    if (mode === "wrong-hash") value.poster.portrait.sha256 = "f".repeat(64);
    if (mode === "missing-font") font.file = "/assets/fonts/missing.woff2";
    const blob = await exportConsumerPosterV1(
      value,
      async (_asset, signal) => fetch("/portrait.png", { signal }),
      font,
      new AbortController().signal,
      () => mode !== "stale",
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  },
});
render("cover");
