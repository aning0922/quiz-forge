/** Local interaction demonstration: real components/controller/pure scorer, synthetic
 * session transport. Never creates a database, authorization grant or sealed record. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { consumerSessionFixtureV2 } from "@/features/theme/consumer-v2/session.test-support";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { readRestrictedZip } from "@/features/quizpack/v1/zip";
import { quizPackContentV3Schema } from "@/features/quizpack/content/v3";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import { consumerMappingSha256V2 } from "@/lib/consumer-contract/v2/identities";
import localArtFixture from "@/features/quizpack/content/qianzai-local-art-fixture.json";
import localNameFixture from "@/features/quizpack/content/qianzai-local-name-fixture.json";
import centeredNameFixture from "@/features/quizpack/content/qianzai-local-centered-name-fixture.json";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import { QIANZAI_EDITORIAL_FONTS } from "@/features/theme/qianzai-tongxin/editorial-fonts";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";
import { QIANZAI_COMPONENT_MAPPING } from "@/features/theme/qianzai-tongxin/component-map";

const source = process.env.QZTX_V11_SOURCE;
if (!source || !path.isAbsolute(source))
  throw Error("EXPLICIT_PRIVATE_SOURCE_REQUIRED");
const out = path.resolve(".cache/qztx-v11-demo", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const content = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(path.join(source, "content.json"), "utf8")),
);
const sourceHash = sha(canonicalP1Json(content));
const centeredMode = process.env.QZTX_CENTERED_NAME_FIXTURE === "1";
const nameMode = centeredMode || process.env.QZTX_NAME_FIXTURE === "1";
const artMode = nameMode || process.env.QZTX_ART_FIXTURE === "1";
const expectedSource = centeredMode
  ? centeredNameFixture.canonicalContentSha256
  : nameMode
    ? localNameFixture.canonicalContentSha256
    : artMode
      ? localArtFixture.canonicalContentSha256
      : localArtFixture.baseContentSha256;
if (sourceHash !== expectedSource)
  throw Error("FIXED_CANDIDATE_SOURCE_CHANGED");
const prepared = prepareContentV3(content);
if (!prepared.ok) throw Error("CANDIDATE_PREPARATION_FAILED");
const handle = prepared.value;
const projected = projectContentEntryV3(content, sourceHash);
if (!projected.ok) throw Error("ENTRY_PROJECTION_FAILED");
const entry = structuredClone(projected.value);
entry.presentationMode = "authored-product";
entry.exports = { posterPng: false, fullReportPng: false };
const scope = <T>(value: T): T =>
  JSON.parse(
    JSON.stringify(value, (key, v) =>
      key === "productId" ? "qianzai-tongxin" : v,
    ),
  );
const session = scope(await consumerSessionFixtureV2());
const completed = scope((await qianzaiExportFixture()).model);
const renderer = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai;
const font = QIANZAI_RUNTIME_INPUTS.font;
if (!renderer || renderer.version !== "1.2.0" || !font)
  throw Error("V11_REGISTERED_RUNTIME_REQUIRED");
const fontIdentity = {
  id: font.id,
  version: font.version,
  weight: font.weight,
  fileSha256: font.fileSha256,
  coverageSha256: font.coverageSha256,
  licenseSha256: font.licenseSha256,
};
session.entry.facts.entry = entry;
session.entry.facts.renderer = renderer;
session.entry.facts.mapping = structuredClone(QIANZAI_COMPONENT_MAPPING);
session.entry.facts.mappingSha256 = await consumerMappingSha256V2(
  session.entry.facts.mapping,
);
session.entry.facts.font = fontIdentity;
session.entry.factsSha256 = await consumerEntryFactsSha256V2(
  session.entry.facts,
);
const compose = (input: unknown) => {
  const result = projectPreparedResultV3(handle, input);
  if (!result.ok) return null;
  const display = structuredClone(result.value.display);
  display.presentationMode = "authored-product";
  display.exports = { posterPng: true, fullReportPng: true };
  return display;
};
const witness = content.bindings.witnesses.entries.find(
  (v) => v.expectedResultRef.id === "li-bai",
);
if (!witness) throw Error("REFERENCE_PATH_MISSING");
const initialDisplay = compose({
  schemaVersion: "quiz-scoring-input.v2",
  answers: witness.answers,
  matchingContext: {
    schemaVersion: "quiz-matching-context.v1",
    policyRef: content.core.scoringDefinition.matchingPolicy.ref,
    preference: "male",
  },
});
if (!initialDisplay || !completed.report) throw Error("INITIAL_DISPLAY_FAILED");
Object.assign(completed.report.view, {
  session: session.session,
  parent: session.entry.facts.parent,
  renderer,
  font: fontIdentity,
  mapping: session.entry.facts.mapping,
  mappingSha256: session.entry.facts.mappingSha256,
  display: initialDisplay,
});
// Fixed authored test witnesses, never the author's current session or answers.
const reviewModels = new Map<string, typeof completed>();
for (const witness of content.bindings.witnesses.entries) {
  const display = compose({
    schemaVersion: "quiz-scoring-input.v2",
    answers: witness.answers,
    matchingContext: {
      schemaVersion: "quiz-matching-context.v1",
      policyRef: content.core.scoringDefinition.matchingPolicy.ref,
      preference: witness.preference,
    },
  });
  if (!display || display.selectedResultRef.id !== witness.expectedResultRef.id)
    throw Error("REVIEW_WITNESS_MISMATCH");
  const model = structuredClone(completed);
  model.report!.view.display = display;
  reviewModels.set(witness.expectedResultRef.id, model);
}
const pack = artMode ? null : await readFile(path.join(source, "pack.zip"));
const zip =
  pack &&
  (await readRestrictedZip(
    (async function* () {
      yield pack;
    })(),
    { targetProductId: "qianzai-tongxin" },
  ));
if (zip && !zip.ok) throw Error("PRIVATE_ARCHIVE_REJECTED");
const files = new Map<string, { body: Uint8Array | string; type: string }>();
type DemoBinding = (typeof QIANZAI_RUNTIME_INPUTS.resources)[number];
const visuals: Array<{
  asset: DemoBinding["asset"] & { alt: string };
  url: string;
  layer: DemoBinding["layer"];
}> = [];
for (const b of QIANZAI_RUNTIME_INPUTS.resources) {
  const r = content.bindings.resources.find(
    (r) => r.id === b.asset.resourceRef.id,
  );
  const bytes =
    r &&
    (artMode
      ? await readFile(path.join(source, r.path))
      : zip && zip.ok
        ? zip.value.files.get(r.path)
        : null);
  if (!bytes || sha(bytes) !== b.asset.sha256 || bytes.length !== b.asset.bytes)
    throw Error("ASSET_IDENTITY_MISMATCH");
  const url = "/asset/" + r!.id;
  files.set(url, { body: bytes, type: r!.mediaType });
  visuals.push({
    asset: { ...b.asset, alt: "本地体验参考素材" },
    url,
    layer: b.layer,
  });
}
for (const file of [font, ...Object.values(QIANZAI_EDITORIAL_FONTS)].flatMap(
  (f) => [f.file, f.coverage, f.licenseFile],
))
  files.set(file, {
    body: await readFile(path.join("public", file)),
    type: file.endsWith("woff2") ? "font/woff2" : "text/plain;charset=utf-8",
  });
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  entryPoints: ["src/features/theme/qianzai-tongxin/browser.test-support.tsx"],
  outfile: path.join(out, "demo.js"),
  bundle: true,
  jsx: "automatic",
  format: "iife",
  tsconfig: "tsconfig.json",
  alias: {
    react: path.resolve("node_modules/react"),
    "react-dom": path.resolve("node_modules/react-dom"),
  },
  plugins: [
    {
      name: "browser-node-policy-unreachable",
      setup(b: {
        onResolve(o: object, cb: () => object): void;
        onLoad(o: object, cb: () => object): void;
      }) {
        b.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents:
            'export const types=new Proxy({},{get(){throw Error("NODE_POLICY_UNREACHABLE")}});',
          loader: "js",
        }));
      },
    },
  ],
});
files.set("/demo.js", {
  body: await readFile(path.join(out, "demo.js")),
  type: "text/javascript",
});
files.set("/demo.css", {
  body: await readFile(path.join(out, "demo.css")),
  type: "text/css",
});
const setup = (reviewModel = completed) =>
  JSON.stringify({
    session,
    completed: reviewModel,
    review: true,
    v11Demo: true,
    compositionEndpoint: "/demo/compose",
    visuals,
    completedVisuals: visuals,
  }).replaceAll("<", "\\u003c");
const resetScript = `document.querySelector('#demo-reset').addEventListener('click',()=>{for(const k of Object.keys(localStorage))if(k.startsWith('qianzai-v11-demo:'))localStorage.removeItem(k);for(const k of Object.keys(sessionStorage))if(k.includes('consumer'))sessionStorage.removeItem(k);location.href='/';});`;
const about = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千载同心 · 体验入口</title><style>body{max-width:620px;margin:8vh auto;padding:24px;background:#122839;color:#f8e6be;font:16px/1.8 system-ui}a,button{display:inline-block;padding:12px 18px;margin:8px;color:inherit;background:transparent;border:1px solid #b99c65;border-radius:8px;font:inherit;cursor:pointer}h1{font-size:28px}</style><h1>千载同心 · 下部构图与姓名居中体验</h1><p>24题与现有确定性评分引擎可连续体验；会话和回执为本地隔离模拟，不连接原数据库，不使用原体验资格。人物沿用现有参考素材，新增资料与短句为体验候选。</p><a href="/">继续当前体验</a><button id="demo-reset">开始一轮新体验</button><a href="/?review-report=reveal">直接查看李白揭晓与报告示例</a><a href="/?review-report=reveal&role=su-shi">直接查看苏轼揭晓与报告示例</a><a href="/?review-report=reveal&role=tao-yuanming">直接查看陶渊明揭晓与报告示例</a><script>${resetScript}</script></html>`;
const html = (reviewModel = completed) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千载同心 · 下部构图与姓名居中体验</title><link rel="stylesheet" href="/demo.css"><style>@font-face{font-family:"${font.family}";src:url(${font.file});font-weight:600;font-display:swap}html,body{margin:0;height:100%;overflow:hidden;background:#0b1727}</style><div id="root"></div><script id="fixture" type="application/json">${setup(reviewModel)}</script><script src="/demo.js"></script></html>`;

const port = Number(process.env.QZTX_V11_PORT ?? "63201");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("LOCAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${port}`;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", origin);
    if (req.method === "POST" && url.pathname === "/demo/compose") {
      if (
        req.headers.origin !== origin ||
        !String(req.headers["content-type"]).startsWith("application/json")
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      let text = "";
      for await (const chunk of req) {
        text += chunk.toString();
        if (Buffer.byteLength(text) > 32768) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      const display = compose(JSON.parse(text));
      res.writeHead(display ? 200 : 422, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(display ?? { error: "INVALID_DEMO_ANSWERS" }));
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const item =
      url.pathname === "/about"
        ? { body: about, type: "text/html;charset=utf-8" }
        : url.pathname === "/"
          ? {
              body: html(
                url.searchParams.has("review-report")
                  ? (reviewModels.get(
                      url.searchParams.get("role") ?? "li-bai",
                    ) ?? completed)
                  : completed,
              ),
              type: "text/html;charset=utf-8",
            }
          : files.get(url.pathname);
    if (!item) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": item.type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(item.body);
  } catch {
    res.writeHead(400);
    res.end("DEMO_REQUEST_INVALID");
  }
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, "127.0.0.1", resolve);
});
const info = {
  origin,
  pid: process.pid,
  out,
  sourceHash,
  renderer,
  scope:
    "real UI/controller/resource lease/pure scoring/canvas; synthetic session transport; no database",
};
await writeFile(path.join(out, "server.json"), JSON.stringify(info, null, 2), {
  mode: 0o600,
});
console.log(JSON.stringify(info));
