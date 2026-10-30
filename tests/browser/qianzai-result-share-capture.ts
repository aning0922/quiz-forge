import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import sharp from "sharp";
import type {
  QianzaiExportArtifact,
  QianzaiExportErrorCode,
  QianzaiExportKind,
  QianzaiExportState,
  QianzaiShareOutcome,
} from "@/features/report/qianzai-tongxin/contracts";
import { chromium, expect } from "@playwright/test";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";

type UiExportFixture = {
  holdNext(): void;
  release(): void;
  failNext(code: QianzaiExportErrorCode): void;
  shareOutcome(outcome: QianzaiShareOutcome): void;
  block(kind: QianzaiExportKind, reason: QianzaiExportErrorCode): void;
  revoke(): void;
  hash(kind: QianzaiExportKind): Promise<string>;
  snapshot(): {
    state: QianzaiExportState;
    renders: Record<QianzaiExportKind, number>;
    actions: { download: number; share: number };
    cache: QianzaiExportArtifact[];
  };
};
const target = process.env.QZTX_RESULT_TARGET ?? "baseline",
  out = path.resolve(
    `.cache/qztx-result-share/${target}-${new Date().toISOString().replaceAll(":", "-")}`,
  );
await mkdir(out, { recursive: true });
const model = structuredReaderFixtureV2().completed;
model.report!.view.display.presentationMode = "authored-product";
const body = model.report!.view.display.body;
body.matching.selected.label = "李白";
body.matching.selected.narrativeIndex = 37;
body.dimensions = [23, 74, 51, 80, 37].map((score, i) => ({
  ...body.dimensions[0]!,
  dimensionRef: { ...body.dimensions[0]!.dimensionRef, id: `axis-${i}` },
  label: ["守心", "寻远", "知情", "决断", "应变"][i]!,
  score,
}));
// Read-only comparison fixture from actual original DOM, never production content.
const sourceBrowser = await chromium.launch();
try {
  const page = await sourceBrowser.newPage({ reducedMotion: "reduce" });
  await page.goto(
    "file:///Users/aipuli/Downloads/千载同心_李白长报告_滚动交互_V1_待验收.html",
  );
  await page.evaluate("window.__name=(fn)=>fn");
  const sample = await page.evaluate(() => {
    const text = (selector: string, root: ParentNode = document) => {
      const el = root.querySelector(selector)?.cloneNode(true) as
        Element | undefined;
      el?.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
      return el?.textContent?.trim() ?? "";
    };
    const opening = document.getElementById("reportStart")!;
    return {
      title: text(".rp-identity-sub", opening),
      titles: [
        "命定相逢",
        ...Array.from(document.querySelectorAll(".rp-section-head h2"), (n) =>
          n.textContent!.trim(),
        ),
        "寄语留存",
      ],
      groups: [
        [text(".rp-verse p", opening), text(".rp-lead", opening)],
        [text("#reportRadar .rp-section-head p")],
        Array.from(document.querySelectorAll(".rp-res-body"), (n) =>
          [text("h3", n), text("p", n), text("span", n)].join("\n"),
        ),
        [
          text(".rp-reflection-feature blockquote"),
          text(".rp-reflection-feature p"),
          ...Array.from(document.querySelectorAll(".rp-dual-note>div"), (n) =>
            n.textContent!.trim(),
          ),
        ],
        [
          text(".rp-history-banner"),
          ...Array.from(document.querySelectorAll(".rp-time-row"), (n) =>
            n.textContent!.trim(),
          ),
          text(".rp-source-note"),
        ],
        [text(".rp-final-verse"), text("#reportClosing>p")],
      ],
    };
  });
  expect(sample.groups.map((g) => g.length)).toEqual([2, 1, 3, 4, 5, 2]);
  expect(sample.groups.flat().every((t) => t.length > 0)).toBe(true);
  body.title = sample.title;
  const p = body.volumes[0]!.paragraphs[0]!;
  body.volumes.forEach((v, i) => {
    v.title = sample.titles[i]!;
    v.paragraphs = sample.groups[i]!.map((text, j) => ({
      ...p,
      text,
      kind:
        (i === 0 && j === 0) || (i === 3 && j === 0) || (i === 5 && j === 0)
          ? "literary"
          : i === 4
            ? "fact"
            : "context",
      status: "accepted",
      evidence: [],
      counterevidence: [],
    }));
  });
} finally {
  await sourceBrowser.close();
}
const reveal = structuredClone(model);
reveal.report!.view.display.body.matching.selected.label = "李清照";
reveal.report!.view.display.body.volumes[0]!.paragraphs = [
  {
    ...body.volumes[0]!.paragraphs[0]!,
    text: "参考画面仅核对人物、姓名与阅读入口的层次。",
  },
];
const files = new Map<string, { body: Buffer; type: string }>(),
  bindings: {
    asset: NonNullable<
      typeof model.report
    >["view"]["display"]["assets"][number];
    slot: "character.report" | "character.reveal" | "reportPaper";
    url: string;
    layer: "clean";
  }[] = [];
async function add(
  slot: "character.report" | "character.reveal" | "reportPaper",
  file: string,
) {
  const bytes = await readFile(file),
    metadata = await sharp(bytes).metadata();
  const asset = {
    ...model.report!.view.display.assets[0]!,
    resourceRef: {
      ...model.report!.view.display.assets[0]!.resourceRef,
      id: `ui-reference-${slot.replaceAll(".", "-")}`,
    },
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.length,
    width: metadata.width!,
    height: metadata.height!,
    mediaType: (metadata.format === "jpeg" ? "image/jpeg" : "image/png") as
      "image/jpeg" | "image/png",
    approval: "approved" as const,
  };
  for (const m of [model, reveal]) {
    m.report!.view.display.assets.push(asset);
    if (slot === "reportPaper")
      m.report!.view.display.slots.neutral.reportPaper = asset.resourceRef;
    else
      m.report!.view.display.slots.character[
        slot === "character.report" ? "report" : "reveal"
      ] = asset.resourceRef;
  }
  const url = `/private-reference/${bindings.length}`;
  files.set(url, { body: bytes, type: asset.mediaType });
  bindings.push({ asset, slot, url, layer: "clean" });
}
await add(
  "character.report",
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-motion-integration/quiz-forge/.cache/qztx-resource-audit-20261030/report-hero.jpg",
);
await add(
  "reportPaper",
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-motion-integration/quiz-forge/.cache/qztx-resource-audit-20261030/paper.png",
);
await add(
  "character.reveal",
  "/var/folders/hs/czlwyhb553l9_ghpn6byp6v00000gn/T/codex-clipboard-b6041a87-fea8-4dcc-87df-ef88881bc03b.png",
);
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  entryPoints: [
    path.resolve(
      "src/features/theme/qianzai-tongxin/result-share.browser.test-support.tsx",
    ),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  alias: {
    react: path.resolve("node_modules/react"),
    "react-dom": path.resolve("node_modules/react-dom"),
  },
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  loader: { ".css": "local-css" },
  plugins: [
    ...(target.startsWith("share-")
      ? [
          {
            name: "ui-export-contract-double",
            setup(build: {
              onResolve: (
                options: { filter: RegExp },
                callback: () => unknown,
              ) => void;
            }) {
              build.onResolve({ filter: /^\.\/export-context$/ }, () => ({
                path: path.resolve(
                  "src/features/theme/qianzai-tongxin/result-share-export.browser.test-support.tsx",
                ),
              }));
            },
          },
        ]
      : []),
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
              'export const types = new Proxy({}, {get(){throw Error("UNEXPECTED_NODE_POLICY_IN_UI_PROBE")}});',
            loader: "js",
          }),
        );
      },
    },
  ],
});
for (const [url, file, type] of [
  ["/probe.js", path.join(out, "probe.js"), "text/javascript"],
  ["/probe.css", path.join(out, "probe.css"), "text/css"],
  [
    "/font.woff2",
    "public/assets/fonts/qianzai-v4/serif-600.woff2",
    "font/woff2",
  ],
])
  files.set(url!, { body: await readFile(file!), type: type! });
const server = createServer((req, res) => {
  const item = files.get(req.url ?? "");
  if (item) {
    res.writeHead(200, { "content-type": item.type });
    res.end(item.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:"QuizForge Qianzai Serif V4";src:url(/font.woff2) format("woff2");font-weight:600;font-display:swap}body{margin:0}</style><link rel="stylesheet" href="/probe.css"><div id="root"></div><script id="fixture" type="application/json">' +
      JSON.stringify({
        report: model,
        reveal,
        bindings,
        disclosure: target === "private-preview",
      }).replaceAll("<", "\\u003c") +
      '</script><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_LOOPBACK_PORT_REQUIRED");
const browser = await chromium.launch(),
  facts: Record<string, unknown> = {
    scope:
      "actual React result UI and verified image loader; synthetic readonly model/prototype prose + unapproved pure character reference, no DB/runtime/catalog admission or real score claim",
    target,
    out,
    screenshots: [],
  },
  errors: string[] = [];
try {
  if (target.startsWith("share-")) {
    facts.scope =
      "actual SharePanel consuming a typed UI contract double; owned synthetic PNG fixture with 37/100 marker, not production rendering, native sharing, runtime admission, or author art acceptance";
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
        acceptDownloads: true,
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page.locator('[data-qianzai-screen="report"] img'),
      ).toHaveCount(1);
      const report = page.locator('[data-qianzai-screen="report"]'),
        scroll = report.locator('[class*="reportScroll"]');
      await scroll.evaluate((n) => (n.scrollTop = n.scrollHeight));
      const entry = report.getByRole("button", {
        name: "保存我的结果",
        exact: true,
      });
      await entry.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveAttribute("data-view", "choose");
      await expect(
        dialog.getByRole("button", { name: "关闭保存选项" }),
      ).toBeFocused();
      await expect(dialog.locator("img")).toHaveCount(0);
      await page.screenshot({
        path: path.join(out, `choice-${width}x${height}.png`),
      });
      if (target === "share-visual") {
        await dialog
          .getByRole("button", { name: "查看图片预览", exact: true })
          .click();
        await expect(
          dialog.getByRole("img", { name: "相逢海报原样预览" }),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(out, `poster-preview-${width}x${height}.png`),
        });
        await dialog
          .getByRole("button", { name: "切换为完整报告长图" })
          .click();
        await expect(
          dialog.getByRole("img", { name: "完整报告长图原样预览" }),
        ).toBeVisible();
        await page.screenshot({
          path: path.join(out, `long-preview-${width}x${height}.png`),
        });
        (facts.screenshots as unknown[]).push({
          width,
          height,
          states: ["choice", "poster preview", "long preview"],
          reusedInteractionEvidence: "share-ui-2026-10-30T08-08-30.942Z",
        });
        await page.close();
        continue;
      }
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.holdNext(),
      );
      await dialog
        .getByRole("button", { name: "查看图片预览", exact: true })
        .click();
      await expect(
        dialog.getByText("正在展开本轮画卷", { exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "保存 PNG", exact: true }),
      ).toBeDisabled();
      // Returning to choice during a single active render cannot lose the job
      // by silently switching to a kind which the owner has not accepted.
      await dialog.getByRole("button", { name: "返回选择保存类型" }).click();
      await expect(
        dialog.getByRole("button", { name: /完整报告长图/ }),
      ).toBeDisabled();
      await dialog
        .getByRole("button", { name: "查看生成进度", exact: true })
        .click();
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.release(),
      );
      const preview = dialog.getByRole("img", { name: "相逢海报原样预览" });
      await expect(preview).toBeVisible();
      const previewColors = await dialog.locator("h2").evaluate((n) => ({
        color: getComputedStyle(n).color,
        background: getComputedStyle(n.closest("header")!).backgroundColor,
        font: getComputedStyle(n).fontFamily,
      }));
      const luminance = (css: string) => {
        const values = css
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((v) => v / 255)
          .map((v) =>
            v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
          );
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
      };
      const lights = [
        luminance(previewColors.color),
        luminance(previewColors.background),
      ].sort((a, b) => a - b);
      expect((lights[1]! + 0.05) / (lights[0]! + 0.05)).toBeGreaterThan(4.5);
      expect(previewColors.font).toContain("system-ui");
      const targets = await dialog
        .locator("button:visible")
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            width: n.getBoundingClientRect().width,
            height: n.getBoundingClientRect().height,
          })),
        );
      expect(targets.every((r) => r.width >= 44 && r.height >= 44)).toBe(true);
      const posterUrl = await preview.getAttribute("src");
      await page.screenshot({
        path: path.join(out, `poster-preview-${width}x${height}.png`),
      });
      await dialog.getByRole("button", { name: "放大图片" }).click();
      await dialog.getByRole("button", { name: "放大图片" }).click();
      await dialog.getByRole("button", { name: "放大图片" }).click();
      await expect(dialog.getByLabel("图片缩放比例")).toHaveText("205%");
      const imagePort = dialog.getByLabel("图片预览，可横向和纵向滚动");
      expect(
        await imagePort.evaluate(
          (n) =>
            n.scrollWidth > n.clientWidth && n.scrollHeight > n.clientHeight,
        ),
      ).toBe(true);
      await imagePort.evaluate((n) => {
        n.scrollLeft = 80;
        n.scrollTop = 80;
      });
      await dialog.getByRole("button", { name: "适配", exact: true }).click();
      expect(await imagePort.evaluate((n) => n.scrollLeft)).toBe(0);
      await expect(preview).toHaveAttribute("src", posterUrl!);
      await preview.dblclick();
      await expect(dialog.getByLabel("图片缩放比例")).toHaveText("170%");
      await dialog.getByRole("button", { name: "适配", exact: true }).click();
      await dialog
        .getByRole("button", { name: "分享图片", exact: true })
        .click();
      await expect(dialog.locator('p[role="status"]')).toHaveText(
        "当前浏览器无法直接分享 PNG，请先保存图片后发送。",
      );
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.shareOutcome("cancelled"),
      );
      await dialog
        .getByRole("button", { name: "分享图片", exact: true })
        .click();
      await expect(dialog.locator('p[role="status"]')).toHaveCount(0);
      await dialog.getByRole("button", { name: "切换为完整报告长图" }).click();
      const long = dialog.getByRole("img", { name: "完整报告长图原样预览" });
      await expect(long).toBeVisible();
      const longUrl = await long.getAttribute("src");
      await imagePort.evaluate((n) => (n.scrollTop = n.scrollHeight));
      await page.screenshot({
        path: path.join(out, `long-preview-bottom-${width}x${height}.png`),
      });
      const downloadPromise = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "保存 PNG", exact: true })
        .click();
      const download = await downloadPromise;
      const downloaded = await readFile((await download.path())!);
      const actualHash = createHash("sha256").update(downloaded).digest("hex");
      expect(actualHash).toBe(
        await page.evaluate(() =>
          (
            window as unknown as { qztxExportFixture: UiExportFixture }
          ).qztxExportFixture.hash("full-report"),
        ),
      );
      expect(download.suggestedFilename()).toBe("ui-synthetic-full-report.png");
      await expect(long).toHaveAttribute("src", longUrl!);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveAttribute("data-view", "choose");
      await expect(
        dialog.getByRole("button", { name: "关闭保存选项" }),
      ).toBeFocused();
      await dialog.getByRole("button", { name: /相逢海报/ }).click();
      await dialog
        .getByRole("button", { name: "查看图片预览", exact: true })
        .click();
      await expect(
        dialog.getByRole("img", { name: "相逢海报原样预览" }),
      ).toHaveAttribute("src", posterUrl!);
      const snapshot = await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.snapshot(),
      );
      expect(snapshot.renders).toEqual({ poster: 1, "full-report": 1 });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(entry).toBeFocused();
      // Explicit generation error is actionable; no old ready image leaks in.
      await entry.click();
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.failNext("PNG_UNAVAILABLE"),
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "查看图片预览", exact: true })
        .click();
      await expect(
        page
          .getByRole("dialog")
          .getByText("这次未能生成 PNG，可以重新生成。", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("dialog")
          .getByRole("button", { name: "保存 PNG", exact: true }),
      ).toBeDisabled();
      await page.screenshot({
        path: path.join(out, `generation-error-${width}x${height}.png`),
      });
      await page.getByRole("button", { name: "关闭图片预览" }).click();
      // Closing an unsatisfied render invalidates its future publication.
      await entry.click();
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.holdNext(),
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "查看图片预览", exact: true })
        .click();
      await page.getByRole("button", { name: "关闭图片预览" }).click();
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.release(),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(
        (
          await page.evaluate(() =>
            (
              window as unknown as { qztxExportFixture: UiExportFixture }
            ).qztxExportFixture.snapshot(),
          )
        ).state.phase,
      ).toBe("closed");
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.block("poster", "ARTWORK_UNAVAILABLE"),
      );
      await entry.click();
      await expect(
        page.getByRole("dialog").getByRole("button", { name: /相逢海报/ }),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("dialog")
          .getByText("人物画作或姓名图尚未就绪。", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: path.join(out, `artwork-unavailable-${width}x${height}.png`),
      });
      await page.evaluate(() =>
        (
          window as unknown as { qztxExportFixture: UiExportFixture }
        ).qztxExportFixture.revoke(),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(entry).toBeDisabled();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      (facts.screenshots as unknown[]).push({
        width,
        height,
        states: [
          "choice",
          "rendering",
          "poster",
          "long/scrolled",
          "zoom",
          "download same bytes",
          "share fallback/cancel",
          "error",
          "close cancellation",
          "missing art",
          "authority closed",
        ],
        artifactHash: actualHash,
        snapshot,
      });
      await page.close();
    }
  } else {
    for (const [width, height] of [
      [390, 844],
      [320, 568],
    ] as const) {
      const page = await browser.newPage({
        viewport: { width, height },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${address.port}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page.locator('[data-qianzai-screen="report"] img'),
      ).toHaveCount(1);
      const report = page.locator('[data-qianzai-screen="report"]'),
        scroll = report.locator('[class*="reportScroll"]');
      for (const volume of [
        "opening",
        "dimensions",
        "patterns",
        "counterevidence",
        "literature",
        "closure",
      ]) {
        if (volume !== "opening")
          await report
            .locator(`[data-report-chapter-id="${volume}"]`)
            .evaluate((n) => n.scrollIntoView({ block: "start" }));
        else await scroll.evaluate((n) => (n.scrollTop = 0));
        await page.screenshot({
          path: path.join(out, `report-${volume}-${width}x${height}.png`),
        });
        (facts.screenshots as unknown[]).push({
          screen: "report",
          anchor: volume,
          width,
          height,
          scrollTop: await scroll.evaluate((n) => n.scrollTop),
        });
      }
      await page.goto(`http://127.0.0.1:${address.port}/?reveal-reference`);
      await page.evaluate(() => document.fonts.ready);
      await expect(
        page.locator('[data-qianzai-screen="result"] img'),
      ).toHaveCount(1);
      await expect(page.locator("[data-reveal-phase]")).toHaveAttribute(
        "data-reveal-phase",
        "ready",
      );
      await page.screenshot({
        path: path.join(out, `reveal-reference-${width}x${height}.png`),
      });
      await page.close();
    }
  }
  expect(errors).toEqual([]);
  facts.passed = true;
} catch (error) {
  facts.passed = false;
  facts.failure = String(error);
  for (const context of browser.contexts())
    for (const [i, page] of context.pages().entries()) {
      await page
        .screenshot({ path: path.join(out, `failure-${i}.png`) })
        .catch(() => {});
      await writeFile(
        path.join(out, `failure-${i}.html`),
        await page.content(),
      ).catch(() => {});
    }
  throw error;
} finally {
  facts.errors = errors;
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(facts, null, 2),
  );
}
console.log(JSON.stringify({ out, passed: true }));
