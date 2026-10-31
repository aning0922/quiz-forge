import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import {
  QIANZAI_REFERENCE_REPORT_HTML_SHA256,
  QIANZAI_REFERENCE_SHARE_HTML_SHA256,
} from "@/features/report/qianzai-tongxin/reference-document.test-support";
const out = path.resolve(`.cache/prototype-scenes/comparison-${Date.now()}`);
await mkdir(out, { recursive: true });
const sourcePaths = {
  cover:
    process.env.QZTX_COVER_HTML ??
    "/Users/aipuli/Downloads/QuizForge 千载同心封面归档包 V8/03_可交互原型/千载同心_封面V8_离线HTML原型.html",
  five:
    process.env.QZTX_FIVE_HTML ??
    "/Users/aipuli/Downloads/千载同心_五屏串联_视觉确认版_V1_20261025.html",
  transition:
    process.env.QZTX_TRANSITION_HTML ??
    "/Users/aipuli/Downloads/千载同心_五屏基础转场_V1_待验收.html",
  reveal:
    process.env.QZTX_REVEAL_HTML ??
    "/Users/aipuli/Downloads/千载同心_李白揭晓全流程_V1_待验收.html",
  report:
    process.env.QZTX_REPORT_HTML ??
    "/Users/aipuli/Downloads/千载同心_李白长报告_滚动交互_V1_待验收.html",
  share:
    process.env.QZTX_SHARE_HTML ??
    "/Users/aipuli/Downloads/QuizForge_千载同心_结果保存分享视觉归档_V2_20261025/02_已确认HTML/千载同心_保存分享_视觉确认V2.html",
};
const digest = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
const files = new Map<string, { body: Buffer | string; type: string }>(),
  sourceHashes: Record<string, string> = {};
const sourceTexts: Record<string, string> = {};
for (const [key, file] of Object.entries(sourcePaths)) {
  const raw = await readFile(file);
  sourceHashes[key] = digest(raw);
  const text = raw.toString();
  sourceTexts[key] = text;
  files.set(`/original/${key}`, { body: raw, type: "text/html;charset=utf-8" });
  for (const found of text.matchAll(
    /data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)/g,
  )) {
    const body = Buffer.from(found[2]!, "base64"),
      sha = digest(body);
    files.set(`/raw/${sha}`, { body, type: found[1]! });
  }
}
if (
  sourceHashes.report !== QIANZAI_REFERENCE_REPORT_HTML_SHA256 ||
  sourceHashes.share !== QIANZAI_REFERENCE_SHARE_HTML_SHA256
)
  throw Error("REFERENCE_DOCUMENT_SOURCE_CHANGED");
const rawUrl = (data: string) => {
  const match = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw Error("INVALID_REFERENCE_IMAGE");
  const bytes = Buffer.from(match[2]!, "base64"),
    sha256 = digest(bytes),
    url = `/raw/${sha256}`;
  if (!files.has(url)) throw Error("UNSCOPED_REFERENCE_IMAGE");
  return { url, sha256, bytes: bytes.length };
};
const reportStyles = Array.from(
    sourceTexts.report!.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),
    (m) => m[1],
  ).join("\n"),
  reportImages = Array.from(
    new Set(reportStyles.match(/data:[^;\s"']+;base64,[A-Za-z0-9+/=]+/g) ?? []),
  );
if (reportImages.length !== 2) throw Error("REPORT_REFERENCE_IMAGES_CHANGED");
const report = {
  hero: rawUrl(reportImages[0]!).url,
  paper: rawUrl(reportImages[1]!).url,
};
const shareImage = (kind: "poster" | "long") => {
  const match = sourceTexts.share!.match(
    new RegExp(`const ${kind}Source='([^']+)'`),
  );
  if (!match) throw Error("SHARE_REFERENCE_IMAGE_MISSING:" + kind);
  const image = rawUrl(match[1]!),
    raw = files.get(image.url)!.body;
  if (
    !Buffer.isBuffer(raw) ||
    raw.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
  )
    throw Error("SHARE_REFERENCE_NOT_PNG");
  return {
    ...image,
    width: raw.readUInt32BE(16),
    height: raw.readUInt32BE(20),
  };
};
const share = { poster: shareImage("poster"), long: shareImage("long") };
const scope = <T>(x: T): T =>
  JSON.parse(
    JSON.stringify(x, (key, v) =>
      key === "productId" ? "qianzai-tongxin" : v,
    ),
  );
const model = scope(structuredReaderFixtureV2().model),
  completed = scope((await qianzaiExportFixture()).model),
  entry = model.entry!;
// Static authored question definitions only; never reads a session or answers.
const questionPath =
  process.env.QZTX_SCENES_CONTENT ??
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-full-flow-demo/quiz-forge/.cache/qztx-full-flow/candidate-02/content.json";
const questionBytes = await readFile(questionPath);
const questions = JSON.parse(questionBytes.toString()).core
  .questions as typeof entry.questions;
if (
  questions.length !== 24 ||
  questions.some((q, i) => q.act !== Math.floor(i / 8) + 1)
)
  throw Error("REFERENCE_24_QUESTION_DEFINITION_REQUIRED");
entry.questions = questions;
sourceHashes.questions = digest(questionBytes);
entry.presentationMode = "authored-product";
entry.preferences = ["male", "female", "any"];
const bindings = QIANZAI_RUNTIME_INPUTS.resources.filter(
  (b) =>
    b.slot === "cover" ||
    b.slot === "preferenceScene" ||
    b.slot.startsWith("acts."),
);
const asset = (slot: string) => bindings.find((b) => b.slot === slot)!.asset;
entry.assets = bindings.map((b) => ({
  ...b.asset,
  alt: "原型对照专用资源，非业务准入",
}));
entry.slots.cover = asset("cover").resourceRef;
entry.slots.preferenceScene = asset("preferenceScene").resourceRef;
entry.slots.acts = [0, 1, 2].map((i) => ({
  ...entry.slots.acts[0]!,
  sectionId: ["act-one", "act-two", "act-three"][i]!,
  background: asset(`acts.${i}.background`).resourceRef,
  questionPaper: asset(`acts.${i}.questionPaper`).resourceRef,
  optionIdle: asset(`acts.${i}.optionIdle`).resourceRef,
  optionSelected: asset(`acts.${i}.optionSelected`).resourceRef,
}));
model.draft!.matchingContext = null;
model.state!.matchingContext = null;
// A truthy lastSave is a pure reference projection for the source's baked "已保存".
// It is never accepted by a controller, submitted, scored or persisted.
model.state!.lastSave = {} as NonNullable<typeof model.state>["lastSave"];
completed.report!.view.display.body.matching.selected.label = "李白";
const assets = bindings.map((b) => ({
  asset: { ...b.asset, alt: "原型对照专用资源" },
  url: `/raw/${b.asset.sha256}`,
  layer: b.layer,
}));
for (const a of assets)
  if (!files.has(a.url))
    throw Error("SOURCE_ASSET_MISSING:" + a.asset.resourceRef.id);
const before = {
    url: "/raw/778e1ae1817fc53840d4478cbcd0e6074daba6e3febe7456801066a4a396db38",
    sha256: "778e1ae1817fc53840d4478cbcd0e6074daba6e3febe7456801066a4a396db38",
  },
  full = {
    url: "/raw/08ed543b80e55e4a5c3d02819270cf87c216bdc370e78465aba6c9b48ad9c425",
    sha256: "08ed543b80e55e4a5c3d02819270cf87c216bdc370e78465aba6c9b48ad9c425",
  };
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  entryPoints: [
    path.resolve(
      "src/features/theme/qianzai-tongxin/prototype-scenes.browser.test-support.tsx",
    ),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  jsx: "automatic",
  format: "iife",
  tsconfig: "tsconfig.json",
  alias: {
    react: path.resolve("node_modules/react"),
    "react-dom": path.resolve("node_modules/react-dom"),
  },
  // This alias exists only in this reference bundle. The application keeps its
  // real export provider and authority checks.
  plugins: [
    {
      name: "reference-only-export-port",
      setup(build: {
        onResolve(
          options: { filter: RegExp },
          callback: () => { path: string },
        ): void;
      }) {
        build.onResolve({ filter: /^\.\/export-context$/ }, () => ({
          path: path.resolve(
            "src/features/theme/qianzai-tongxin/prototype-export.test-support.ts",
          ),
        }));
      },
    },
  ],
});
for (const ext of ["js", "css"])
  files.set(`/probe.${ext}`, {
    body: await readFile(path.join(out, `probe.${ext}`)),
    type: ext === "js" ? "text/javascript" : "text/css",
  });
const server = createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://local"),
    file = files.get(url.pathname);
  res.setHeader("cache-control", "no-store");
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  if (url.pathname !== "/") {
    res.writeHead(404);
    res.end();
    return;
  }
  const m = structuredClone(model),
    index = Math.max(
      0,
      Math.min(
        entry.questions.length - 1,
        Number(
          url.searchParams.get("index") ??
            (url.searchParams.get("probe") === "q08" ? 7 : 0),
        ),
      ),
    );
  if (url.searchParams.get("screen") === "question") {
    m.draft!.matchingContext = {
      schemaVersion: "quiz-matching-context.v1",
      preference: "any",
      policyRef: entry.matchingPolicyRef,
    };
    m.state!.matchingContext = m.draft!.matchingContext;
  }
  const probe =
    url.searchParams.get("probe") === "q08" ? "q08-selected-wrap" : null;
  if (probe === "q08-selected-wrap")
    m.entry!.questions[7]!.options[0]!.label =
      "保留剩余环节的原有顺序，空出的时间自由交流";
  m.state!.progress.questionId = entry.questions[index]!.ref.id;
  m.draft!.progress.questionId = m.state!.progress.questionId;
  const setup = JSON.stringify({
    mode: "reference-only",
    probe,
    model: m,
    completed,
    assets,
    before,
    full,
    report,
    share,
  }).replaceAll("<", "\\u003c");
  res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
  res.end(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千载同心原型对照专用</title><link rel="stylesheet" href="/probe.css"><style>body{margin:0;background:#101926}</style><div id="root"></div><script id="fixture" type="application/json">${setup}</script><script src="/probe.js"></script></html>`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const addr = server.address();
if (!addr || typeof addr === "string") throw Error("NO_LOOPBACK_ADDRESS");
const info = {
  origin: `http://127.0.0.1:${addr.port}`,
  out,
  pid: process.pid,
  sourceHashes,
  referenceImages: { report, share },
  entry: "/?screen=cover",
  scope:
    "reference-only; no business transport, scoring, snapshots or database",
};
await writeFile(path.join(out, "server.json"), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info));
