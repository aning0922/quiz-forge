/** Isolated, real-font scene checks. GET-only static authored definitions and
 * admitted bytes; no controller, database, author answers, or production server.
 * QZTX_EDITORIAL_ASSETS may point at a copied candidate-02 assets directory. */
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import { qianzaiPresentationFixture } from "@/features/report/qianzai-tongxin/result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "@/features/report/qianzai-tongxin/result-presentation";
import { QIANZAI_ROLE_PROFILES_V11 } from "@/features/report/qianzai-tongxin/role-profiles-v11";
import { QIANZAI_RUNTIME_INPUTS as input } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import { QIANZAI_EDITORIAL_FONTS } from "@/features/theme/qianzai-tongxin/editorial-fonts";

const out = path.resolve(`.cache/qztx-editorial-scenes/${Date.now()}`);
await mkdir(out, { recursive: true });
const source =
  process.env.QZTX_EDITORIAL_ASSETS ??
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-full-flow-demo/quiz-forge/.cache/qztx-full-flow/assets";
const questionPath =
  process.env.QZTX_EDITORIAL_CONTENT ??
  path.resolve(source, "../candidate-02/content.json");
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const files = new Map<string, { bytes: Buffer; type: string }>();
const coverages = new Map<string, Set<string>>();
if (!input.font) throw Error("PINNED_SERIF_REQUIRED");
const fonts = [input.font, ...Object.values(QIANZAI_EDITORIAL_FONTS)];
for (const f of fonts) {
  const bytes = await readFile(path.resolve("public", f.file.slice(1)));
  expect(digest(bytes)).toBe(f.fileSha256);
  expect(bytes.length).toBe(f.bytes);
  const coverage = await readFile(path.resolve("public", f.coverage.slice(1)));
  expect(digest(coverage)).toBe(f.coverageSha256);
  coverages.set(f.family, new Set(Array.from(coverage.toString())));
  files.set(f.file, { bytes, type: "font/woff2" });
}
const base = await qianzaiPresentationFixture();
async function reveal(id: string) {
  const model = structuredClone(base.model),
    display = model.report!.view.display;
  const ref = { productId: "qianzai-tongxin", id, version: "1.0.0" };
  display.selectedResultRef = display.body.matching.selected.ref = ref;
  display.slots.character.resultRef = ref;
  delete display.slots.character.revealComposite;
  const rows = input.resources.filter(
    (r) =>
      r.slot === "character.reveal" &&
      r.asset.resourceRef.id === `qztx-test-${id}-portrait`,
  );
  expect(rows).toHaveLength(1);
  display.assets = rows.map((r) => ({ ...r.asset, alt: "受控候选布局验证" }));
  for (const r of rows) {
    display.slots.character.reveal = r.asset.resourceRef;
    const filename =
      id === "su-shi"
        ? "su-shi-portrait-candidate.png"
        : `${id}-portrait-reference.png`;
    const bytes = await readFile(path.join(source, filename));
    expect(digest(bytes)).toBe(r.asset.sha256);
    files.set(`/asset/${r.asset.resourceRef.id}`, {
      bytes,
      type: r.asset.mediaType,
    });
  }
  const result = deriveQianzaiResultPresentation(
    model.report!.view,
    base.binding,
  );
  if (!result) throw Error("BOUND_PRESENTATION_REQUIRED");
  display.body.matching.selected.label = result.role.displayName;
  return {
    model,
    result,
    images: rows.map((r) => ({
      asset: { ...r.asset, alt: "受控候选布局验证" },
      layer: r.layer,
    })),
  };
}
const cases = {
  tao: await reveal("tao-yuanming"),
  li: await reveal("li-qingzhao"),
  su: await reveal("su-shi"),
};
// Four-character recipe and long-copy stress are layout-only overrides, not new
// content, scoring output, or approved character presentation.
const longestQuote = QIANZAI_ROLE_PROFILES_V11.find(
  (p) => p.ref.id === "li-qingzhao",
)!.quotes[0]!;
expect(Array.from(longestQuote.text)).toHaveLength(14);
cases.li = {
  ...cases.li,
  result: {
    ...cases.li.result,
    quote: { ...cases.li.result.quote, ...longestQuote },
  },
};
const four = {
  ...structuredClone(cases.tao),
  result: {
    ...cases.tao.result,
    role: { ...cases.tao.result.role, displayName: "千载同心" },
  },
};
const long = {
  ...structuredClone(cases.tao),
  result: {
    ...cases.tao.result,
    reveal: {
      ...cases.tao.result.reveal,
      lines: [
        "愿你走过漫长山河仍然愿意抬头看月亮，也愿这一程相逢留住属于自己的诗意与从容。".repeat(
          2,
        ),
        "每次选择都可以再次思量，每一段故事都有自己的方向。".repeat(2),
        "也愿此时此刻的你，仍然记得自己的声音。".repeat(2),
      ],
    },
  },
};
const scope = <T>(v: T): T =>
  JSON.parse(
    JSON.stringify(v, (k, x) => (k === "productId" ? "qianzai-tongxin" : x)),
  );
const model = scope(structuredReaderFixtureV2().model),
  entry = model.entry!;
const contentBytes = await readFile(questionPath);
entry.questions = JSON.parse(contentBytes.toString()).core.questions;
expect(entry.questions).toHaveLength(24);
const rows = input.resources.filter(
  (r) => r.slot === "cover" || r.slot.startsWith("acts."),
);
const asset = (slot: string) => rows.find((r) => r.slot === slot)!.asset;
entry.assets = rows.map((r) => ({ ...r.asset, alt: "受控场景布局验证" }));
entry.slots.cover = asset("cover").resourceRef;
entry.slots.acts = [0, 1, 2].map((i) => ({
  ...entry.slots.acts[0]!,
  sectionId: ["act-one", "act-two", "act-three"][i]!,
  background: asset(`acts.${i}.background`).resourceRef,
  questionPaper: asset(`acts.${i}.questionPaper`).resourceRef,
  optionIdle: asset(`acts.${i}.optionIdle`).resourceRef,
  optionSelected: asset(`acts.${i}.optionSelected`).resourceRef,
}));
model.draft!.matchingContext = model.state!.matchingContext = {
  schemaVersion: "quiz-matching-context.v1",
  policyRef: entry.matchingPolicyRef,
  preference: "any",
};
for (const r of rows) {
  const bytes = await readFile(
    path.join(
      source,
      `${r.asset.resourceRef.id}.${r.asset.mediaType.split("/")[1]!.replace("jpeg", "jpg")}`,
    ),
  );
  expect(digest(bytes)).toBe(r.asset.sha256);
  files.set(`/asset/${r.asset.resourceRef.id}`, {
    bytes,
    type: r.asset.mediaType,
  });
}
const question = {
  model,
  result: null,
  images: rows.map((r) => ({
    asset: { ...r.asset, alt: "受控场景布局验证" },
    layer: r.layer,
  })),
};
const fixtures = { ...cases, four, long, question };
function covered(family: string, text: string) {
  const set = coverages.get(family)!;
  expect([...text].filter((c) => !/\s/u.test(c) && !set.has(c))).toEqual([]);
}
covered(
  fonts[0]!.family,
  entry.questions
    .flatMap((q) => [q.prompt, ...q.options.map((o) => o.label)])
    .join("") + "←上一题下一题走向相逢→",
);
for (const f of [cases.tao, cases.li, cases.su, four, long]) {
  covered(
    QIANZAI_EDITORIAL_FONTS.brush.family,
    "千载同心" + f.result.role.displayName,
  );
  covered(
    QIANZAI_EDITORIAL_FONTS.literary.family,
    "你是" + f.result.quote.text + f.result.reveal.lines.join(""),
  );
}
const client = `
import {useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {QianzaiReveal,QianzaiQuestion} from './src/features/theme/qianzai-tongxin/views';
import {QianzaiContinuousReader} from './src/features/theme/qianzai-tongxin/experience';
import styles from './src/features/theme/qianzai-tongxin/qianzai.module.css';
import typography from './src/features/theme/qianzai-tongxin/typography.module.css';
const fixture=JSON.parse(document.getElementById('fixture').textContent);window.__editorialFixture=fixture;
function App(){const [images,setImages]=useState(null);const navigation=useRef(null);const [model,setModel]=useState(fixture.model);
useEffect(()=>{let live=true;const urls=[];Promise.all([Promise.all(fixture.fonts.map(async f=>{const bytes=await fetch(f.file).then(r=>r.arrayBuffer());const face=new FontFace(f.family,bytes,{weight:String(f.weight)});await face.load();document.fonts.add(face);return {family:face.family,status:face.status,weight:face.weight}})),Promise.all(fixture.images.map(async a=>{const bytes=await fetch('/asset/'+a.asset.resourceRef.id).then(r=>r.arrayBuffer());const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(sha!==a.asset.sha256)throw Error('ASSET_BYTES_CHANGED');const objectUrl=URL.createObjectURL(new Blob([bytes],{type:a.asset.mediaType}));urls.push(objectUrl);const img=new Image();img.src=objectUrl;await img.decode();return {...a,objectUrl}}))]).then(([faces,v])=>{window.__editorialFonts=faces;if(live)setImages(v)}).catch(e=>{document.body.dataset.error=String(e)});return()=>{live=false;urls.forEach(URL.revokeObjectURL)}},[]);
const props={model,images:images?.filter(a=>a.layer==='clean'),prototypeImages:images?.filter(a=>a.layer!=='clean'),onEvent:()=>{throw Error('NO_BUSINESS_IO')},onRead:s=>s==='report'?navigation.current?.toReport():navigation.current?.toReveal()};
return <div className={typography.root}><div className={styles.host} data-editorial-ready={!!images}>{images&&(fixture.question?<QianzaiQuestion {...props} onChoose={(questionId,optionId)=>setModel(m=>({...m,draft:{...m.draft,answers:[{questionId,optionId}]}}))}/>:<QianzaiContinuousReader navigation={navigation} reveal={active=><QianzaiReveal {...props} active={active} presentation='ready'/>} report={embedded=><><nav data-qianzai-report-toolbar style={{height:112}}>人物报告</nav><article data-qianzai-report-start style={{marginTop:'var(--qianzai-reveal-height)',minHeight:1800,background:'#f4e4c4'}}><h2 tabIndex={-1} data-report-opening-title>布局验证报告</h2><button onClick={embedded.onReturn}>返回揭晓</button></article></>}/>)}</div></div>}
createRoot(document.getElementById('root')).render(<App/>);`;
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  stdin: { contents: client, loader: "tsx", resolveDir: process.cwd() },
  outfile: path.join(out, "probe.js"),
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
      name: "synthetic-getter-only",
      setup(b: {
        onResolve: (
          o: { filter: RegExp },
          cb: () => { path: string; namespace: string },
        ) => void;
        onLoad: (
          o: { filter: RegExp; namespace: string },
          cb: () => { contents: string },
        ) => void;
      }) {
        b.onResolve({ filter: /^\.\/export-context$/ }, () => ({
          path: "editorial-port",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const useQianzaiExport=()=>({getResultPresentation:()=>window.__editorialFixture.result});",
        }));
      },
    },
  ],
});
for (const ext of ["js", "css"])
  files.set(`/probe.${ext}`, {
    bytes: await readFile(path.join(out, `probe.${ext}`)),
    type: ext === "js" ? "text/javascript" : "text/css",
  });
const server = createServer((req, res) => {
  if (req.method !== "GET") {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url!, "http://local"),
    file = files.get(url.pathname);
  if (file) {
    res.setHeader("content-type", file.type);
    res.end(file.bytes);
    return;
  }
  const key = url.searchParams.get("case") ?? "tao";
  if (!(key in fixtures)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const fixture = structuredClone(fixtures[key as keyof typeof fixtures]);
  if (key === "question") {
    const index = Number(url.searchParams.get("index") ?? 21);
    const id = fixture.model.entry!.questions[index]!.ref.id;
    fixture.model.state!.progress = fixture.model.draft!.progress = {
      questionId: id,
    };
  }
  res.setHeader("content-type", "text/html;charset=utf-8");
  res.end(
    `<html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>body{margin:0;background:#0b1727}p{margin:0}</style><div id="root"></div><script id="fixture" type="application/json">${JSON.stringify({ ...fixture, fonts, question: key === "question" }).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script></html>`,
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string")
  throw Error("OWNED_ORIGIN_MISSING");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch(),
  page = await browser.newPage({ reducedMotion: "reduce" });
const errors: string[] = [],
  writes: string[] = [],
  checks: unknown[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (r.method() !== "GET") writes.push(r.method());
});
const navOnly = process.argv.includes("--nav-only");
let passed = false;
async function open(key: string, width: number, height: number, index = 21) {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/?case=${key}&index=${index}`);
  await expect(page.locator("[data-editorial-ready=true]")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { __editorialFonts: { status: string }[] }
      ).__editorialFonts.map((f) => f.status),
    ),
  ).toEqual(["loaded", "loaded", "loaded"]);
}
try {
  for (const [width, height] of [
    [320, 568],
    [375, 812],
    [390, 844],
    [430, 932],
  ] as const) {
    if (navOnly && width !== 320 && width !== 390) continue;
    for (const index of navOnly ? [21, 23] : [0, 8, 16, 20, 21]) {
      await open("question", width, height, index);
      const q = await page
        .locator("[data-qianzai-scroll-region]")
        .evaluate((port) => {
          const nodes = [
            ...port.querySelectorAll("h2,label>span:nth-of-type(2)"),
          ];
          const texts = nodes.map((n) => {
            const range = document.createRange();
            range.selectNodeContents(n);
            const b = n.getBoundingClientRect(),
              r = range.getBoundingClientRect(),
              s = getComputedStyle(n);
            return {
              font: s.fontFamily,
              size: s.fontSize,
              weight: s.fontWeight,
              fits: r.width <= b.width + 1 && r.height <= b.height + 1,
              lines: new Set(
                [...range.getClientRects()].map((v) => Math.round(v.top)),
              ).size,
            };
          });
          const scene = port.closest("[data-qianzai-screen]")!,
            top = scene
              .querySelector("[data-qztx-upper-question-scene]")!
              .getBoundingClientRect(),
            water = scene
              .querySelector("[data-qztx-clean-question-water]")!
              .getBoundingClientRect();
          return {
            texts,
            stackHeight: port.firstElementChild!.getBoundingClientRect().height,
            upper: top.height,
            water: water.height,
            sceneHeight: scene.getBoundingClientRect().height,
            continuous: Math.abs(top.bottom - water.top) < 1,
            pattern: !!scene.querySelector("pattern"),
            horizontal: document.documentElement.scrollWidth <= innerWidth,
            targets: [...port.querySelectorAll("label")].every(
              (n) => n.getBoundingClientRect().height >= 44,
            ),
          };
        });
      expect(
        q.texts.every(
          (t) =>
            t.font.startsWith(JSON.stringify(input.font!.family)) &&
            t.size === "16px" &&
            t.weight === "600" &&
            t.fits,
        ),
      ).toBe(true);
      expect(q.texts.slice(1).every((t) => t.lines <= 2)).toBe(true);
      expect(q.continuous && q.horizontal && q.targets && !q.pattern).toBe(
        true,
      );
      expect(q.upper).toBeCloseTo((391 * width) / 390, 0);
      expect(q.water).toBeCloseTo(q.sceneHeight - q.upper, 0);
      if (index === 21) {
        await page.screenshot({
          path: path.join(out, `question-${width}.png`),
        });
        const port = page.locator("[data-qianzai-scroll-region]");
        await port.evaluate((n) => {
          n.scrollTop = n.scrollHeight;
        });
        const bottomVisible = await port.evaluate((n) => {
          const d = n
              .querySelector("label:last-of-type")!
              .getBoundingClientRect(),
            p = n.getBoundingClientRect();
          return d.top >= p.top - 0.5 && d.bottom <= p.bottom + 0.5;
        });
        expect(bottomVisible).toBe(true);
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await page.screenshot({
          path: path.join(out, `question-bottom-${width}.png`),
        });
        checks.push({ width, question: q, lowerOnlyScroll: true });
      }
      if (navOnly) {
        await expect(
          page.locator("[data-qztx-question-nav-art=previous]"),
        ).toHaveAttribute("viewBox", "18 751 114 62");
        await expect(
          page.locator("[data-qztx-question-nav-art=next]"),
        ).toHaveAttribute("viewBox", "251 751 122 62");
        if (index === 23) {
          const port = page.locator("[data-qianzai-scroll-region]");
          await port.evaluate((n) => {
            n.scrollTop = n.scrollHeight;
          });
          await page
            .locator("[data-qianzai-scroll-region] label")
            .last()
            .click();
          await expect(
            page.getByRole("button", { name: "确认最后选择，走向相逢" }),
          ).toBeEnabled();
          await expect(
            page.locator("[data-qztx-question-nav-art=next] text"),
          ).toHaveText("走向相逢");
          const mask = page.locator("[data-qztx-question-nav-art=next] svg");
          expect(
            await mask.evaluate((n) => {
              const svg = n as SVGSVGElement;
              return {
                width: svg.width.baseVal.value,
                height: svg.height.baseVal.value,
                overflow: getComputedStyle(svg).overflow,
              };
            }),
          ).toEqual({ width: 66, height: 25, overflow: "hidden" });
        }
        await page.screenshot({
          path: path.join(out, `nav-q${index + 1}-${width}.png`),
        });
        checks.push({
          width,
          index,
          independentOriginalNavCrops: true,
          lastLabelLocalOnly: index === 23,
        });
      }
      if (width === 390 && index < 20)
        await page.screenshot({
          path: path.join(out, `act-${index / 8 + 1}.png`),
        });
    }
    if (navOnly) continue;
    for (const key of ["tao", "li"]) {
      await open(key, width, height);
      const view = await page
        .locator("[data-qztx-reveal-content]")
        .evaluate((frame) => {
          const name = frame.querySelector("[data-qztx-program-name]")!,
            group = name.parentElement!,
            kicker = group.firstElementChild!,
            quote = frame.querySelector("[data-qianzai-reveal-quote]")!,
            r = document.createRange();
          r.selectNodeContents(quote.firstChild!);
          const b = quote.getBoundingClientRect(),
            t = r.getBoundingClientRect(),
            q = getComputedStyle(quote),
            ns = getComputedStyle(name),
            ks = getComputedStyle(kicker),
            nb = name.getBoundingClientRect(),
            kb = kicker.getBoundingClientRect();
          return {
            height: (frame as HTMLElement).offsetHeight,
            nameFont: ns.fontFamily,
            kickerFont: ks.fontFamily,
            quoteFont: q.fontFamily,
            nameChars: name.children.length,
            aligned:
              Math.abs((nb.left + nb.right - kb.left - kb.right) / 2) < 1,
            quoteChars: quote.firstChild!.textContent!.length,
            quoteFit: t.width <= b.width + 1 && t.height <= b.height + 1,
            nowrap: q.whiteSpace,
            copy: [
              ...frame.querySelectorAll("[data-qianzai-reveal-lines] p"),
            ].map((p) => p.textContent),
            horizontal: document.documentElement.scrollWidth <= innerWidth,
          };
        });
      expect(view.height).toBeGreaterThanOrEqual(844);
      expect(view.nameFont).toContain("QuizForge Qianzai Brush V1");
      expect(view.kickerFont).toContain("QuizForge Qianzai Literary V1");
      expect(view.quoteFont).toContain("QuizForge Qianzai Literary V1");
      expect(view.aligned && view.quoteFit && view.horizontal).toBe(true);
      expect(view.nowrap).toBe("nowrap");
      expect(view.copy).toEqual(cases[key as "tao" | "li"].result.reveal.lines);
      await page.screenshot({ path: path.join(out, `${key}-${width}.png`) });
      checks.push({ width, key, view });
    }
  }
  if (!navOnly) {
    for (const key of ["su", "four"]) {
      await open(key, 390, 844);
      await expect(page.locator("[data-qztx-program-name]")).toHaveAttribute(
        "data-name-size",
        key === "su" ? "2" : "4",
      );
      await page.screenshot({ path: path.join(out, `${key}-390.png`) });
    }
    await open("long", 320, 568);
    const port = page.locator("[data-qianzai-continuous-reader]");
    const height = await page
      .locator("[data-qztx-reveal-content]")
      .evaluate((n) => (n as HTMLElement).offsetHeight);
    expect(height).toBeGreaterThan(844);
    await port.evaluate((n, h) => {
      n.scrollTop = h - n.clientHeight;
    }, height);
    await expect(port).toHaveAttribute("data-toolbar-visible", "false");
    await expect(page.locator("[data-qianzai-reveal-copy]")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect
      .poll(() =>
        port.evaluate((n) =>
          Number(
            getComputedStyle(n).getPropertyValue("--qianzai-reader-progress"),
          ),
        ),
      )
      .toBe(0);
    await page.screenshot({ path: path.join(out, "long-320-bottom.png") });
    await page.locator("[data-reveal-continue]").click();
    await expect(page.locator("[data-report-opening-title]")).toBeFocused();
    await expect(port).toHaveAttribute("data-toolbar-visible", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-reveal-continue]")).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    checks.push({
      shortScreenLongContentHeight: height,
      fullContentReadBeforeFade: true,
      sharedNavigationFocus: true,
    });
  }
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  passed = true;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed,
        scope:
          "isolated React scenes plus shared native scroll owner; real hash-verified local fonts and exact admitted static image bytes; no controller/DB/author/native-device acceptance",
        questionSha256: digest(contentBytes),
        fonts: fonts.map((f) => ({
          family: f.family,
          sha256: f.fileSha256,
          weight: f.weight,
        })),
        checks,
        errors,
        writes,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed, out, checks, errors, writes }));
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
}
