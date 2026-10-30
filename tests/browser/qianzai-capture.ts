import { createHash } from "node:crypto";
import sharp from "sharp";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { consumerSessionFixtureV2 } from "@/features/theme/consumer-v2/session.test-support";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import type { ConsumerControllerV2 } from "@/features/theme/consumer-v2/controller";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import type {
  ConsumerV2ReaderEvent,
  ConsumerV2ReaderModel,
} from "@/lib/consumer-contract/v2/client-contract";

type MotionProbe = {
  calls: { path: string; method: string }[];
  snapshot(): ConsumerV2ReaderModel;
  owner: ConsumerControllerV2;
  setHidden(hidden: boolean): void;
  holdNext(): void;
  dropNext(): void;
  release(): void;
  delayArt(): void;
  releaseArt(): void;
  prepareLast(): Promise<void>;
  remountSameReport(): void;
  unmount(): void;
  completed(label?: string): void;
};

const responsiveRun =
  process.env.QZTX_CAPTURE_TARGET?.startsWith("responsive-");
const reportRun =
  responsiveRun ||
  process.env.QZTX_CAPTURE_TARGET === "fidelity-report" ||
  process.env.QZTX_CAPTURE_TARGET?.startsWith("motion-")
    ? new Date().toISOString().replaceAll(":", "-")
    : null;
const out = path.resolve(
  responsiveRun
    ? `.cache/qztx-responsive/${process.env.QZTX_CAPTURE_TARGET}-${reportRun}`
    : reportRun
      ? process.env.QZTX_CAPTURE_TARGET?.startsWith("motion-")
        ? `.cache/qztx-motion/${process.env.QZTX_CAPTURE_TARGET}-${reportRun}`
        : `.cache/qztx-fidelity/report-${reportRun}`
      : process.env.QZTX_PARITY_CAPTURE === "1"
        ? ".cache/qztx-parity/browser"
        : process.env.QZTX_CAPTURE_TARGET === "restore"
          ? ".cache/qztx-d3/restore"
          : process.env.QZTX_CAPTURE_TARGET === "reading"
            ? ".cache/qztx-d3/reading"
            : process.env.QZTX_CAPTURE_TARGET === "finish"
              ? ".cache/qztx-d3/finish"
              : process.env.QZTX_MOTION_STUDY === "1"
                ? ".cache/qztx-d3/motion-study"
                : ".cache/qztx-d3/browser",
);
await mkdir(out, { recursive: true });
const session = await consumerSessionFixtureV2(),
  fixture = structuredReaderFixtureV2();
session.entry.facts.entry = fixture.model.entry!;
const scope = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scope);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "productId" ? session.session.productId : scope(child),
      ]),
    );
  return value;
};
session.entry.facts.entry = scope(
  session.entry.facts.entry,
) as typeof session.entry.facts.entry;
session.entry.facts.entry.presentationMode = "authored-product";
session.entry.facts.entry.questions.forEach((q) =>
  q.options.forEach((o, i) => {
    o.label = `合成选项 ${i + 1}：这是一段用于窄屏验证的较长情境选择，文字需要完整换行而不截断。`;
  }),
);
session.entry.factsSha256 = await consumerEntryFactsSha256V2(
  session.entry.facts,
);
fixture.completed.report!.view.display.presentationMode = "authored-product";
const body = fixture.completed.report!.view.display.body;
body.matching.selected.label = "合成人物";
body.matching.selected.narrativeIndex = 37;
body.dimensions = [23, 74, 51, 80, 37].map((score, i) => ({
  ...body.dimensions[0]!,
  dimensionRef: { ...body.dimensions[0]!.dimensionRef, id: `axis-${i}` },
  label: ["守心", "寻远", "知情", "决断", "应变"][i]!,
  score,
}));
body.volumes.forEach((v, i) => {
  v.title = `合成卷${i + 1}`;
  v.paragraphs[0]!.text =
    `合成正文${i + 1}：本段仅用于验证完整长文阅读、目录与证据容器，不是作者正式文案。`.repeat(
      12,
    );
});
// Optional comparison data is read only from the explicitly supplied original
// HTML. It never enters the production renderer, content registry, or snapshots.
let referenceInput: Record<string, unknown> | undefined;
if (process.env.QZTX_REPORT_REFERENCE_HTML) {
  const htmlSha256 = createHash("sha256")
    .update(await readFile(process.env.QZTX_REPORT_REFERENCE_HTML))
    .digest("hex");
  const referenceBrowser = await chromium.launch({ headless: true });
  try {
    const reference = await referenceBrowser.newPage();
    await reference.goto(
      new URL(`file://${process.env.QZTX_REPORT_REFERENCE_HTML}`).href,
    );
    // tsx preserves local helper names in serialized evaluate callbacks.
    await reference.evaluate("window.__name = (fn) => fn");
    await reference.evaluate(
      "window.__quizforgeLiBai.showReveal(false);window.__quizforgeLiBai.toReport()",
    );
    const sample = await reference.evaluate(() => {
      const plain = (node: Element | null) => {
        if (!node) return "";
        // textContent is independent of transition/visibility. Preserve actual
        // source line breaks without inferring any production report fields.
        const copy = node.cloneNode(true) as Element;
        copy.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        return (copy.textContent ?? "").trim();
      };
      const text = (selector: string, root: ParentNode = document) =>
        plain(root.querySelector(selector));
      const opening = document.querySelector("#reportStart")!;
      const rows = (selector: string) =>
        Array.from(document.querySelectorAll(selector), plain);
      return {
        label: opening.querySelector("h1")!.firstChild!.textContent!.trim(),
        title: text(".rp-identity-sub", opening),
        axes: rows(".rp-radar-label"),
        scores: rows(".rp-radar-value").map(Number),
        titles: ["命定相逢", ...rows(".rp-section-head h2"), "寄语留存"],
        encounter: [text(".rp-verse p", opening), text(".rp-lead", opening)],
        dimension: text("#reportRadar .rp-section-head p"),
        patterns: Array.from(document.querySelectorAll(".rp-res-body"), (n) =>
          [text("h3", n), text("p", n), text("span", n)].join("\n"),
        ),
        reflection: [
          text(".rp-reflection-feature blockquote"),
          text(".rp-reflection-feature p"),
          ...rows(".rp-dual-note>div"),
        ],
        literature: [
          text(".rp-history-banner"),
          ...rows(".rp-time-row"),
          text(".rp-source-note"),
        ],
        closure: [text(".rp-final-verse"), text("#reportClosing>p")],
      };
    });
    const groups = [
      sample.encounter,
      [sample.dimension],
      sample.patterns,
      sample.reflection,
      sample.literature,
      sample.closure,
    ];
    const counts = groups.map((group) => group.length);
    if (
      !sample.label ||
      !sample.title ||
      sample.titles.length !== 6 ||
      sample.titles.some((t) => !t.trim()) ||
      JSON.stringify(counts) !== JSON.stringify([2, 1, 3, 4, 5, 2]) ||
      groups.some((group) => group.some((text) => !text.trim())) ||
      sample.axes.length !== 5 ||
      sample.axes.some((t) => !t.trim()) ||
      sample.scores.length !== 5 ||
      sample.scores.some((n) => !Number.isFinite(n) || n < 0 || n > 100)
    )
      throw Error("REFERENCE_REPORT_EMPTY_OR_INCOMPLETE");
    body.matching.selected.label = sample.label;
    body.matching.selected.kind = "documented-historical";
    body.title = sample.title;
    body.dimensions.forEach((d, i) => {
      d.label = sample.axes[i]!;
      d.score = sample.scores[i]!;
    });
    const paragraph = body.volumes[0]!.paragraphs[0]!;
    const make = (text: string, kind: typeof paragraph.kind) => ({
      ...paragraph,
      kind,
      text,
      evidence: [],
      counterevidence: [],
    });
    const content = [
      [
        make(sample.encounter[0]!, "literary"),
        make(sample.encounter[1]!, "summary"),
      ],
      [make(sample.dimension, "context")],
      sample.patterns.map((t) => make(t, "summary")),
      sample.reflection.map((t, i) =>
        make(t, i === 0 ? "literary" : "context"),
      ),
      sample.literature.map((t) => make(t, "fact")),
      sample.closure.map((t, i) => make(t, i === 0 ? "literary" : "context")),
    ];
    body.volumes.forEach((v, i) => {
      v.title = sample.titles[i]!;
      v.paragraphs = content[i]!;
    });
    referenceInput = {
      htmlSha256,
      fixtureSha256: createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex"),
      nonEmpty: true,
      titles: sample.titles,
      paragraphCounts: counts,
      paragraphLengths: groups.map((g) => g.map((t) => t.length)),
      axes: sample.axes,
      scores: sample.scores,
    };
    await writeFile(
      path.join(out, "reference-fixture.json"),
      JSON.stringify(body, null, 2),
    );
  } catch (error) {
    await writeFile(
      path.join(out, "reference-input.failed.json"),
      JSON.stringify(
        { passed: false, htmlSha256, error: String(error) },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await referenceBrowser.close();
  }
}
if (process.env.QZTX_CAPTURE_TARGET === "reflection-evidence") {
  const source = body.volumes[0]!.paragraphs[0]!,
    reflection = body.volumes.find((v) => v.id === "counterevidence")!;
  reflection.paragraphs = Array.from({ length: 5 }, (_, i) => ({
    ...source,
    text: `合成反思段落 ${i + 1}：正文、限定状态与本段证据必须完整保留。`,
    kind: i === 0 ? "literary" : "context",
    status: i === 3 ? "fallback" : i === 2 ? "facts-only" : "accepted",
    counterevidence: i === 4 ? source.evidence : [],
  }));
}
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [
    path.resolve("src/features/theme/qianzai-tongxin/browser.test-support.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  external: ["/assets/*"],
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  plugins: [
    {
      name: "unused-node-policy-branch",
      setup(build: {
        onResolve: (o: { filter: RegExp }, cb: () => unknown) => void;
        onLoad: (
          o: { filter: RegExp; namespace: string },
          cb: () => unknown,
        ) => void;
      }) {
        build.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "unused-node-policy-branch",
        }));
        build.onLoad(
          { filter: /.*/, namespace: "unused-node-policy-branch" },
          () => ({
            contents:
              'export const types = new Proxy({}, { get() { throw Error("UNEXPECTED_NODE_POLICY_IN_UI_PROBE"); } });',
            loader: "js",
          }),
        );
      },
    },
  ],
});
const files = new Map([
  [
    "/probe.js",
    {
      body: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
  [
    "/probe.css",
    { body: await readFile(path.join(out, "probe.css")), type: "text/css" },
  ],
]);
files.set("/assets/fonts/qianzai-v3/serif-600.woff2", {
  body: await readFile("public/assets/fonts/qianzai-v3/serif-600.woff2"),
  type: "font/woff2",
});
if (process.env.QZTX_MOTION_STUDY === "1") {
  const inventoryPath = process.env.QZTX_RESOURCE_INVENTORY;
  if (!inventoryPath || !path.isAbsolute(inventoryPath))
    throw Error("EXPLICIT_PRIVATE_INVENTORY_PATH_REQUIRED");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const image = inventory.images.find(
    (v: { image_id: string }) => v.image_id === "image-fc0fb75e94f080cc",
  );
  files.set("/private-v8-reference", {
    body: await readFile(image.copy),
    type: "image/webp",
  });
}
// Optional read-only prototype-byte comparison. This is a synthetic projection,
// not resource admission, renderer registration or a production asset library.
const visuals: {
  asset: (typeof session.entry.facts.entry.assets)[number];
  url: string;
  layer: "clean" | "prototype-scene-base" | "prototype-option-skin";
}[] = [];
const completedVisuals: typeof visuals = [];
if (responsiveRun || process.env.QZTX_CAPTURE_TARGET?.startsWith("motion-")) {
  const report = scope(fixture.completed.report!) as NonNullable<
    typeof fixture.completed.report
  >;
  Object.assign(fixture.completed.report!, report);
  for (const [slot, file] of [
    ["reveal", "portrait-1.png"],
    ["nameArt", "portrait-2.png"],
  ] as const) {
    const ref = report.view.display.slots.character[slot];
    const asset = report.view.display.assets.find(
      (a) => a.resourceRef.id === ref?.id,
    )!;
    const bytes = await readFile(`tests/fixtures/p4-baseline/assets/${file}`),
      info = await sharp(bytes).metadata();
    Object.assign(asset, {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      width: info.width,
      height: info.height,
      mediaType: "image/png",
      approval: "approved",
    });
    const url = `/private-motion/${file}`;
    files.set(url, { body: bytes, type: "image/png" });
    completedVisuals.push({ asset, url, layer: "clean" });
  }
}
let preferenceSceneRef:
  typeof session.entry.facts.entry.slots.cover | undefined;
if (process.env.QZTX_PROTOTYPE_HTML) {
  const html = await readFile(process.env.QZTX_PROTOTYPE_HTML, "utf8");
  const assets = JSON.parse(
    html.match(/const ASSETS=(\{[^\n]+\});/)![1]!,
  ) as Record<string, string>;
  const entry = session.entry.facts.entry;
  const add = async (
    key: string,
    ref: typeof entry.slots.cover,
    layer: (typeof visuals)[number]["layer"],
  ) => {
    const source = assets[key]!;
    const raw = Buffer.from(source.split(",")[1]!, "base64");
    const info = await sharp(raw).metadata();
    const nextRef = { ...ref, id: "parity-" + key };
    const asset = {
      ...(entry.assets.find((a) => a.resourceRef.id === ref.id) ??
        entry.assets[0]!),
      resourceRef: nextRef,
    };
    entry.assets.push(asset);
    Object.assign(asset, {
      sha256: createHash("sha256").update(raw).digest("hex"),
      bytes: raw.length,
      width: info.width,
      height: info.height,
      mediaType: source.slice(5, source.indexOf(";")),
    });
    const url = "/private-prototype/" + key;
    files.set(url, { body: raw, type: asset.mediaType });
    visuals.push({ asset, url, layer });
    return nextRef;
  };
  if (process.env.QZTX_V8_HTML) {
    const v8 = await readFile(process.env.QZTX_V8_HTML, "utf8");
    const hero = v8.match(/<img[^>]*id="heroImg"[^>]*>/)![0];
    assets.cover = hero.match(/src="([^"]+)"/)![1]!;
  }
  entry.slots.cover = await add(
    "cover",
    entry.slots.cover,
    "prototype-scene-base",
  );
  preferenceSceneRef = { ...entry.slots.cover, id: "parity-preference-scene" };
  entry.assets.push({ ...entry.assets[0]!, resourceRef: preferenceSceneRef });
  preferenceSceneRef = await add(
    "gender",
    preferenceSceneRef,
    "prototype-scene-base",
  );
  const firstAct = entry.slots.acts[0]!;
  entry.slots.acts = ["act-one", "act-two", "act-three"].map((sectionId) => ({
    ...firstAct,
    sectionId,
  }));
  for (const [i, act] of entry.slots.acts.entries()) {
    act.background = await add(
      "scene" + i,
      act.background,
      "prototype-scene-base",
    );
    act.questionPaper = await add("question" + i, act.questionPaper, "clean");
    act.optionIdle = await add(
      "option" + i,
      act.optionIdle,
      "prototype-option-skin",
    );
    act.optionSelected = await add(
      "chosen" + i,
      act.optionSelected,
      "prototype-option-skin",
    );
  }
  const questions = JSON.parse(
    html.match(/const QUESTIONS=(\[[^\n]+\]);/)![1]!,
  ) as [string, string[]][];
  for (const [i, q] of entry.questions.entries()) {
    const sample =
      questions[
        i === 0 ? 0 : i === 8 ? 5 : i === 16 ? 9 : i % questions.length
      ]!;
    q.prompt = sample[0];
    q.options = sample[1].map((label, j) => ({
      ...q.options[0]!,
      ref: { ...q.options[0]!.ref, id: q.ref.id + "-o-" + j },
      label,
    }));
  }
  if (process.env.QZTX_AUTHORED_BUILD) {
    const authored = JSON.parse(
      await readFile(process.env.QZTX_AUTHORED_BUILD, "utf8"),
    ).core.questions as {
      act: number;
      prompt: string;
      options: { label: string }[];
    }[];
    if (authored.length !== 24) throw Error("AUTHOR_24_QUESTIONS_REQUIRED");
    entry.questions.forEach((q, i) => {
      const source = authored[i]!;
      q.act = source.act;
      q.prompt = source.prompt;
      q.options = source.options.map((o, j) => ({
        ...q.options[0]!,
        ref: { ...q.options[0]!.ref, id: q.ref.id + "-o-" + j },
        label: o.label,
      }));
    });
  }
  session.entry.factsSha256 = await consumerEntryFactsSha256V2(
    session.entry.facts,
  );
}
if (responsiveRun) {
  for (const q of session.entry.facts.entry.questions) {
    q.prompt = "夜深时分，你独自在高处远望，\n心中最先浮现的是什么？";
    q.options.forEach((o, i) => {
      o.label = [
        "对未来的期待，想要看见更广阔的世界",
        "心中某个重要的人，忍不住想起TA",
        "过往的遗憾，仍在心头萦绕",
        "当下的平静，只愿珍惜此刻的安宁",
      ][i]!;
    });
  }
  session.entry.factsSha256 = await consumerEntryFactsSha256V2(
    session.entry.facts,
  );
}
if (process.env.QZTX_CAPTURE_TARGET === "responsive-long") {
  const q = session.entry.facts.entry.questions[0]!;
  q.prompt =
    "合成长题：" +
    "在这一段用于小屏完整阅读的合成情境里，请保留全部文字并慢慢阅读。".repeat(
      7,
    ) +
    "合成长题完整结尾。";
  q.options.forEach(
    (o, i) =>
      (o.label =
        `合成长选项${i + 1}：` +
        "这一段合成选项用于验证长文字换行与下部独立滚动，不是作者正式题目。".repeat(
          5,
        ) +
        `第${i + 1}项完整结尾。`),
  );
  session.entry.factsSha256 = await consumerEntryFactsSha256V2(
    session.entry.facts,
  );
}
const server = createServer((req, res) => {
  const file = files.get(req.url ?? "");
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    // Standalone synthetic harness only. Production registration belongs solely
    // to loadQianzaiFont, which verifies the compiled font descriptor first.
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>@font-face{font-family:"QuizForge Qianzai Serif V3";src:url("/assets/fonts/qianzai-v3/serif-600.woff2") format("woff2");font-weight:600;font-style:normal;font-display:swap}body{margin:0}button,input{font:inherit}</style><div id="root"></div><script id="fixture" type="application/json">' +
      JSON.stringify({
        session,
        completed: fixture.completed,
        visuals,
        preferenceSceneRef,
        completedVisuals,
        leaseRemount:
          responsiveRun ||
          (process.env.QZTX_CAPTURE_TARGET?.startsWith("motion-") ?? false),
      }).replaceAll("<", "\\u003c") +
      '</script><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  scope:
    "actual D3 React and v2 controller; synthetic HTTP/prose, no DB/Next/registry/real resource admission",
  browser: await browser.version(),
  screenshots: [],
  ...(reportRun
    ? { run: reportRun, artifactDirectory: out, referenceInput }
    : {}),
};
const continuing = process.env.QZTX_CAPTURE_CONTINUE === "1";
if (continuing) {
  const previous = JSON.parse(
    await readFile(path.join(out, "result.json"), "utf8"),
  );
  await writeFile(
    path.join(out, `result.failed-${Date.now()}.json`),
    JSON.stringify(previous, null, 2),
  );
  facts.screenshots = previous.screenshots;
  facts.continuation =
    "reuse first five completed geometry/capture checks; fix fieldset matcher, then continue serial-save and remaining views";
}
const errors: string[] = [];
async function check(page: Page, name: string, width: number) {
  if (
    continuing &&
    ["cover-neutral", "preference-neutral", "question-long"].includes(name)
  )
    return;
  await page.setViewportSize({ width, height: 844 });
  // Capture a settled visible frame, never an arbitrary mid-veil screenshot.
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return (
        animation.playState === "running" &&
        timing &&
        Number.isFinite(timing.endTime)
      );
    });
    await Promise.allSettled(finite.map((animation) => animation.finished));
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const font = await page.evaluate(() => ({
    family: getComputedStyle(
      document.querySelector("[data-qianzai-experience]") ??
        document.querySelector("[data-qianzai-screen]")!,
    ).fontFamily,
    loaded: document.fonts.check(
      '600 16px "QuizForge Qianzai Serif V3"',
      "古子滑级",
    ),
  }));
  expect(font.loaded).toBe(true);
  facts.fixedFont = font;
  const sizes = await page.locator("button:visible").evaluateAll((nodes) =>
    nodes.map((n) => ({
      text: n.textContent,
      width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height,
    })),
  );
  expect(sizes.every((s) => s.width >= 44 && s.height >= 44)).toBe(true);
  await page.screenshot({
    path: path.join(out, `${name}-${width}.png`),
    fullPage: true,
  });
  (facts.screenshots as unknown[]).push({
    name,
    width,
    height: 844,
    noHorizontalOverflow: true,
    minimumTarget44: true,
  });
}
async function checkRadar(page: Page) {
  const report = page.locator('[data-qianzai-screen="report"]');
  // Nodes are real keyboard/click targets; their sealed value and bar agree.
  await report.getByRole("button", { name: "守心 23分", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    report.getByRole("heading", { name: "守心 · 23 / 100" }),
  ).toBeVisible();
  await report.locator("[data-qianzai-radar-point]").nth(2).click();
  await expect(
    report.getByRole("heading", { name: "知情 · 51 / 100" }),
  ).toBeVisible();
  await report.getByRole("button", { name: "应变 37分", exact: true }).click();
  await expect(
    report.getByRole("heading", { name: "应变 · 37 / 100" }),
  ).toBeVisible();
  await check(page, "radar-node-selected", 390);
  await report
    .getByRole("button", { name: "阅读本卷选择依据", exact: true })
    .click();
  await expect(
    report.locator("details[data-report-evidence][open]"),
  ).toHaveCount(1);
  facts.radarNodes = {
    point: true,
    keyboard: true,
    click: true,
    sealedValue: true,
    volumeEvidence: true,
  };
}
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    ...(process.env.QZTX_CAPTURE_TARGET === "motion-showcase" ||
    process.env.QZTX_CAPTURE_TARGET === "responsive-first-act"
      ? {
          recordVideo: {
            dir: path.join(out, "video"),
            size: { width: 390, height: 844 },
          },
        }
      : {}),
  });
  await page.addInitScript("window.__name = (fn) => fn");
  page.on("pageerror", (e) => errors.push(e.message));
  if (
    responsiveRun &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-boundaries" &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-first-act" &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-names" &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-selection" &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-noop" &&
    process.env.QZTX_CAPTURE_TARGET !== "responsive-long"
  ) {
    await page.close();
    const rows: unknown[] = [],
      paperEdges: {
        width: number;
        height: number;
        act: number;
        edgeY: number | null;
        ratios: number[];
      }[] = [];
    const validating =
      process.env.QZTX_CAPTURE_TARGET !== "responsive-baseline" &&
      process.env.QZTX_CAPTURE_TARGET !== "responsive-layout-draft";
    const baselinePath = process.env.QZTX_RESPONSIVE_BASELINE_RESULT;
    const baseline = baselinePath
      ? (JSON.parse(await readFile(baselinePath, "utf8")) as {
          passed: boolean;
          responsive: {
            rows: {
              kind: string;
              act?: number;
              width: number;
              height: number;
              original: unknown;
            }[];
          };
        })
      : null;
    if (validating && !baseline?.passed)
      throw Error("PASSED_RESPONSIVE_BASELINE_REQUIRED");
    const reference = baseline
      ? null
      : await browser.newPage({ reducedMotion: "reduce" });
    if (reference) {
      await reference.addInitScript("window.__name = (fn) => fn");
      await reference.goto(
        new URL(`file://${process.env.QZTX_PROTOTYPE_HTML}`).href,
      );
    }
    const geometry = async (p: Page, original: boolean, screen: string) =>
      p.evaluate(
        ({ original, screen }) => {
          const root = document.querySelector<HTMLElement>(
            original
              ? `#${screen === "preference" ? "gender" : screen === "question" ? "quiz" : screen === "result" ? "reveal" : screen}`
              : `[data-qianzai-screen="${screen}"]`,
          )!;
          const origin = root.getBoundingClientRect();
          const rect = (el: Element | null) => {
            if (!el) return null;
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el);
            return {
              x: r.x - origin.x,
              y: r.y - origin.y,
              width: r.width,
              height: r.height,
              bottom: r.bottom - origin.y,
              overflowY: s.overflowY,
              clientHeight: el.clientHeight,
              scrollHeight: el.scrollHeight,
              visible: el.checkVisibility(),
            };
          };
          const select = (ours: string, theirs: string) =>
            root.querySelector(original ? theirs : ours);
          return {
            viewport: { width: innerWidth, height: innerHeight },
            root: rect(root),
            art: rect(
              select(
                ":scope>.fullArt, :scope>[class*=fullArt]",
                ".art,.scene-art,.reveal-art",
              ),
            ),
            choices: Array.from(
              root.querySelectorAll(original ? ".choice" : "label"),
              rect,
            ),
            marks: Array.from(
              root.querySelectorAll(original ? ".dot" : "[class*=radioMark]"),
              rect,
            ),
            paper: rect(select("[class*=questionPaper]", ".question-panel")),
            question: rect(select("[class*=questionBody]", ".readable")),
            prompt: rect(select("[class*=questionPaper] h2", ".question-text")),
            options: Array.from(
              root.querySelectorAll(
                original ? ".option" : "[class*=options] label",
              ),
              rect,
            ),
            nav: rect(select("[class*=questionNav]", ".foot.next")),
            identity: rect(
              select("[class*=revealIdentity]", ".reveal-art.full"),
            ),
            continue: rect(
              select("[data-reveal-continue]", ".reveal-scroll-hit"),
            ),
            notice: rect(select("[class*=revealNotice]", ".reveal-toast")),
            reportScroll: rect(select("[class*=reportScroll]", ":scope")),
            document: {
              scrollHeight: document.documentElement.scrollHeight,
              clientHeight: document.documentElement.clientHeight,
              scrollWidth: document.documentElement.scrollWidth,
            },
            scrollContainers: Array.from(root.querySelectorAll("*"))
              .filter((el) =>
                ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
              )
              .map((el) => ({ class: el.className, ...rect(el) })),
          };
        },
        { original, screen },
      );
    for (const [width, height] of [
      [390, 844],
      [375, 667],
      [320, 568],
      [430, 932],
    ] as const) {
      const current = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      current.on("pageerror", (e) => errors.push(e.message));
      await current.addInitScript("window.__name = (fn) => fn");
      await current.goto(origin);
      // Remove only the synthetic harness label outside the actual product stage.
      await current.addStyleTag({
        content: '[class*="synthetic"]{display:none!important}',
      });
      await expect(
        current.locator("[data-qianzai-experience]"),
      ).toHaveAttribute("data-view-phase", "ready");
      await current.evaluate(() => document.fonts.ready);
      await expect(
        current.locator('[data-qianzai-screen="cover"] img'),
      ).toHaveCount(1);
      if (reference) {
        await reference.setViewportSize({ width, height });
        await reference.evaluate("show('gender')");
      }
      const originalGeometry = (kind: string, screen: string, act?: number) =>
        reference
          ? geometry(reference, true, screen)
          : Promise.resolve(
              baseline!.responsive.rows.find(
                (row) =>
                  row.kind === kind &&
                  row.width === width &&
                  row.height === height &&
                  row.act === act,
              )!.original,
            );
      await current
        .getByRole("button", { name: "开启穿越之旅", exact: true })
        .click();
      await expect(
        current.locator('[data-qianzai-screen="preference"] img'),
      ).toHaveCount(1);
      const prefGeometry = await geometry(current, false, "preference");
      if (validating) {
        const unit = width / 390;
        expect(prefGeometry.root!.height).toBe(height);
        expect(prefGeometry.document.scrollHeight).toBe(height);
        for (let i = 0; i < 3; i++) {
          expect(prefGeometry.choices[i]!.x).toBeCloseTo(12 * unit, 0);
          expect(prefGeometry.choices[i]!.y).toBeCloseTo(
            (393 + 91 * i) * unit,
            0,
          );
          expect(prefGeometry.choices[i]!.width).toBeCloseTo(364 * unit, 0);
          expect(prefGeometry.marks[i]!.x).toBeCloseTo(330 * unit, 0);
          expect(prefGeometry.marks[i]!.y).toBeCloseTo(
            [441, 530, 619][i]! * unit,
            0,
          );
        }
      }
      rows.push({
        kind: "preference",
        width,
        height,
        original: await originalGeometry("preference", "preference"),
        current: await geometry(current, false, "preference"),
      });
      if (reference)
        await reference.screenshot({
          path: path.join(out, `original-preference-${width}x${height}.png`),
        });
      await current.screenshot({
        path: path.join(out, `current-preference-${width}x${height}.png`),
      });
      await current
        .locator('[data-qianzai-screen="preference"] label')
        .nth(2)
        .click();
      await expect(
        current.locator('[data-qianzai-screen="question"]'),
      ).toBeVisible();
      for (const [act, index] of [
        [1, 0],
        [2, 8],
        [3, 16],
      ] as const) {
        if (index)
          await current.evaluate(async (index) => {
            const p = (window as unknown as { qianzaiProbe: MotionProbe })
              .qianzaiProbe;
            await p.owner.navigate({ questionId: `q-${index}` }, "question");
          }, index);
        await expect(
          current.locator("[data-qianzai-experience]"),
        ).toHaveAttribute("data-view-phase", "ready");
        if (reference)
          await reference.evaluate(
            `showQuestion(${(act - 1) * 4});document.getElementById('questionText').textContent='夜深时分，你独自在高处远望，\\n心中最先浮现的是什么？';document.querySelectorAll('#optionHost .words').forEach((el,i)=>el.textContent=['对未来的期待，想要看见更广阔的世界','心中某个重要的人，忍不住想起TA','过往的遗憾，仍在心头萦绕','当下的平静，只愿珍惜此刻的安宁'][i]);`,
          );
        await current.evaluate(() => scrollTo(0, 0));
        rows.push({
          kind: "question",
          act,
          width,
          height,
          original: await originalGeometry("question", "question", act),
          current: await geometry(current, false, "question"),
        });
        if (reference)
          await reference.screenshot({
            path: path.join(out, `original-act-${act}-${width}x${height}.png`),
          });
        await current.screenshot({
          path: path.join(out, `current-act-${act}-${width}x${height}.png`),
        });
        const geo = await geometry(current, false, "question");
        if (validating) {
          expect(geo.root!.height).toBe(height);
          expect(geo.document.scrollHeight).toBe(height);
          expect(geo.document.scrollWidth).toBe(width);
          expect(geo.paper!.y).toBeCloseTo((391 * width) / 390, 0);
          const port = current.locator(
            '[data-qianzai-screen="question"] [data-qianzai-scroll-region]',
          );
          const metrics = await port.evaluate((n) => ({
            client: n.clientHeight,
            scroll: n.scrollHeight,
          }));
          expect(metrics.scroll > metrics.client).toBe(height < 800);
          const before = await current.evaluate(
            () =>
              (window as unknown as { qianzaiProbe: MotionProbe }).qianzaiProbe
                .calls.length,
          );
          await port.evaluate((n) => (n.scrollTop = n.scrollHeight));
          const nav = await current
            .locator(
              '[data-qianzai-screen="question"] nav[aria-label="答题导航"]',
            )
            .boundingBox();
          expect(nav!.y + nav!.height).toBeLessThanOrEqual(height + 1);
          expect(await current.evaluate(() => scrollY)).toBe(0);
          if (height < 800)
            await current.screenshot({
              path: path.join(
                out,
                `current-act-${act}-bottom-${width}x${height}.png`,
              ),
            });
          await port.evaluate((n) => (n.scrollTop = 0));
          expect(
            await current.evaluate(
              () =>
                (window as unknown as { qianzaiProbe: MotionProbe })
                  .qianzaiProbe.calls.length,
            ),
          ).toBe(before);
          const backdrop = current.locator('svg[class*="answerBackdrop"]');
          await expect(backdrop).toHaveAttribute(
            "preserveAspectRatio",
            "xMidYMid slice",
          );
          await expect(backdrop.locator(":scope>svg")).toHaveAttribute(
            "viewBox",
            "0 1400 852 444",
          );
          await expect(backdrop.locator(":scope>svg")).toHaveAttribute(
            "overflow",
            "hidden",
          );
        }
        // Read rendered pixels, not only the DOM top: locate the first central
        // pale paper row in each real screenshot, independently of CSS offsets.
        const { data, info } = await sharp(
          await readFile(
            path.join(out, `current-act-${act}-${width}x${height}.png`),
          ),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const paper = geo.paper!,
          left = Math.ceil(paper.x + (80 * paper.width) / 354),
          right = Math.floor(paper.x + (274 * paper.width) / 354),
          top = Math.floor(paper.y),
          ratios: number[] = [];
        for (let dy = 0; dy < 10; dy++) {
          let bright = 0;
          for (let x = left; x < right; x++) {
            const pos = ((top + dy) * info.width + x) * 4;
            if (
              data[pos]! > 190 &&
              data[pos + 1]! > 165 &&
              data[pos + 2]! > 110
            )
              bright++;
          }
          ratios.push(bright / (right - left));
        }
        const edgeIndex = ratios.findIndex((r) => r >= 0.9);
        paperEdges.push({
          width,
          height,
          act,
          edgeY: edgeIndex < 0 ? null : top + edgeIndex,
          ratios,
        });
      }
      await current.evaluate(async () => {
        const p = (window as unknown as { qianzaiProbe: MotionProbe })
          .qianzaiProbe;
        await p.prepareLast();
      });
      await current
        .getByRole("button", { name: "走向相逢", exact: true })
        .click();
      await current
        .getByRole("button", { name: "开启相逢", exact: true })
        .click();
      await expect(
        current.locator("[data-qianzai-experience]"),
      ).toHaveAttribute("data-view-phase", "completed");
      await expect(current.locator("[data-reveal-phase]")).toHaveAttribute(
        "data-reveal-phase",
        "ready",
      );
      if (reference)
        await reference.evaluate("window.__quizforgeLiBai.showReveal(false)");
      await current.evaluate(() => scrollTo(0, 0));
      rows.push({
        kind: "reveal",
        width,
        height,
        original: await originalGeometry("reveal", "result"),
        current: await geometry(current, false, "result"),
      });
      if (reference)
        await reference.screenshot({
          path: path.join(out, `original-reveal-${width}x${height}.png`),
        });
      await current.screenshot({
        path: path.join(out, `current-reveal-${width}x${height}.png`),
      });
      await current.locator("[data-reveal-continue]").click();
      if (reference)
        await reference.evaluate("window.__quizforgeLiBai.toReport()");
      rows.push({
        kind: "report",
        width,
        height,
        original: await originalGeometry("report", "report"),
        current: await geometry(current, false, "report"),
      });
      await current.evaluate(() => scrollTo(0, 0));
      await current.screenshot({
        path: path.join(out, `current-report-${width}x${height}.png`),
      });
      if (reference)
        await reference.screenshot({
          path: path.join(out, `original-report-${width}x${height}.png`),
        });
      await current.close();
      await writeFile(
        path.join(out, "geometry.in-progress.json"),
        JSON.stringify(rows, null, 2),
      );
    }
    await reference?.close();
    if (validating)
      for (const [width, height] of [
        [390, 844],
        [375, 667],
        [320, 568],
        [430, 932],
      ]) {
        const edges = paperEdges.filter(
          (e) => e.width === width && e.height === height,
        );
        expect(edges).toHaveLength(3);
        expect(edges.every((e) => e.edgeY !== null)).toBe(true);
        expect(
          Math.max(...edges.map((e) => e.edgeY!)) -
            Math.min(...edges.map((e) => e.edgeY!)),
        ).toBeLessThanOrEqual(1);
      }
    facts.responsive = {
      reusedBaseline: baselinePath,
      paperEdges,
      validated: validating,
      source:
        "explicit original HTML read only; same prompts/options across acts; synthetic HTTP and role noise markers",
      rows,
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-noop") {
    await page.goto(`${origin}/?motion-question`);
    await page.addStyleTag({
      content: '[class*="synthetic"]{display:none!important}',
    });
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]"),
      question = page.locator('[data-qianzai-screen="question"]');
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await question.getByRole("button", { name: "偏好", exact: true }).click();
    await expect(
      page.locator('[data-qianzai-screen="preference"] input').nth(2),
    ).toBeChecked();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    const before = await page.evaluate(() => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
        .qianzaiProbe;
      return {
        calls: p.calls.length,
        saves: p.calls.filter((c) => c.path.endsWith("/save")).length,
        state: p.snapshot().state,
        storage: JSON.stringify(sessionStorage),
      };
    });
    await page.getByRole("button", { name: "进入第一幕", exact: true }).click();
    await expect(stage).toHaveAttribute("data-kind", "chapter");
    await expect(stage.locator('[data-transition-part="kicker"]')).toHaveText(
      "第一幕",
    );
    await page.clock.runFor(439);
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(stage).toHaveAttribute("data-step", "enter");
    await page.clock.runFor(451);
    await expect(stage).toBeHidden();
    expect(await question.evaluate((n) => n.closest("[inert]") !== null)).toBe(
      false,
    );
    const after = await page.evaluate(() => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
        .qianzaiProbe;
      return {
        calls: p.calls.length,
        saves: p.calls.filter((c) => c.path.endsWith("/save")).length,
        state: p.snapshot().state,
        storage: JSON.stringify(sessionStorage),
      };
    });
    expect(after).toEqual(before);
    await page.screenshot({
      path: path.join(out, "no-change-navigation-settled.png"),
    });
    facts.noChangeNavigation = {
      controlledClock: true,
      setup:
        "real owner saved preference/first position before observation; returned to preference unchanged",
      chapterEndedMs: 890,
      noAdditionalRequest: true,
      noAdditionalSave: true,
      sameAcceptedStateAndStorage: true,
      inertReleased: true,
      before,
      after,
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-long") {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/?motion-question`);
    await page.addStyleTag({
      content: '[class*="synthetic"]{display:none!important}',
    });
    const question = page.locator('[data-qianzai-screen="question"]'),
      port = question.locator("[data-qianzai-scroll-region]");
    await expect(question).toBeVisible();
    await expect(question.locator(":scope>img")).toHaveCount(1);
    await page.evaluate(() => document.fonts.ready);
    const before = await page.evaluate(() => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
        .qianzaiProbe;
      return { calls: p.calls.length, state: p.snapshot().state };
    });
    const proof = await question.evaluate((n) => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
          .qianzaiProbe,
        q = p.snapshot().entry!.questions[0]!,
        port = n.querySelector("[data-qianzai-scroll-region]")!,
        paper = n.querySelector('[class*="questionPaper"] h2')!;
      return {
        expectedPrompt: q.prompt,
        prompt: paper.textContent,
        promptClient: paper.clientHeight,
        promptScroll: paper.scrollHeight,
        options: Array.from(n.querySelectorAll("label")).map((el, i) => {
          const text = el.querySelector("span:nth-of-type(2)")!;
          return {
            expected: q.options[i]!.label,
            text: text.textContent,
            client: text.clientHeight,
            scroll: text.scrollHeight,
            width: text.clientWidth,
            scrollWidth: text.scrollWidth,
          };
        }),
        client: port.clientHeight,
        scroll: port.scrollHeight,
        portTop: port.getBoundingClientRect().top,
        headerTop: n.querySelector("header")!.getBoundingClientRect().top,
        doc: document.documentElement.scrollHeight,
      };
    });
    expect(proof.prompt).toBe(proof.expectedPrompt);
    expect(proof.promptScroll).toBeLessThanOrEqual(proof.promptClient + 1);
    expect(
      proof.options.every(
        (o) =>
          o.text === o.expected &&
          o.scroll <= o.client + 1 &&
          o.scrollWidth <= o.width + 1,
      ),
    ).toBe(true);
    expect(proof.expectedPrompt.length).toBeGreaterThan(150);
    expect(proof.options.every((o) => o.expected.length > 100)).toBe(true);
    expect(proof.scroll).toBeGreaterThan(proof.client);
    expect(proof.doc).toBe(568);
    await page.screenshot({
      path: path.join(out, "long-prompt-top-320x568.png"),
    });
    await port.evaluate((n) => (n.scrollTop = n.scrollHeight));
    const end = await question.evaluate((n) => {
      const text = n.querySelectorAll("label span:nth-of-type(2)")[3]!,
        range = document.createRange(),
        child = text.firstChild!;
      range.setStart(child, child.textContent!.length - 8);
      range.setEnd(child, child.textContent!.length);
      const last = range.getBoundingClientRect(),
        nav = n
          .querySelector('nav[aria-label="答题导航"]')!
          .getBoundingClientRect();
      return {
        lastTextTop: last.top,
        lastTextBottom: last.bottom,
        navTop: nav.top,
        navBottom: nav.bottom,
        headerTop: n.querySelector("header")!.getBoundingClientRect().top,
        docScroll: scrollY,
      };
    });
    expect(end.lastTextTop).toBeGreaterThanOrEqual(proof.portTop);
    expect(end.lastTextBottom).toBeLessThanOrEqual(568);
    expect(end.navBottom).toBeLessThanOrEqual(568);
    expect(end.headerTop).toBe(proof.headerTop);
    expect(end.docScroll).toBe(0);
    await page.screenshot({
      path: path.join(out, "long-options-bottom-nav-320x568.png"),
    });
    const after = await page.evaluate(() => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
        .qianzaiProbe;
      return { calls: p.calls.length, state: p.snapshot().state };
    });
    expect(after).toEqual(before);
    facts.longQuestion = {
      scope:
        "320x568 synthetic long prompt and four long options; real controller setup, no author answers",
      proof,
      end,
      scrollWithoutIOOrStateChange: true,
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-selection") {
    await page.close();
    const frames: unknown[] = [];
    for (const [width, height] of [
      [390, 844],
      [375, 667],
      [320, 568],
      [430, 932],
    ] as const) {
      const p = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(origin);
      await p.addStyleTag({
        content: '[class*="synthetic"]{display:none!important}',
      });
      await expect(p.locator("[data-qianzai-experience]")).toHaveAttribute(
        "data-view-phase",
        "ready",
      );
      await p
        .getByRole("button", { name: "开启穿越之旅", exact: true })
        .click();
      const pref = p.locator('[data-qianzai-screen="preference"]');
      await expect(pref.locator(":scope>img")).toHaveCount(1);
      await p.evaluate(() => document.fonts.ready);
      await p.emulateMedia({ reducedMotion: "no-preference" });
      await p.clock.install();
      await p.clock.pauseAt(new Date(Date.now() + 100));
      await pref.locator("label").first().click();
      await p.clock.runFor(180);
      await expect(pref.locator("input").first()).toBeChecked();
      await expect(p.locator("[data-qianzai-transition]")).toBeHidden();
      const metrics = await pref
        .locator("label")
        .first()
        .evaluate((n) => {
          const r = n.getBoundingClientRect(),
            s = getComputedStyle(n);
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            radius: s.borderRadius,
            checked: (n.querySelector("input") as HTMLInputElement).checked,
          };
        });
      expect(parseFloat(metrics.radius)).toBeCloseTo((width / 390) * 35, 0);
      expect(
        await p.evaluate(
          () =>
            (
              window as unknown as { qianzaiProbe: MotionProbe }
            ).qianzaiProbe.calls.filter((c) => c.method === "POST").length,
        ),
      ).toBe(0);
      await p.screenshot({
        path: path.join(out, `preference-selected-${width}x${height}.png`),
      });
      frames.push({ viewport: { width, height }, ...metrics });
      await p.close();
    }
    facts.preferenceSelection = {
      controlledClockMs: 180,
      frames,
      scope:
        "selected bounds/radius and screenshot; no real-clock rhythm claim",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-names") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    await page.addStyleTag({
      content: '[class*="synthetic"]{display:none!important}',
    });
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    const frames: unknown[] = [];
    for (const [width, height] of [
      [320, 568],
      [430, 932],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const label of ["李白", "李清照", "爱新觉罗"]) {
        await page.evaluate(
          (label) =>
            (
              window as unknown as { qianzaiProbe: MotionProbe }
            ).qianzaiProbe.completed(label),
          label,
        );
        await page
          .getByRole("button", { name: "返回人物揭晓", exact: true })
          .click();
        const result = page.locator('[data-qianzai-screen="result"]');
        await expect(result).toBeVisible();
        const metrics = await result.evaluate((n) => {
          const entry = n
              .querySelector("[data-reveal-continue]")!
              .getBoundingClientRect(),
            identity = n
              .querySelector("[data-qianzai-scroll-region]")!
              .getBoundingClientRect();
          const glyphs = Array.from(n.querySelectorAll("h1 span"), (el) => {
            const r = el.getBoundingClientRect();
            return {
              top: r.top,
              bottom: r.bottom,
              left: r.left,
              right: r.right,
            };
          });
          return {
            entryTop: entry.top,
            entryBottom: entry.bottom,
            identityTop: identity.top,
            identityBottom: identity.bottom,
            glyphs,
            doc: document.documentElement.scrollHeight,
          };
        });
        expect(metrics.entryBottom).toBeLessThanOrEqual(height);
        expect(metrics.identityBottom).toBeLessThan(metrics.entryTop);
        expect(metrics.doc).toBe(height);
        expect(
          metrics.glyphs.every(
            (g) =>
              g.bottom < metrics.entryTop && g.left >= 0 && g.right <= width,
          ),
        ).toBe(true);
        await page.screenshot({
          path: path.join(
            out,
            `name-${Array.from(label).length}-${width}x${height}.png`,
          ),
        });
        frames.push({ label, width, height, ...metrics });
      }
    }
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: MotionProbe }
          ).qianzaiProbe.calls.filter((c) => c.method === "POST").length,
      ),
    ).toBe(0);
    facts.nameFallback = {
      scope:
        "pure synthetic readonly presentation, no formal role art, no verified receipt claim",
      frames,
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-first-act") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    await page.addStyleTag({
      content: '[class*="synthetic"]{display:none!important}',
    });
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.evaluate(() => document.fonts.ready);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const at = await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .evaluate((node) => {
        (node.querySelector("input") as HTMLInputElement).click();
        return performance.now();
      });
    const frames: unknown[] = [];
    for (const [name, offset] of [
      ["selection", 180],
      ["chapter-early", 530],
      ["chapter-first-act-caption", 750],
      ["first-question-incoming", 1030],
      ["first-question-ready", 1500],
    ] as const) {
      await page.waitForFunction(
        ({ at, offset }) => performance.now() >= at + offset,
        { at, offset },
        { polling: "raf", timeout: 5000 },
      );
      frames.push(
        await page.evaluate(
          ({ at, name, offset }) => ({
            name,
            offset,
            elapsedMs: performance.now() - at,
            kind: document
              .querySelector("[data-qianzai-transition]")
              ?.getAttribute("data-kind"),
            kicker: document.querySelector('[data-transition-part="kicker"]')
              ?.textContent,
            phase: document
              .querySelector("[data-qianzai-experience]")
              ?.getAttribute("data-view-phase"),
          }),
          { at, name, offset },
        ),
      );
      await page.screenshot({ path: path.join(out, `${name}.png`) });
    }
    await expect(stage).toBeHidden();
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    const calls = await page.evaluate(
      () =>
        (window as unknown as { qianzaiProbe: MotionProbe }).qianzaiProbe.calls,
    );
    expect(calls.filter((c) => c.path.endsWith("/save"))).toHaveLength(1);
    expect(calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(0);
    facts.firstActRealClock = {
      realClock: true,
      noClockInstallOrSeeking: true,
      frames,
      calls,
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "responsive-boundaries") {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    await page.addStyleTag({
      content: '[class*="synthetic"]{display:none!important}',
    });
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]"),
      question = page.locator('[data-qianzai-screen="question"]'),
      port = question.locator("[data-qianzai-scroll-region]");
    const inspect = () =>
      page.evaluate(() => {
        const p = (window as unknown as { qianzaiProbe: MotionProbe })
          .qianzaiProbe;
        return {
          calls: p.calls,
          snapshot: p.snapshot(),
          storage: JSON.stringify(sessionStorage),
          scroll: document.querySelector(
            '[data-qianzai-screen="question"] [data-qianzai-scroll-region]',
          )?.scrollTop,
        };
      });
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .first()
      .click();
    await page.clock.runFor(399);
    await expect(stage).toBeHidden();
    expect(
      (await inspect()).calls.filter((c) => c.method === "POST"),
    ).toHaveLength(0);
    await page.clock.runFor(1);
    await expect(stage).toHaveAttribute("data-kind", "chapter");
    await expect(stage).toHaveAttribute("data-act", "1");
    await expect(stage.locator('[data-transition-part="kicker"]')).toHaveText(
      "第一幕",
    );
    await expect(stage.locator('[data-transition-part="title"]')).toHaveText(
      "初识本心",
    );
    await expect(stage.locator('[data-transition-part="place"]')).toHaveText(
      "灯下问心",
    );
    await page.clock.runFor(438);
    expect(
      (await inspect()).calls.filter((c) => c.method === "POST"),
    ).toHaveLength(0);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.holdNext(),
    );
    await page.clock.runFor(1);
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    await expect(stage).toHaveAttribute("data-step", "wait");
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.release(),
    );
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.clock.runFor(451);
    await expect(stage).toBeHidden();
    expect(await question.evaluate((n) => n.closest("[inert]") !== null)).toBe(
      false,
    );
    await port.evaluate((n) => (n.scrollTop = 110));
    await question
      .locator('input[type="radio"]')
      .first()
      .evaluate((n) => (n as HTMLInputElement).click());
    await page.clock.runFor(399);
    expect((await inspect()).scroll).toBe(110);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.dropNext(),
    );
    await page.clock.runFor(156);
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    expect((await inspect()).scroll).toBe(110);
    await expect(stage).toBeHidden();
    const unknown = await inspect();
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => document.fonts.ready);
    expect((await inspect()).calls).toEqual(unknown.calls);
    expect((await inspect()).storage).toBe(unknown.storage);
    expect((await inspect()).scroll).toBe(110);
    await page
      .getByRole("button", { name: "核对保存结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    expect((await inspect()).scroll).toBe(110);
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    expect((await inspect()).snapshot.state?.progress.questionId).toBe("q-1");
    expect((await inspect()).scroll).toBe(0);
    await page.clock.runFor(350);
    expect(
      (await inspect()).calls.filter((c) => c.path.endsWith("/save")),
    ).toHaveLength(2);
    // Hide during the preference feedback; only a fresh explicit Enter may submit.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await question.getByRole("button", { name: "偏好", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await page.clock.runFor(399);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.setHidden(true),
    );
    await page.clock.runFor(2000);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.setHidden(false),
    );
    await page.clock.runFor(1000);
    expect(
      (await inspect()).calls.filter((c) => c.path.endsWith("/save")),
    ).toHaveLength(2);
    // Button can be below the short-screen fold; scroll its own reading port.
    await page
      .locator(
        '[data-qianzai-screen="preference"] [data-qianzai-scroll-region]',
      )
      .evaluate((n) => (n.scrollTop = n.scrollHeight));
    await page.getByRole("button", { name: "进入第一幕", exact: true }).click();
    await expect(stage).toHaveAttribute("data-kind", "chapter");
    await expect(stage.locator('[data-transition-part="kicker"]')).toHaveText(
      "第一幕",
    );
    await page.clock.runFor(438);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.runFor(1000);
    expect(
      (await inspect()).calls.filter((c) => c.path.endsWith("/save")),
    ).toHaveLength(2);
    await expect(stage).toBeHidden();
    await page.getByRole("button", { name: "进入第一幕", exact: true }).click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(question).toBeVisible();
    expect(
      (await inspect()).calls.filter((c) => c.path.endsWith("/save")),
    ).toHaveLength(3);
    // Long prompt/option fixtures are covered by the layout target, while these
    // read-only models exercise two-, three-, and four-character name fallback.
    for (const label of ["李白", "李清照", "爱新觉罗"]) {
      await page.evaluate(
        (label) =>
          (
            window as unknown as { qianzaiProbe: MotionProbe }
          ).qianzaiProbe.completed(label),
        label,
      );
      const report = page.locator('[data-qianzai-screen="report"]');
      await expect(report).toBeVisible();
      await report
        .getByRole("button", { name: "返回人物揭晓", exact: true })
        .click();
      const result = page.locator('[data-qianzai-screen="result"]'),
        identity = result.locator("[data-qianzai-scroll-region]"),
        entry = result.locator("[data-reveal-continue]");
      await expect(result).toBeVisible();
      const box = await result.evaluate((n) => {
        const identity = n
            .querySelector("[data-qianzai-scroll-region]")!
            .getBoundingClientRect(),
          name = n.querySelector("h1")!.getBoundingClientRect(),
          entry = n
            .querySelector("[data-reveal-continue]")!
            .getBoundingClientRect();
        return {
          identityBottom: identity.bottom,
          nameBottom: name.bottom,
          entryTop: entry.top,
          entryBottom: entry.bottom,
          documentHeight: document.documentElement.scrollHeight,
          height: innerHeight,
        };
      });
      expect(box.identityBottom).toBeLessThan(box.entryTop);
      expect(box.nameBottom).toBeLessThan(box.entryTop);
      expect(box.entryBottom).toBeLessThanOrEqual(box.height);
      expect(box.documentHeight).toBe(box.height);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await identity.evaluate((n) => {
        n.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
        );
        n.dispatchEvent(
          new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }),
        );
        const touch = (type: string, y: number) =>
          n.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              touches:
                type === "touchstart"
                  ? [
                      new Touch({
                        identifier: 1,
                        target: n,
                        clientX: 120,
                        clientY: y,
                      }),
                    ]
                  : [],
              changedTouches: [
                new Touch({
                  identifier: 1,
                  target: n,
                  clientX: 120,
                  clientY: y,
                }),
              ],
            }),
          );
        touch("touchstart", 350);
        touch("touchend", 200);
      });
      await expect(page.locator("[data-reader-page]")).toHaveAttribute(
        "data-reader-page",
        "result",
      );
      // A canceled blank-scene gesture cannot open the report later.
      await result.evaluate((n) => {
        const t = (y: number) =>
          new Touch({ identifier: 1, target: n, clientX: 120, clientY: y });
        n.dispatchEvent(
          new TouchEvent("touchstart", { bubbles: true, touches: [t(350)] }),
        );
        n.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true }));
        n.dispatchEvent(
          new TouchEvent("touchend", {
            bubbles: true,
            changedTouches: [t(200)],
          }),
        );
      });
      await expect(page.locator("[data-reader-page]")).toHaveAttribute(
        "data-reader-page",
        "result",
      );
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.screenshot({
        path: path.join(
          out,
          `fallback-${Array.from(label).length}-characters.png`,
        ),
      });
      await entry.click();
      await expect(report).toBeVisible();
      await report.locator("details").first().locator("summary").click();
      await report
        .getByRole("link", { name: "卷六 · 合成卷6", exact: true })
        .click();
      await expect
        .poll(() =>
          report
            .getByRole("progressbar", { name: "长卷阅读进度" })
            .getAttribute("aria-valuenow")
            .then(Number),
        )
        .toBeGreaterThan(50);
    }
    await page.clock.runFor(4000);
    expect(errors).toEqual([]);
    facts.responsiveBoundaries = {
      controlledClock: true,
      firstActAutoAndManualSameChapter: true,
      feedback400AndCommit439: true,
      hiddenAndReduceBeforeCommitNoSend: true,
      unknownKeepsScrollAndOriginalPending: true,
      resizeAndFontNoRequests: true,
      acceptedNextResetsScrollBeforePaint: true,
      savePosts: 3,
      readOnlyNameLengths: [2, 3, 4],
      entryInsideViewportAndNoOverlap: true,
      localScrollAndCanceledGestureNoReportNavigation: true,
      readonlyReportToc: true,
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "motion-boundaries") {
    await page.goto(`${origin}/?motion-question`);
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]"),
      question = page.locator('[data-qianzai-screen="question"]'),
      result = page.locator('[data-qianzai-screen="result"]'),
      report = page.locator('[data-qianzai-screen="report"]');
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    const act = (action: string) =>
      page.evaluate(async (action) => {
        const p = (window as unknown as { qianzaiProbe: MotionProbe })
          .qianzaiProbe;
        if (action === "preference")
          p.owner.onEvent({ type: "choose-preference", preference: "any" });
        else if (action === "hidden") p.setHidden(true);
        else if (action === "visible") p.setHidden(false);
        else if (action === "hold") p.holdNext();
        else if (action === "release") p.release();
        else if (action === "drop") p.dropNext();
        else if (action === "delay-art") p.delayArt();
        else if (action === "release-art") p.releaseArt();
        else if (action === "last") await p.prepareLast();
        else if (action === "remount") p.remountSameReport();
        else if (action === "unmount") p.unmount();
      }, action);
    const inspect = () =>
      page.evaluate(() => {
        const p = (window as unknown as { qianzaiProbe: MotionProbe })
          .qianzaiProbe;
        return {
          saves: p.calls.filter((c) => c.path.endsWith("/save")).length,
          completes: p.calls.filter((c) => c.path.endsWith("/complete")).length,
          resolves: p.calls.filter((c) => c.path.endsWith("/complete/resolve"))
            .length,
          storage: JSON.stringify(sessionStorage),
          snapshot: p.snapshot(),
        };
      });
    await act("preference");
    await question.locator("label").first().click();
    await page.clock.runFor(399);
    await act("hidden");
    await page.clock.runFor(1000);
    expect((await inspect()).saves).toBe(0);
    await expect(question.locator('input[type="radio"]').first()).toBeChecked();
    await act("visible");
    await page.clock.runFor(1000);
    expect((await inspect()).saves).toBe(0);
    // Retained selection is a new explicit Next gesture; hidden before155 cancels it.
    await question.getByRole("button", { name: "下一题", exact: true }).click();
    await page.clock.runFor(154);
    await act("hidden");
    await page.clock.runFor(1000);
    expect((await inspect()).saves).toBe(0);
    await act("visible");
    await question.getByRole("button", { name: "下一题", exact: true }).click();
    await page.clock.runFor(154);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.runFor(1000);
    expect((await inspect()).saves).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await act("hold");
    await question.getByRole("button", { name: "下一题", exact: true }).click();
    await page.clock.runFor(155);
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    await expect(stage).toHaveAttribute("data-step", "wait");
    const sent = await inspect();
    expect(sent.saves).toBe(1);
    expect(sent.snapshot.draft?.progress.questionId).toBe("q-0");
    await act("hidden");
    await page.clock.runFor(1000);
    expect((await inspect()).storage).toBe(sent.storage);
    expect((await inspect()).saves).toBe(1);
    await expect(stage).toBeHidden();
    await act("release");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    expect((await inspect()).snapshot.state?.progress.questionId).toBe("q-1");
    await act("visible");
    await page.clock.runFor(1000);
    expect((await inspect()).saves).toBe(1);
    await act("last");
    await page.clock.runFor(350);
    await question
      .getByRole("button", { name: "走向相逢", exact: true })
      .click();
    await expect(page.locator('[data-qianzai-screen="review"]')).toBeVisible();
    await act("hold");
    await act("drop");
    await act("delay-art");
    await page
      .getByRole("button", { name: "开启相逢", exact: true })
      .evaluate((node) => {
        (node as HTMLButtonElement).click();
        (node as HTMLButtonElement).click();
      });
    await expect(host).toHaveAttribute("data-view-phase", "completing");
    await page.clock.runFor(2000);
    expect((await inspect()).completes).toBe(1);
    await expect(result).toHaveCount(0);
    const completing = await inspect();
    await act("hidden");
    await page.clock.runFor(1000);
    expect((await inspect()).storage).toBe(completing.storage);
    await act("release");
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    await expect(stage).toBeHidden();
    await expect(result).toHaveCount(0);
    await act("visible");
    await page
      .getByRole("button", { name: "核对相逢结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    await expect(result).toHaveCount(0);
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "completed");
    const receipt = (await inspect()).snapshot.report!.receipt;
    await page.clock.runFor(32);
    await expect(stage).toHaveAttribute("data-kind", "reveal");
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "waiting",
    );
    await page.clock.runFor(525);
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "playing",
    );
    await page.clock.runFor(2050);
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "ready",
    );
    await expect(result.locator("img")).toHaveCount(0);
    await act("release-art");
    await expect(result.locator("img")).toHaveCount(2);
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "ready",
    );
    await act("remount");
    await page.clock.runFor(32);
    await expect(stage).toBeHidden();
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "ready",
    );
    await expect(result.locator("img")).toHaveCount(2);
    await result.evaluate((node) => {
      for (let i = 0; i < 5; i++)
        node.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 90, bubbles: true }),
        );
    });
    await page.clock.runFor(32);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("[data-reader-page]")).toHaveAttribute(
      "data-reader-page",
      "report",
    );
    await expect(page.locator("[data-reader-moving]")).toHaveCount(0);
    await expect(report).toBeVisible();
    await report
      .getByRole("button", { name: "返回人物揭晓", exact: true })
      .click();
    await expect(result).toBeVisible();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await result.locator("[data-reveal-continue]").click();
    await page.clock.runFor(750);
    await expect(report).toBeVisible();
    await page.keyboard.press("Escape");
    await page.clock.runFor(750);
    await expect(result).toBeVisible();
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "ready",
    );
    expect((await inspect()).snapshot.report!.receipt).toEqual(receipt);
    expect((await inspect()).completes).toBe(1);
    expect((await inspect()).resolves).toBe(1);
    await result.getByLabel("揭晓选项", { exact: true }).click();
    await result
      .getByRole("button", { name: "重新播放揭晓", exact: true })
      .click();
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "playing",
    );
    await act("unmount");
    await page.clock.runFor(4000);
    expect((await inspect()).completes).toBe(1);
    await expect(
      page.locator("img,canvas,[data-qianzai-experience]"),
    ).toHaveCount(0);
    await page.close();
    // A separate owned page proves authority loss invalidates an unsent midpoint.
    const revoked = await browser.newPage();
    revoked.on("pageerror", (e) => errors.push(e.message));
    await revoked.goto(`${origin}/?motion-question`);
    await expect(revoked.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await expect(
      revoked.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await revoked.clock.install();
    await revoked.clock.pauseAt(new Date(Date.now() + 100));
    await revoked.evaluate(() => {
      const p = (window as unknown as { qianzaiProbe: MotionProbe })
        .qianzaiProbe;
      p.owner.onEvent({ type: "choose-preference", preference: "any" });
    });
    await revoked
      .locator('[data-qianzai-screen="question"] label')
      .first()
      .click();
    await revoked.clock.runFor(554);
    await revoked.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.owner.revoke(),
    );
    await revoked.clock.runFor(2000);
    await expect(
      revoked.getByRole("heading", { name: "本次访问已结束", exact: true }),
    ).toBeVisible();
    expect(
      await revoked.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: MotionProbe }
          ).qianzaiProbe.calls.filter((c) => c.method === "POST").length,
      ),
    ).toBe(0);
    await expect(revoked.locator("img,canvas")).toHaveCount(0);
    await revoked.close();
    facts.motionBoundaries = {
      controlledClockOnly: true,
      feedbackHidden399ZeroSends: true,
      midpointHidden154ZeroSends: true,
      reducedBeforeMidpointZeroSends: true,
      hiddenAfterSendPreservedOriginalPending: true,
      slowAndUnknownCompleteNoReveal: true,
      doubleCompleteClickOneOriginalPost: true,
      explicitResolveSameReceipt: true,
      leaseRemountRevealOnce: true,
      lateDecodedArtNoReplay: true,
      repeatedReaderAndReplayZeroCompleteResend: true,
      reducedReadingSettlesDestination: true,
      revokeAndUnmountCancelStaleCallbacks: true,
      art: "existing 48px synthetic test noise markers; no official artwork/admission claim",
      receipt,
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "motion-showcase") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]"),
      question = page.locator('[data-qianzai-screen="question"]'),
      result = page.locator('[data-qianzai-screen="result"]'),
      report = page.locator('[data-qianzai-screen="report"]');
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(page.locator('[data-qianzai-screen="cover"] img')).toHaveCount(
      1,
    );
    await page.evaluate(() => document.fonts.ready);
    const samples: unknown[] = [],
      start = () => page.evaluate(() => performance.now());
    const sample = async (name: string, startAt: number, offset: number) => {
      await page.waitForFunction(
        ({ startAt, offset }) => performance.now() >= startAt + offset,
        { startAt, offset },
        { polling: "raf", timeout: 6000 },
      );
      const measured = await page.evaluate(
        ({ startAt, offset }) => {
          const node = (selector: string) => {
            const el = document.querySelector<HTMLElement>(selector);
            if (!el) return null;
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect();
            return {
              opacity: s.opacity,
              filter: s.filter,
              transform: s.transform,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              visible: el.checkVisibility(),
            };
          };
          return {
            elapsedMs: performance.now() - startAt,
            requestedOffsetMs: offset,
            phase: document
              .querySelector("[data-qianzai-experience]")
              ?.getAttribute("data-view-phase"),
            transition: document
              .querySelector("[data-qianzai-transition]")
              ?.getAttribute("data-kind"),
            revealPhase: document
              .querySelector("[data-reveal-phase]")
              ?.getAttribute("data-reveal-phase"),
            identity: node('[class*="revealIdentity"]'),
            portrait: node('[class*="revealArt"]'),
            readerPaper: node("[data-reader-paper]"),
            overflow: document.documentElement.scrollWidth > innerWidth,
            question: (
              window as unknown as { qianzaiProbe: MotionProbe }
            ).qianzaiProbe.snapshot().state?.progress.questionId,
          };
        },
        { startAt, offset },
      );
      expect(measured.overflow).toBe(false);
      await page.screenshot({ path: path.join(out, `${name}.png`) });
      samples.push({ name, ...measured });
      await writeFile(
        path.join(out, "samples.in-progress.json"),
        JSON.stringify(samples, null, 2),
      );
    };
    let at = await start();
    await sample("cover-arrival", at, 0);
    await sample("cover-water-arriving", at, 1100);
    await sample("cover-water-lantern-petals", at, 2600);
    at = await start();
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await sample("cover-lift", at, 150);
    await sample("cover-preference-veil", at, 370);
    await sample("preference-arrived", at, 760);
    at = await start();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await sample("preference-selection-feedback", at, 200);
    await sample("preference-question-veil", at, 650);
    await sample("first-question-arrived", at, 1400);
    await expect(question).toBeVisible();
    await expect(stage).toBeHidden();
    at = await start();
    await question.locator("label").first().click();
    await sample("answer-feedback", at, 200);
    await sample("same-act-paper-out", at, 510);
    await sample("same-act-paper-in", at, 680);
    await sample("same-act-next-ready", at, 1100);
    at = await start();
    await question.getByRole("button", { name: "上一题", exact: true }).click();
    await sample("same-act-back-paper", at, 110);
    await sample("same-act-back-ready", at, 650);
    for (const [index, act] of [
      [7, 2],
      [15, 3],
    ] as const) {
      await page.getByRole("button", { name: "旅程", exact: true }).click();
      await page
        .locator('[data-qianzai-screen="resume"] li')
        .nth(index)
        .getByRole("button")
        .click();
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      await expect(stage).toBeHidden();
      at = await start();
      await question.locator("label").first().click();
      await sample(`chapter-${act}-caption`, at, 690);
      await sample(`chapter-${act}-incoming`, at, 1000);
      await sample(`chapter-${act}-ready`, at, 1450);
    }
    await page.evaluate(async () =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.prepareLast(),
    );
    await expect(stage).toBeHidden();
    await question
      .getByRole("button", { name: "走向相逢", exact: true })
      .click();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.holdNext(),
    );
    at = await start();
    await page.getByRole("button", { name: "开启相逢", exact: true }).click();
    await expect(host).toHaveAttribute("data-view-phase", "completing");
    await sample("complete-wait-no-person", at, 800);
    await expect(result).toHaveCount(0);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: MotionProbe }
      ).qianzaiProbe.release(),
    );
    await expect(host).toHaveAttribute("data-view-phase", "completed");
    await expect(stage).toHaveAttribute("data-kind", "reveal");
    at = await start();
    await sample("reveal-veil", at, 240);
    await sample("reveal-portrait-before-identity", at, 620);
    await sample("reveal-name-early", at, 1200);
    await sample("reveal-name-recognition", at, 1700);
    await sample("reveal-name-ready", at, 2600);
    await expect(result.locator("img")).toHaveCount(2);
    const revealSamples = samples.slice(-5) as {
      identity: { opacity: string } | null;
      portrait: { opacity: string } | null;
    }[];
    expect(Number(revealSamples[1]!.portrait!.opacity)).toBe(1);
    expect(Number(revealSamples[1]!.identity!.opacity)).toBeLessThan(0.15);
    expect(Number(revealSamples[4]!.identity!.opacity)).toBe(1);
    at = await start();
    await result.locator("[data-reveal-continue]").click();
    await sample("report-slide-early", at, 120);
    await sample("report-slide-near", at, 380);
    await sample("report-slide-ready", at, 850);
    await report.locator("details").first().locator("summary").click();
    await report
      .getByRole("link", { name: "卷六 · 合成卷6", exact: true })
      .click();
    await expect
      .poll(() =>
        report
          .getByRole("progressbar", { name: "长卷阅读进度" })
          .getAttribute("aria-valuenow")
          .then(Number),
      )
      .toBeGreaterThan(50);
    await check(page, "motion-report-contents", 390);
    await report
      .locator("details[data-report-evidence]")
      .first()
      .locator("summary")
      .click();
    await check(page, "motion-report-evidence", 390);
    at = await start();
    await report
      .getByRole("button", { name: "返回人物揭晓", exact: true })
      .click();
    await sample("report-return-slide", at, 140);
    await sample("report-return-ready-no-replay", at, 850);
    await expect(result.locator("[data-reveal-phase]")).toHaveAttribute(
      "data-reveal-phase",
      "ready",
    );
    await check(page, "motion-reveal", 320);
    await result.locator("[data-reveal-continue]").click();
    await expect(page.locator("[data-reader-moving]")).toHaveCount(0);
    await check(page, "motion-report", 320);
    await page.setViewportSize({ width: 390, height: 844 });
    await report
      .getByRole("button", { name: "返回人物揭晓", exact: true })
      .click();
    await expect(page.locator("[data-reader-moving]")).toHaveCount(0);
    await result.getByLabel("揭晓选项", { exact: true }).click();
    await result
      .getByRole("button", { name: "重新播放揭晓", exact: true })
      .click();
    at = await start();
    await sample("explicit-replay-recognition", at, 1050);
    await sample("explicit-replay-ready", at, 2200);
    const calls = await page.evaluate(
      () =>
        (window as unknown as { qianzaiProbe: MotionProbe }).qianzaiProbe.calls,
    );
    expect(calls.filter((c) => c.path.endsWith("/complete"))).toHaveLength(1);
    facts.motionShowcase = {
      realClock: true,
      noClockInstallOrTimelineSeeking: true,
      art: "existing 48px synthetic noise markers in real portrait/nameArt DOM layers; no formal artwork or catalog admission",
      covered: [
        "V8 arrival/water/lantern/petals/CTA",
        "preference/first question",
        "answer feedback/next/back",
        "chapter2/chapter3",
        "slow completion",
        "lease-remounted layered reveal",
        "report slide/contents/evidence/return",
        "explicit read-only replay",
        "320px reader",
      ],
      samples,
      completePosts: 1,
      calls,
      originalReference:
        ".cache/qztx-motion/reference-live-corrected; coordinator owns original report clip",
    };
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "reflection-evidence") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]'),
      article = report.locator('article[data-volume="counterevidence"]'),
      groups = article.locator(":scope>div");
    await expect(groups.nth(0).locator(":scope>section")).toHaveCount(2);
    await expect(groups.nth(1).locator(":scope>section")).toHaveCount(3);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const primary = groups
          .nth(0)
          .locator("details[data-report-evidence]")
          .first(),
        note = groups.nth(1).locator("details[data-report-evidence]").first();
      for (const evidence of [primary, note]) {
        await evidence.locator("summary").focus();
        await page.keyboard.press("Enter");
        await expect(evidence).toHaveAttribute("open", "");
        await expect(evidence.locator("blockquote").first()).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(evidence).not.toHaveAttribute("open", "");
        await expect(evidence.locator("summary")).toBeFocused();
      }
      await expect(
        article.getByText("证据不足时的说明 · 本轮情境", { exact: true }),
      ).toBeVisible();
      const columns = await groups
        .nth(1)
        .evaluate(
          (n) => getComputedStyle(n).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(width === 390 ? 2 : 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    facts.reflectionEvidence = {
      widths: [390, 320],
      primaryParagraphs: 2,
      flowingNotes: 3,
      allEvidencePreserved: true,
      keyboardExpandCollapse: true,
      focusRetained: true,
      scope: "synthetic snapshot only",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "fidelity-report") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]'),
      scroll = report.locator(":scope>div"),
      nav = report.locator("header").first();
    expect(referenceInput?.nonEmpty).toBe(true);
    expect(await report.locator("article>header h2").allTextContents()).toEqual(
      body.volumes.map((v) => v.title),
    );
    for (const volume of body.volumes) {
      expect(
        await report
          .locator(
            `article[data-volume="${volume.id}"] section[data-kind]>p:first-child`,
          )
          .allTextContents(),
      ).toEqual(volume.paragraphs.map((p) => p.text));
    }
    const geometry: Record<string, unknown> = {};
    const move = async (top: number) => {
      const expected = await scroll.evaluate((n, top) => {
        const max = n.scrollHeight - n.clientHeight;
        n.scrollTo({ top, behavior: "instant" });
        return {
          top: Math.max(0, Math.min(top, max)),
          percent: Math.round((Math.max(0, Math.min(top, max)) / max) * 100),
        };
      }, top);
      await expect
        .poll(async () =>
          scroll.evaluate(
            (n, top) => Math.abs(n.scrollTop - top),
            expected.top,
          ),
        )
        .toBeLessThan(1);
      await expect
        .poll(async () =>
          Number(
            await report.getByRole("progressbar").getAttribute("aria-valuenow"),
          ),
        )
        .toBe(expected.percent);
      await expect
        .poll(() => nav.getAttribute("data-paper"))
        .toBe(expected.top > 210 ? "true" : "false");
    };
    const capture = async (name: string) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const width = page.viewportSize()!.width;
      geometry[width === 390 ? name : `${name}-${width}`] =
        await report.evaluate((n) => {
          const scroll = n.firstElementChild!,
            nav = n.querySelector("header")!,
            hero = n.querySelector("main")!.previousElementSibling!;
          const nodes = [
            nav,
            hero,
            n.querySelector("main")!,
            ...n.querySelectorAll(
              "article>header h2,article section[data-kind]>p:first-child",
            ),
          ];
          return {
            top: scroll.scrollTop,
            percent: n
              .querySelector("[role=progressbar]")
              ?.getAttribute("aria-valuenow"),
            nodes: nodes.map((n) => {
              const r = n.getBoundingClientRect(),
                s = getComputedStyle(n);
              return {
                text: n.textContent?.trim().slice(0, 60),
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                font: s.font,
                background: s.backgroundColor,
              };
            }),
          };
        });
      await page.screenshot({
        path: path.join(out, `fidelity-report-${name}-${width}.png`),
      });
    };
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (process.env.QZTX_FIDELITY_VOLUME === "counterevidence") {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const top = await report
          .locator('[data-report-chapter-id="counterevidence"]')
          .evaluate((n) => {
            const scroll = n.closest("main")!.parentElement!.parentElement!;
            return (
              scroll.scrollTop +
              n.getBoundingClientRect().top -
              scroll.getBoundingClientRect().top -
              128
            );
          });
        await move(top);
        await capture("counterevidence");
      }
    } else {
      await move(0);
      await capture("top");
      await move(210);
      await expect(nav).toHaveAttribute("data-paper", "false");
      await move(211);
      await expect(nav).toHaveAttribute("data-paper", "true");
      await move(300);
      await capture("handoff");
      for (const volume of body.volumes) {
        const target = report.locator(
          `[data-report-chapter-id="${volume.id}"]`,
        );
        const top = await target.evaluate((n) => {
          const scroll = n.closest("main")!.parentElement!.parentElement!;
          return (
            scroll.scrollTop +
            n.getBoundingClientRect().top -
            scroll.getBoundingClientRect().top -
            128
          );
        });
        await move(top);
        await capture(volume.id);
      }
      await move(await scroll.evaluate((n) => n.scrollHeight - n.clientHeight));
      await capture("end");
    }
    facts.reportFidelity = {
      geometry,
      viewports: process.env.QZTX_FIDELITY_VOLUME
        ? [
            [390, 844],
            [320, 844],
          ]
        : [[390, 844]],
      source: process.env.QZTX_REPORT_REFERENCE_HTML
        ? "explicit original HTML demo content projected into synthetic DTO"
        : "synthetic fixture",
      stateBar:
        "original HTML includes a simulated 30px system status row; webpage does not fabricate it",
      missingFields:
        "snapshot has no role title, tags or quote source fields; none inferred or hardcoded",
      scope: "offline comparison, not production or author acceptance",
    };
  } else if (
    ["fidelity", "fidelity-question-footer"].includes(
      process.env.QZTX_CAPTURE_TARGET ?? "",
    )
  ) {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    // This is a comparison canvas, not an author/production receipt. Keep the
    // synthetic scope in the result metadata, outside the 390x844 page artwork.
    await page
      .getByText("合成内容与视觉容器验证 · 非正式题目或作者美术验收", {
        exact: true,
      })
      .evaluate((node) => {
        node.style.display = "none";
      });
    const geometry: Record<string, unknown> = {};
    const captureOne = async (name: string, screen: string, width: number) => {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const view = page.locator(`[data-qianzai-screen="${screen}"]`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await view.getByRole("button").evaluateAll((nodes) =>
          nodes.every((n) => {
            const r = n.getBoundingClientRect();
            return r.width >= 44 && r.height >= 44;
          }),
        ),
      ).toBe(true);
      geometry[width === 390 ? name : `${name}-${width}`] = await view
        .locator("header, h1, h2, fieldset, label, button, [role=progressbar]")
        .evaluateAll((nodes) =>
          nodes.map((node) => {
            const r = node.getBoundingClientRect(),
              css = getComputedStyle(node);
            return {
              tag: node.tagName,
              text: node.textContent?.trim().slice(0, 90),
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              font: css.font,
              lineHeight: css.lineHeight,
              background: css.backgroundColor,
            };
          }),
        );
      await page.screenshot({
        path: path.join(out, `fidelity-${name}-${width}.png`),
      });
    };
    const capture = async (name: string, screen: string) => {
      for (const width of process.env.QZTX_CAPTURE_TARGET ===
      "fidelity-question-footer"
        ? [390]
        : [320, 375, 390, 430])
        await captureOne(name, screen, width);
      await page.setViewportSize({ width: 390, height: 844 });
    };
    await expect(
      page.locator('[data-qianzai-screen="cover"] > div > img'),
    ).toBeVisible();
    if (process.env.QZTX_CAPTURE_TARGET === "fidelity")
      await capture("cover", "cover");
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await expect(
      page.locator('[data-qianzai-screen="preference"] > img'),
    ).toBeVisible();
    if (process.env.QZTX_CAPTURE_TARGET === "fidelity")
      await capture("preference", "preference");
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .first()
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    for (const [index, name] of [
      [0, "act-one"],
      [8, "act-two"],
      [16, "act-three"],
    ] as const) {
      await page.evaluate(
        (index) =>
          (
            window as unknown as {
              qianzaiProbe: {
                owner: {
                  onEvent(e: { type: "navigate"; questionId: string }): void;
                };
              };
            }
          ).qianzaiProbe.owner.onEvent({
            type: "navigate",
            questionId: `q-${index}`,
          }),
        index,
      );
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      await expect(
        page.locator('[data-qianzai-screen="question"] [role=progressbar]'),
      ).toHaveAttribute("aria-valuenow", String(index + 1));
      await capture(name, "question");
    }
    if (process.env.QZTX_CAPTURE_TARGET === "fidelity-question-footer") {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.clock.install();
      await page.clock.pauseAt(new Date(Date.now() + 100));
      const paper = page.locator('[data-qianzai-screen="question"] h2'),
        before = await paper.boundingBox();
      await page
        .locator('[data-qianzai-screen="question"] label')
        .first()
        .click();
      await page.clock.runFor(400);
      await expect(page.locator("[data-qianzai-transition]")).toHaveAttribute(
        "data-kind",
        "paper",
      );
      expect(Math.abs((await paper.boundingBox())!.y - before!.y)).toBeLessThan(
        1,
      );
      await page.clock.runFor(155);
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      await page.clock.runFor(400);
      await expect(page.locator("[data-qianzai-transition]")).toBeHidden();
      facts.footerPaperTransition = {
        noLayoutShift: true,
        scope: "new footer background only; previous stage matrix reused",
      };
    }
    facts.fidelity = {
      geometry,
      canvas: [390, 844],
      scope:
        "prototype bytes and synthetic HTTP, comparison canvas excludes synthetic banner; no production/author acceptance",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "preference-receipt") {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]"),
      question = page.locator('[data-qianzai-screen="question"]'),
      receipt = question.getByRole("status").first();
    const snapshot = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            qianzaiProbe: { snapshot(): ConsumerV2ReaderModel };
          }
        ).qianzaiProbe.snapshot(),
      );
    const event = (e: ConsumerV2ReaderEvent) =>
      page.evaluate(
        (e) =>
          (
            window as unknown as {
              qianzaiProbe: {
                owner: { onEvent(e: ConsumerV2ReaderEvent): void };
              };
            }
          ).qianzaiProbe.owner.onEvent(e),
        e,
      );
    const saveCount = () =>
      page.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("/save")).length,
      );
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .first()
      .click();
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(receipt).toHaveText("已保存");
    const before = await snapshot(),
      posts = await saveCount();
    await event({
      type: "choose-preference",
      preference:
        before.draft!.matchingContext!.preference === "male"
          ? "female"
          : "male",
    });
    const dirty = await snapshot();
    expect(dirty.draft!.answers).toEqual(before.draft!.answers);
    expect(dirty.draft!.progress).toEqual(before.draft!.progress);
    expect(dirty.draft!.matchingContext).not.toEqual(
      before.draft!.matchingContext,
    );
    await expect(receipt).toHaveText("本轮选择");
    await page.evaluate(() => {
      const probe = (
        window as unknown as {
          qianzaiProbe: { holdNext(): void; dropNext(): void };
        }
      ).qianzaiProbe;
      probe.holdNext();
      probe.dropNext();
    });
    await event({ type: "save" });
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    await expect(receipt).toHaveText("保存中");
    expect((await snapshot()).state).toEqual(before.state);
    expect(await saveCount()).toBe(posts + 1);
    await page.screenshot({
      path: path.join(out, "preference-receipt-saving-390.png"),
      fullPage: true,
    });
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { release(): void } }
      ).qianzaiProbe.release(),
    );
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    await expect(receipt).toHaveText("待核实");
    expect((await snapshot()).pendingOperation).toBe("save");
    await page.screenshot({
      path: path.join(out, "preference-receipt-unknown-390.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "核对保存结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    await expect(receipt).toHaveText("待核实");
    expect(await saveCount()).toBe(posts + 1);
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(receipt).toHaveText("已保存");
    const reconciled = await snapshot();
    expect(reconciled.pendingOperation).toBeNull();
    expect(reconciled.state!.matchingContext).toEqual(
      dirty.draft!.matchingContext,
    );
    expect(reconciled.state!.answers).toEqual(before.state!.answers);
    expect(reconciled.state!.progress).toEqual(before.state!.progress);
    expect(await saveCount()).toBe(posts + 1);
    facts.preferenceReceipt = {
      preferenceOnly: true,
      delayedReceiptUnconfirmed: true,
      lostReceiptUnconfirmed: true,
      conflictUnconfirmed: true,
      explicitReconciliationRestoresSaved: true,
      savePosts: 1,
      scope: "real controller with synthetic HTTP; no production/DB claim",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "transitions") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]"),
      stage = page.locator("[data-qianzai-transition]"),
      question = page.locator('[data-qianzai-screen="question"]');
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    const id = () =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              qianzaiProbe: {
                snapshot(): {
                  draft: { progress: { questionId: string | null } };
                };
              };
            }
          ).qianzaiProbe.snapshot().draft.progress.questionId,
      );
    const saveCount = () =>
      page.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("/save")).length,
      );
    const frame = async (name: string, ms: number) => {
      await expect(stage).toBeVisible();
      await stage.evaluate((node, ms) => {
        for (const animation of node.getAnimations({ subtree: true })) {
          animation.currentTime = ms;
          animation.pause();
        }
      }, ms);
      if ((await stage.getAttribute("data-kind")) === "paper")
        await question.evaluate((node, ms) => {
          for (const animation of node.getAnimations({ subtree: true })) {
            const timing = animation.effect?.getComputedTiming();
            if (timing && Number.isFinite(timing.endTime)) {
              animation.currentTime = ms;
              animation.pause();
            }
          }
        }, ms);
      await page.screenshot({
        path: path.join(out, name + ".png"),
        fullPage: true,
      });
    };
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await expect(stage).toHaveAttribute("data-kind", "cover");
    await page.clock.runFor(336);
    await expect(page.locator('[data-qianzai-screen="cover"]')).toBeVisible();
    await page.clock.runFor(1);
    await expect(
      page.locator('[data-qianzai-screen="preference"]'),
    ).toBeVisible();
    await frame("cover-veil-midpoint-337ms", 337);
    await page.clock.runFor(353);
    await expect(stage).toBeHidden();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await page.getByRole("button", { name: "进入第一幕", exact: true }).click();
    expect(await saveCount()).toBe(0);
    await page.clock.runFor(399);
    await expect(stage).toBeHidden();
    await page.clock.runFor(1);
    await expect(stage).toHaveAttribute("data-kind", "chapter");
    await page.clock.runFor(438);
    await expect(
      page.locator('[data-qianzai-screen="preference"]'),
    ).toBeVisible();
    await page.clock.runFor(1);
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await frame("first-act-midpoint-439ms", 439);
    await page.clock.runFor(451);
    await expect(stage).toBeHidden();
    await page.screenshot({
      path: path.join(out, "transition-final-act-1.png"),
      fullPage: true,
    });
    await question.locator("label").first().click();
    const beforeFastNext = await saveCount();
    await question.getByRole("button", { name: "下一题", exact: true }).click();
    expect(await saveCount()).toBe(beforeFastNext);
    expect(await id()).toBe("q-0");
    await page.clock.runFor(400);
    await expect(stage).toHaveAttribute("data-kind", "paper");
    await page.clock.runFor(154);
    expect(await id()).toBe("q-0");
    await expect(
      question.locator('svg[class*="answerBackdrop"]'),
    ).toBeVisible();
    expect(
      await question
        .locator(":scope>img")
        .evaluate((node) => getComputedStyle(node).clipPath),
    ).not.toBe("none");
    await frame("paper-out-opaque-plane-154ms", 154);
    await page.clock.runFor(1);
    await expect.poll(id).toBe("q-1");
    await page.clock.runFor(310);
    await expect(stage).toBeHidden();
    for (const [from, to, act] of [
      [7, 8, 2],
      [15, 16, 3],
    ] as const) {
      await page.getByRole("button", { name: "旅程", exact: true }).click();
      await page
        .locator('[data-qianzai-screen="resume"] li')
        .nth(from)
        .getByRole("button")
        .click();
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      await question.locator("label").first().click();
      await page.clock.runFor(400);
      await expect(stage).toHaveAttribute("data-kind", "chapter");
      await expect(stage).toHaveAttribute("data-act", String(act));
      await page.clock.runFor(438);
      expect(await id()).toBe("q-" + from);
      await page.clock.runFor(1);
      await expect.poll(id).toBe("q-" + to);
      await expect(stage.locator('[data-transition-part="title"]')).toHaveText(
        act === 2 ? "命运抉择" : "归于何处",
      );
      expect(
        await stage.evaluate(
          (node) => getComputedStyle(node, "::after").backgroundImage,
        ),
      ).toContain(act === 2 ? "repeating-linear-gradient" : "radial-gradient");
      await frame(`chapter-${act}-midpoint-439ms`, 439);
      await page.clock.runFor(451);
      await expect(stage).toBeHidden();
      await page.screenshot({
        path: path.join(out, `transition-final-act-${act}.png`),
        fullPage: true,
      });
    }
    const preUnknown = await saveCount();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { dropNext(): void } }
      ).qianzaiProbe.dropNext(),
    );
    await question.locator("label").first().click();
    await page.clock.runFor(555);
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    await expect(stage).toBeHidden();
    await page.clock.runFor(1000);
    expect(await saveCount()).toBe(preUnknown + 1);
    await page
      .getByRole("button", { name: "核对保存结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect.poll(id).toBe("q-17");
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { holdNext(): void } }
      ).qianzaiProbe.holdNext(),
    );
    await question.locator("label").first().click();
    await page.clock.runFor(555);
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    expect(await id()).toBe("q-17");
    await page.clock.runFor(400);
    expect(await id()).toBe("q-17");
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { release(): void } }
      ).qianzaiProbe.release(),
    );
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect.poll(id).toBe("q-18");
    const before = await saveCount();
    await question.locator("label").first().click();
    await page.clock.runFor(500);
    await expect(stage).toHaveAttribute("data-kind", "paper");
    await page.evaluate(() =>
      (
        window as unknown as {
          qianzaiProbe: { owner: { onEvent(e: { type: "logout" }): void } };
        }
      ).qianzaiProbe.owner.onEvent({ type: "logout" }),
    );
    await expect(
      page.getByRole("heading", { name: "本次访问已结束", exact: true }),
    ).toBeVisible();
    await page.clock.runFor(1000);
    expect(await saveCount()).toBe(before);
    await expect(page.locator("img,canvas")).toHaveCount(0);
    const reduced = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    reduced.on("pageerror", (e) => errors.push(e.message));
    await reduced.goto(origin);
    await expect(reduced.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await reduced.clock.install();
    await reduced.clock.pauseAt(new Date(Date.now() + 100));
    await reduced
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await expect(
      reduced.locator('[data-qianzai-screen="preference"]'),
    ).toBeVisible();
    await reduced
      .locator('[data-qianzai-screen="preference"] label')
      .first()
      .click();
    await reduced.clock.runFor(399);
    await expect(
      reduced.locator('[data-qianzai-screen="preference"]'),
    ).toBeVisible();
    await reduced.clock.runFor(1);
    await expect(
      reduced.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(reduced.locator("[data-qianzai-transition]")).toBeHidden();
    await reduced.close();
    facts.transitions = {
      coverCommitMs: 337,
      firstActCommitMs: 439,
      selectionFeedbackMs: 400,
      paperCommitMs: 155,
      chapterCommitMs: 439,
      chapterAtmospheres: ["rain", "stars"],
      opaquePlane: true,
      cancelledBeforeSubmit: true,
      unknownCancelledStageWithoutResend: true,
      heldReceiptDidNotAdvance: true,
      reducedMotionKeepsFeedbackWithoutStage: true,
      scope:
        "controlled clock and CSS timeline; real controller with synthetic HTTP, not device/production evidence",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "authored") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      page.locator('[data-qianzai-screen="cover"] img'),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    const questions = session.entry.facts.entry.questions;
    const longestPrompt = questions.reduce(
      (best, q, i) =>
        q.prompt.length > questions[best]!.prompt.length ? i : best,
      0,
    );
    const longestOption = questions.reduce(
      (best, q, i) =>
        Math.max(...q.options.map((o) => o.label.length)) >
        Math.max(...questions[best]!.options.map((o) => o.label.length))
          ? i
          : best,
      0,
    );
    const question = page.locator('[data-qianzai-screen="question"]');
    for (const index of new Set([longestPrompt, longestOption])) {
      await page.getByRole("button", { name: "旅程", exact: true }).click();
      await page
        .locator('[data-qianzai-screen="resume"] li')
        .nth(index)
        .getByRole("button")
        .click();
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      for (const width of process.env.QZTX_PARITY_EDGE_CHECK === "1"
        ? [index === longestPrompt ? 390 : 320]
        : [320, 375, 390, 430, 1024])
        await check(page, `authored-q${index + 1}`, width);
      await expect(
        question.getByRole("button", { name: "上一题", exact: true }),
      ).toBeVisible();
      expect(
        await question
          .getByRole("button", { name: "上一题", exact: true })
          .evaluate((node) => getComputedStyle(node).backgroundImage),
      ).toContain("blob:");
    }
    facts.authoredText = {
      questions: 24,
      longestPromptQuestion: longestPrompt + 1,
      promptLength: questions[longestPrompt]!.prompt.length,
      longestOptionQuestion: longestOption + 1,
      optionLength: Math.max(
        ...questions[longestOption]!.options.map((o) => o.label.length),
      ),
      scope:
        "actual author question/option text with synthetic HTTP; no author answers, DB or scoring rerun",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "layers") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      page.locator('[data-qianzai-screen="cover"] img'),
    ).toBeVisible();
    await check(page, "cover-controls-refined", 390);
    await page
      .getByRole("button", { name: "封面动效设置", exact: true })
      .click();
    await page.getByRole("button", { name: "暂停动效", exact: true }).click();
    await expect(
      page.locator('[data-qianzai-screen="cover"] [data-motion]'),
    ).toHaveAttribute("data-motion", "paused");
    expect(
      await page
        .locator('[data-qianzai-screen="cover"] [aria-hidden="true"]')
        .evaluateAll((nodes) =>
          nodes
            .filter((n) =>
              getComputedStyle(n, "::after").animationName.includes(
                "waterwayPulse",
              ),
            )
            .map((n) => getComputedStyle(n, "::after").animationPlayState),
        ),
    ).toEqual(["paused"]);
    await page
      .getByRole("button", { name: "封面动效设置", exact: true })
      .click();
    await page.getByRole("button", { name: "继续动效", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await page
        .locator('[data-qianzai-screen="cover"] [aria-hidden="true"]')
        .evaluateAll((nodes) =>
          nodes.every(
            (n) =>
              !getComputedStyle(n, "::after").animationName.includes(
                "waterwayPulse",
              ),
          ),
        ),
    ).toBe(true);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await check(page, "preference-controls-refined", 390);
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    const question = page.locator('[data-qianzai-screen="question"]');
    await expect(question).toHaveAttribute("data-qianzai-composite", "true");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await check(page, "controls-original-composition", 390);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { hideQuestionPaper(): void } }
      ).qianzaiProbe.hideQuestionPaper(),
    );
    await expect(question.locator("img")).toHaveCount(0);
    await expect(question.locator("h2")).toBeVisible();
    await check(page, "missing-paper-no-baked-base", 390);
    await page.evaluate(() =>
      (
        window as unknown as {
          qianzaiProbe: { owner: { onEvent(event: { type: "logout" }): void } };
        }
      ).qianzaiProbe.owner.onEvent({ type: "logout" }),
    );
    await expect(
      page.getByRole("heading", { name: "本次访问已结束", exact: true }),
    ).toBeVisible();
    await expect(page.locator("img,canvas")).toHaveCount(0);
    await check(page, "denied-no-art-or-canvas", 390);
    facts.layerGuards = {
      missingCompositionRemovesBase: true,
      textRemains: true,
      deniedRemovesAllImagesAndCanvas: true,
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "prototype") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      page.locator('[data-qianzai-screen="cover"] > div > img'),
    ).toBeVisible();
    await check(page, "cover-original-composition", 390);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    for (const width of [320, 375, 390, 430, 1024])
      await check(page, "preference-original-composition", width);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .first()
      .click();
    const question = page.locator('[data-qianzai-screen="question"]');
    await expect(question).toHaveAttribute("data-qianzai-composite", "true");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    for (const width of [320, 375, 390, 430, 1024])
      await check(page, "act-one-original-composition", width);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    await question.locator("label").nth(1).click();
    await expect(question.locator('label[data-selected="true"]')).toHaveCount(
      1,
    );
    await page.clock.runFor(399);
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as {
              qianzaiProbe: {
                snapshot(): { draft: { progress: { questionId: string } } };
              };
            }
          ).qianzaiProbe.snapshot().draft.progress.questionId,
      ),
    ).toBe("q-0");
    await page.screenshot({
      path: path.join(out, "selection-feedback-399ms-390.png"),
      fullPage: true,
    });
    await page.clock.runFor(157);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                qianzaiProbe: {
                  snapshot(): { draft: { progress: { questionId: string } } };
                };
              }
            ).qianzaiProbe.snapshot().draft.progress.questionId,
        ),
      )
      .toBe("q-1");
    await page.clock.resume();
    for (const [index, name] of [
      [8, "act-two-original-composition"],
      [16, "act-three-original-composition"],
    ] as const) {
      await page.getByRole("button", { name: "旅程", exact: true }).click();
      await page
        .locator('[data-qianzai-screen="resume"] li')
        .nth(index)
        .getByRole("button")
        .click();
      await expect(host).toHaveAttribute("data-view-phase", "ready");
      await check(page, name, 390);
    }
    await question.getByRole("button", { name: "上一题", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                qianzaiProbe: {
                  snapshot(): { draft: { progress: { questionId: string } } };
                };
              }
            ).qianzaiProbe.snapshot().draft.progress.questionId,
        ),
      )
      .toBe("q-15");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await check(page, "reduced-motion-composition", 390);
    facts.prototypeComposition = {
      scope:
        "original bytes with synthetic resource projection and synthetic 24-question HTTP; not production admission or author acceptance",
      selectionVisibleMs: 399,
      actBoundaries: [8, 16],
      previousQuestion: 15,
    };
  } else if (
    ["report", "report-parity"].includes(process.env.QZTX_CAPTURE_TARGET ?? "")
  ) {
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    const scroll = report.locator(":scope > div"),
      bar = report.getByRole("progressbar", { name: "长卷阅读进度" }),
      contents = report.locator("header details");
    const percent = async () => Number(await bar.getAttribute("aria-valuenow"));
    const move = async (end: boolean) => {
      const expected = await scroll.evaluate((node, end) => {
        const max = node.scrollHeight - node.clientHeight;
        node.scrollTo({ top: end ? max : 0, behavior: "instant" });
        return max > 0 ? (end ? 100 : 0) : 100;
      }, end);
      // scrollTop changes synchronously; React's onScroll receipt is asynchronous.
      // Await the actual progress state before taking the frame.
      await expect.poll(percent).toBe(expected);
    };
    const jump = async (title: string) => {
      await contents.locator("summary").click();
      await contents.getByRole("link", { name: title, exact: true }).click();
      await expect(contents).not.toHaveAttribute("open", "");
      const heading = report.getByRole("heading", {
        name: title.split(" · ")[1]!,
        exact: true,
      });
      await expect(heading).toBeFocused();
      await expect
        .poll(async () =>
          heading.evaluate((node) => {
            const section = node.closest("article")!;
            const scroller =
              section.closest("main")!.parentElement!.parentElement!;
            return Math.abs(
              Math.round(
                section.getBoundingClientRect().top -
                  scroller.getBoundingClientRect().top -
                  parseFloat(getComputedStyle(section).scrollMarginTop),
              ),
            );
          }),
        )
        .toBe(0);
      await expect.poll(percent).toBeGreaterThan(0);
      await expect(report.locator("header > p > span").first()).toHaveText(
        title.split(" · ")[1]!,
      );
    };
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await move(false);
    await expect(
      report.getByRole("heading", { name: "合成人物", exact: true }),
    ).toBeVisible();
    await expect(
      report.getByText("人物画作待接入", { exact: true }),
    ).toBeVisible();
    await check(page, "report-parity-opening", 390);
    // Exercise the normal scrolling path before checking the reduced-motion path.
    await jump("卷二 · 合成卷2");
    await check(page, "report-parity-five-dimensions", 390);
    await checkRadar(page);
    await expect(
      report
        .locator(
          'article[data-volume="dimensions"] details[data-report-evidence][open] summary',
        )
        .first(),
    ).toBeFocused();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await scroll.evaluate((node) => getComputedStyle(node).scrollBehavior),
    ).toBe("auto");
    await jump("卷三 · 合成卷3");
    await check(page, "report-parity-chapter", 390);
    const longText = body.volumes[2]!.paragraphs[0]!.text;
    expect(
      await report
        .locator('article[data-volume="patterns"] section > p')
        .allTextContents(),
    ).toContain(longText);
    await move(true);
    await expect(
      report.getByRole("button", { name: "分享卡待开放", exact: true }),
    ).toBeDisabled();
    await check(page, "report-parity-closure", 390);
    await report.getByRole("button", { name: "回到卷首", exact: true }).click();
    await expect.poll(percent).toBe(0);
    await expect(
      report.getByRole("heading", { name: "合成人物", exact: true }),
    ).toBeFocused();
    await page.setViewportSize({ width: 320, height: 844 });
    await jump("卷三 · 合成卷3");
    await check(page, "report-parity-long-text", 320);
    await report
      .locator('article[data-volume="patterns"] summary')
      .first()
      .click();
    await expect(
      report.locator('article[data-volume="patterns"] details[open]').first(),
    ).toBeVisible();
    await check(page, "report-parity-evidence", 320);
    await move(true);
    await check(page, "report-parity-closure", 320);
    expect(await percent()).toBe(100);
    await report
      .getByRole("button", { name: "回看人物揭晓", exact: true })
      .click();
    await expect(page.locator('[data-qianzai-screen="result"]')).toBeVisible();
    facts.reportParity = {
      widths: [390, 320],
      realSealedFields: {
        role: body.matching.selected.label,
        index: body.matching.selected.narrativeIndex,
        dimensions: body.dimensions.map((d) => d.score),
      },
      contentsHeadingFocus: true,
      evidenceSummaryFocus: true,
      returnToStartFocus: true,
      progressAtEnd: 100,
      reducedMotion: true,
      shareExportUnavailable: true,
      progressFix:
        "probe now awaits React scroll state; product progress algorithm unchanged",
    };
  } else if (process.env.QZTX_CAPTURE_TARGET === "radar") {
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    await checkRadar(page);
  } else if (process.env.QZTX_MOTION_STUDY === "1") {
    await page.goto(origin + "/?motion-study");
    const water = page.locator("[data-qianzai-water]"),
      petals = page.locator("[data-qianzai-petals]");
    await expect
      .poll(async () => Number(await water.getAttribute("data-water-frames")))
      .toBeGreaterThan(2);
    await expect
      .poll(async () => Number(await petals.getAttribute("data-petal-frames")))
      .toBeGreaterThan(2);
    await expect
      .poll(() =>
        page
          .locator("img")
          .evaluate(
            (image) =>
              image.getAnimations().length > 0 &&
              image
                .getAnimations()
                .every((animation) => animation.playState === "finished"),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(out, "v8-private-motion-study-390.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "暂停动效", exact: true }).click();
    const frames = [
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ];
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    expect([
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ]).toEqual(frames);
    await page.getByRole("button", { name: "继续动效", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(water).toBeHidden();
    await expect(petals).toBeHidden();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("[data-motion]")).toHaveAttribute(
      "data-motion",
      "paused",
    );
    const hidden = [
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ];
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    expect([
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ]).toEqual(hidden);
    facts.v8MotionStudy = {
      source: "private unchanged V8 bitmap read via inventory",
      waterAndPetalsRan: true,
      manualPauseSuspendedFrames: true,
      reducedMotionHidden: true,
      simulatedVisibilitySuspendedFrames: true,
      resourceAdmission: false,
    };
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
    // Study is separate from prior synthetic UI/controller checks; do not repeat them.
  } else if (process.env.QZTX_CAPTURE_TARGET === "restore") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]"),
      question = page.locator('[data-qianzai-screen="question"]');
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(page.locator('[data-qianzai-screen="cover"]')).toBeVisible();
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.evaluate(() =>
      (
        window as unknown as {
          qianzaiProbe: {
            owner: { onEvent(e: { type: "navigate"; questionId: null }): void };
          };
        }
      ).qianzaiProbe.owner.onEvent({ type: "navigate", questionId: null }),
    );
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.reload();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(question).toBeVisible();
    await expect(
      question.getByText(
        "合成情境 1：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            qianzaiProbe: { calls: { path: string; method: string }[] };
          }
        ).qianzaiProbe.calls.some((c) => c.method === "POST"),
      ),
    ).toBe(false);
    await question.locator("label").first().click();
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.reload();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(question).toBeVisible();
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { qianzaiProbe: { calls: { method: string }[] } }
        ).qianzaiProbe.calls.some((c) => c.method === "POST"),
      ),
    ).toBe(false);
    facts.refreshResume = {
      freshCover: true,
      savedPreferenceZeroAnswersFirstQuestion: true,
      savedQuestionRestored: true,
      resumePosts: 0,
      server:
        "synthetic persisted response fixture; actual controller verification, no DB",
    };
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "reading") {
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.load(
        '600 16px "QuizForge Qianzai Serif"',
        "千载同心木兰",
      );
      await document.fonts.ready;
    });
    await report.getByRole("img").scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        Number(
          await report
            .getByRole("progressbar", { name: "长卷阅读进度" })
            .getAttribute("aria-valuenow"),
        ),
      )
      .toBeGreaterThan(0);
    await check(page, "five-axes-reading-position", 320);
    facts.readingPosition = await report
      .getByRole("progressbar", { name: "长卷阅读进度" })
      .getAttribute("aria-valuenow");
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "finish") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    expect(
      await page.evaluate(async () => {
        await document.fonts.load(
          '600 16px "QuizForge Qianzai Serif"',
          "千载同心木兰",
        );
        await document.fonts.ready;
        return document.fonts.check(
          '600 16px "QuizForge Qianzai Serif"',
          "千载同心木兰",
        );
      }),
    ).toBe(true);
    await expect(
      page.locator('[data-qianzai-screen="cover"] svg'),
    ).toHaveAttribute("aria-hidden", "true");
    await check(page, "cover-program-arrow-fixed-font", 390);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await check(page, "long-question-fixed-font", 320);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    const radar = report.getByRole("img");
    await radar.scrollIntoViewIfNeeded();
    await expect(radar).toHaveAccessibleName(/守心 23分/);
    await check(page, "five-axes-fixed-font", 320);
    await report
      .getByRole("button", { name: "返回人物揭晓", exact: true })
      .click();
    await expect(
      page.locator('[data-qianzai-screen="result"] svg'),
    ).toHaveAttribute("aria-hidden", "true");
    await check(page, "reveal-program-arrow-fixed-font", 390);
    facts.font = {
      family: "QuizForge Qianzai Serif",
      weight: 600,
      loaded: true,
      bitmapAdmission: false,
    };
    await page.close();
    const revoke = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await revoke.addInitScript(() => localStorage.clear());
    revoke.on("pageerror", (e) => errors.push(e.message));
    await revoke.goto(origin);
    await expect(revoke.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await revoke
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await revoke
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      revoke.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(revoke.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await revoke.clock.install();
    const before = await revoke.evaluate(
      () =>
        (
          window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
        ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
    );
    await revoke
      .locator('[data-qianzai-screen="question"] label')
      .first()
      .click();
    await revoke.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { owner: { revoke(): void } } }
      ).qianzaiProbe.owner.revoke(),
    );
    await expect(
      revoke.getByRole("heading", { name: "本次访问已结束", exact: true }),
    ).toBeVisible();
    await revoke.clock.runFor(500);
    expect(
      await revoke.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
      ),
    ).toBe(before);
    facts.revokedFeedback = {
      controlledClockMs: 500,
      delayedSaveNotSent: true,
      consumerContentRemoved: true,
    };
    await revoke.close();
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
  } else {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await check(page, "cover-neutral", 390);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    for (const width of [320, 375, 390, 430, 1024])
      await check(page, "preference-neutral", width);
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    const question = page.locator('[data-qianzai-screen="question"]');
    for (const width of [320, 375, 390, 430, 1024])
      await check(page, "question-long", width);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { holdNext(): void } }
      ).qianzaiProbe.holdNext(),
    );
    await question.locator("label").first().click();
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    await expect(question.locator("fieldset")).toHaveAttribute("disabled", "");
    await expect(question.getByRole("radio").first()).toBeDisabled();
    await expect(
      question.getByText(
        "合成情境 1：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { release(): void } }
      ).qianzaiProbe.release(),
    );
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { dropNext(): void } }
      ).qianzaiProbe.dropNext(),
    );
    await question.locator("label").first().click();
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    const before = await page.evaluate(() => {
      const p = (
        window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
      ).qianzaiProbe;
      return {
        posts: p.calls.filter((c) => c.path.endsWith("save")).length,
        storage: JSON.stringify(sessionStorage),
      };
    });
    await check(page, "unknown-preserved", 390);
    await page
      .getByRole("button", { name: "核对保存结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      question.getByText(
        "合成情境 3：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
      ),
    ).toBe(before.posts);
    facts.serialSave = {
      heldReceiptDidNotAdvance: true,
      lostAckRecoveredOriginal: true,
      noResend: true,
      storageWasPreserved: before.storage.length > 2,
    };
    // Cross-act routing uses actual act fields and controller save, not old Q4/Q8 demo indices.
    await page.getByRole("button", { name: "旅程", exact: true }).click();
    await page
      .locator('[data-qianzai-screen="resume"] li')
      .nth(8)
      .getByRole("button")
      .click();
    await expect(
      question.getByRole("heading", { name: "命运抉择", exact: true }),
    ).toBeVisible();
    await check(page, "act-two-neutral", 390);
    await page.getByRole("button", { name: "旅程", exact: true }).click();
    await page
      .locator('[data-qianzai-screen="resume"] li')
      .nth(16)
      .getByRole("button")
      .click();
    await expect(
      question.getByRole("heading", { name: "归于何处", exact: true }),
    ).toBeVisible();
    await check(page, "act-three-neutral", 390);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    for (const width of [320, 390, 1024])
      await check(page, "sealed-synthetic-report", width);
    await checkRadar(page);
    await report.locator("details").first().locator("summary").click();
    await report
      .getByRole("link", { name: "卷六 · 合成卷6", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          await report
            .getByRole("progressbar", { name: "长卷阅读进度" })
            .getAttribute("aria-valuenow"),
        ),
      )
      .toBeGreaterThan(50);
    await report
      .getByRole("button", { name: "返回人物揭晓", exact: true })
      .click();
    await expect(page.locator('[data-qianzai-screen="result"]')).toBeVisible();
    await check(page, "reveal-neutral", 390);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(host).toHaveAttribute("data-motion", "paused");
    facts.reducedMotion = true;
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  }
  expect(errors).toEqual([]);
  facts.pageErrors = errors;
  facts.passed = true;
} catch (error) {
  facts.passed = false;
  facts.failure = String(error);
  facts.pageErrors = errors;
  for (const context of browser.contexts()) {
    for (const [i, page] of context.pages().entries()) {
      await page
        .screenshot({ path: path.join(out, `failure-${i}.png`) })
        .catch(() => {});
      await writeFile(
        path.join(out, `failure-${i}.html`),
        await page.content(),
      ).catch(() => {});
    }
  }
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  const serialized = JSON.stringify(facts, null, 2);
  await writeFile(path.join(out, "result.json"), serialized);
  await writeFile(
    path.join(
      out,
      `result.${process.env.QZTX_CAPTURE_TARGET ?? "default"}.json`,
    ),
    serialized,
  );
}
console.log(JSON.stringify({ out, passed: true }));
