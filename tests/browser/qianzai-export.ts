import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
/** Actual canvas/font/resource/owner path. Invented test report and original synthetic pixels only. */
const root = process.cwd(),
  out = path.resolve(".cache/qztx-export/browser", String(Date.now()));
await mkdir(out, { recursive: true, mode: 0o700 });
const fixture = await qianzaiExportFixture();
const pixel = await sharp(
  Buffer.from(Array.from({ length: 8 * 8 * 3 }, (_, i) => (i * 17) % 256)),
  { raw: { width: 8, height: 8, channels: 3 } },
)
  .png()
  .toBuffer();
const digest = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// Test-only original geometric art makes the actual exported layout visible without approving private art.
const portrait = await sharp({
  create: { width: 580, height: 675, channels: 3, background: "#203e53" },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="580" height="675"><circle cx="420" cy="140" r="100" fill="#edce91"/><path d="M0 675L180 220L420 675" fill="#57798a"/><path d="M180 675L400 310L580 675" fill="#8da3aa"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const name = await sharp({
  create: { width: 270, height: 365, channels: 4, background: "#00000000" },
})
  .composite([
    {
      input: Buffer.from(
        '<svg width="270" height="365"><path d="M90 20L55 150L155 130L90 240L220 210L160 340" fill="none" stroke="#855c28" stroke-width="28"/></svg>',
      ),
    },
  ])
  .png()
  .toBuffer();
const files = new Map<string, { body: Uint8Array | string; type: string }>();
const character = fixture.model.report!.view.display.slots.character;
const replaceAsset = (
  id: string,
  bytes: Buffer,
  width: number,
  height: number,
) => {
  const asset = fixture.model.report!.view.display.assets.find(
    (a) => a.resourceRef.id === id,
  )!;
  Object.assign(asset, {
    bytes: bytes.length,
    sha256: digest(bytes),
    width,
    height,
    mediaType: "image/png",
  });
  fixture.bindings.forEach((binding, i) => {
    if (binding.asset.resourceRef.id === id) {
      const { alt, ...facts } = asset;
      void alt;
      fixture.bindings[i] = { ...binding, asset: facts };
    }
  });
  files.set(`/asset/${id}`, { body: bytes, type: "image/png" });
};
for (const asset of fixture.model.report!.view.display.assets)
  files.set(`/asset/${asset.resourceRef.id}`, {
    body: pixel,
    type: "image/png",
  });
replaceAsset(character.poster.id, portrait, 580, 675);
replaceAsset(character.report.id, portrait, 580, 675);
replaceAsset(character.nameArt.id, name, 270, 365);
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [path.join(root, "tests/browser/qianzai-export.client.ts")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "synthetic-compiled-resource-fixture",
      setup(build: {
        onLoad(filter: { filter: RegExp }, callback: () => object): void;
      }) {
        build.onLoad(
          { filter: /\/qianzai-tongxin\/runtime-inputs\.ts$/ },
          () => ({
            contents: `export const QIANZAI_RUNTIME_INPUTS = ${JSON.stringify({ font: fixture.font, resources: fixture.bindings })} as const;`,
            loader: "ts",
          }),
        );
      },
    },
  ],
  logLevel: "silent",
});
files.set("/probe.js", {
  body: await readFile(path.join(out, "probe.js")),
  type: "text/javascript",
});
for (const f of [fixture.font.file, fixture.font.coverage])
  files.set(f, {
    body: await readFile(path.join(root, "public", f)),
    type: f.endsWith("woff2") ? "font/woff2" : "text/plain",
  });
files.set("/", {
  body: `<!doctype html><meta charset="utf-8"><title>Synthetic Qianzai PNG probe</title><script id="fixture" type="application/json">${JSON.stringify(fixture).replaceAll("<", "\\u003c")}</script><script src="/probe.js"></script>`,
  type: "text/html; charset=utf-8",
});
const server = createServer((req, res) => {
  const file = files.get(req.url ?? "");
  res.writeHead(file ? 200 : 404, {
    "content-type": file?.type ?? "text/plain",
    "cache-control": "no-store",
  });
  res.end(file?.body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("ISOLATED_PORT_REQUIRED");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
type Probe = {
  generate(kind: "poster" | "full-report"): Promise<{
    phase: string;
    code?: string;
    bytes?: number[];
    artifact?: { width: number; height: number };
    liveUrls: number;
  }>;
  reset(mode: string): void;
  late(): Promise<{ phase: string; liveUrls: number }>;
  provider(): Promise<{
    generated: string;
    urlsAfterGenerate: number;
    downloadWhilePending: boolean;
    parentAborted: boolean;
    liveUrls: number;
  }>;
  close(): number;
};
const receipts: unknown[] = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/`);
  for (const kind of ["poster", "full-report"] as const) {
    const result = await page.evaluate(
      (kind) =>
        (
          window as unknown as { qianzaiExportProbe: Probe }
        ).qianzaiExportProbe.generate(kind),
      kind,
    );
    expect(
      result.phase,
      JSON.stringify({ phase: result.phase, code: result.code }),
    ).toBe("ready");
    const data = Buffer.from(result.bytes!),
      meta = await sharp(data).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(kind === "poster" ? 941 : 724);
    expect(meta.height).toBe(result.artifact!.height);
    const file = path.join(out, `${kind}.png`);
    await writeFile(file, data, { flag: "wx", mode: 0o600 });
    receipts.push({
      kind,
      file,
      width: meta.width,
      height: meta.height,
      bytes: data.length,
      sha256: digest(data),
    });
  }
  if (!process.argv.includes("--qualifier-only")) {
    const cached = await page.evaluate(() =>
      (
        window as unknown as { qianzaiExportProbe: Probe }
      ).qianzaiExportProbe.generate("poster"),
    );
    expect(cached.liveUrls).toBe(2);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { qianzaiExportProbe: Probe }
        ).qianzaiExportProbe.close(),
      ),
    ).toBe(0);
    for (const mode of ["wrong-hash", "missing-font"] as const) {
      await page.evaluate(
        (mode) =>
          (
            window as unknown as { qianzaiExportProbe: Probe }
          ).qianzaiExportProbe.reset(mode),
        mode,
      );
      const result = await page.evaluate(() =>
        (
          window as unknown as { qianzaiExportProbe: Probe }
        ).qianzaiExportProbe.generate("poster"),
      );
      expect(result.phase).toBe("error");
      expect(result.liveUrls).toBe(0);
      receipts.push({ mode, ...result });
    }
    const late = await page.evaluate(() =>
      (
        window as unknown as { qianzaiExportProbe: Probe }
      ).qianzaiExportProbe.late(),
    );
    expect(late).toEqual({ phase: "closed", liveUrls: 0 });
    receipts.push({ mode: "late-encode-close", ...late });
    const provider = await page.evaluate(() =>
      (
        window as unknown as { qianzaiExportProbe: Probe }
      ).qianzaiExportProbe.provider(),
    );
    expect(provider).toEqual({
      generated: "ready",
      urlsAfterGenerate: 1,
      downloadWhilePending: false,
      parentAborted: false,
      liveUrls: 0,
    });
    receipts.push({ mode: "strict-provider-latest-pending", ...provider });
  }
  await page.evaluate(() =>
    (
      window as unknown as { qianzaiExportProbe: Probe }
    ).qianzaiExportProbe.reset("missing-glyph"),
  );
  const glyph = await page.evaluate(() =>
    (
      window as unknown as { qianzaiExportProbe: Probe }
    ).qianzaiExportProbe.generate("full-report"),
  );
  expect(glyph).toMatchObject({
    phase: "error",
    code: "FONT_COVERAGE",
    liveUrls: 0,
  });
  receipts.push({ mode: "explicit-uncovered-codepoint", ...glyph });
  expect(errors).toEqual([]);
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        qualification:
          "synthetic-report-original-geometric-pixels-no-author-approval",
        browser: browser.version(),
        businessHttp: false,
        database: false,
        errors,
        receipts,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ out, browser: browser.version(), receipts }));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
