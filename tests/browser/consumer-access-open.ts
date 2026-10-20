import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import { openPrivateConsumerLink } from "../e2e/consumer-flow.ui";

// Actual immutable Access component. Synthetic keys, no DB/Next/3100 unless root
// explicitly owns --fixed-3100, which exercises the complete private-file helper.
declare global {
  interface Window {
    accessOpenProbe: {
      documentId: string;
      replaces: number;
      erased: number;
      hashEvents: number;
    };
  }
}
const out = path.resolve(".cache/p4-access-open", String(Date.now()));
await mkdir(out, { recursive: true });
const fixed = process.argv.includes("--fixed-3100"),
  raw = createConsumerToken("access-key"),
  otherRaw = createConsumerToken("access-key");
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [path.resolve("tests/browser/consumer-access-open.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "silent",
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
let exchangePosts = 0,
  accessGets = 0,
  httpLeak = false,
  manual = false,
  manualBodyMatches = true,
  autoExchange = false;
const server = createServer(async (req, res) => {
  const target = req.url ?? "/";
  httpLeak ||= /qf[kg]_p4_|#key=/.test(
    target + Object.values(req.headers).join(" "),
  );
  if (target === "/access/exchange") {
    exchangePosts++;
    autoExchange ||= !manual;
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    let matches = false;
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString());
      matches = Object.keys(v).length === 1 && v.rawKey === raw;
    } catch {}
    manualBodyMatches &&= matches;
    res.writeHead(503, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        schemaVersion: "quizforge.consumer-error.v1",
        code: "UNAVAILABLE",
        requestId: "00000000-0000-4000-8000-000000000009",
      }),
    );
    return;
  }
  const file = files.get(target);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  if (target === "/access") accessGets++;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><div id="root"></div><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(fixed ? 3100 : 0, "127.0.0.1", r));
const address = server.address();
if (
  !address ||
  typeof address === "string" ||
  (!fixed && address.port === 3100)
)
  throw Error("OWN_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`,
  privateLink = origin + "/access#key=" + raw;
let file = "";
if (fixed) {
  const runId = randomUUID();
  process.env.QF_CONSUMER_E2E_RUN_ID = runId;
  const parent = path.resolve(".cache/p4-e2e-private");
  await mkdir(parent, { mode: 0o700, recursive: true });
  const st = await lstat(parent);
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700)
    throw Error("PRIVATE_PARENT_REQUIRED");
  const dir = path.join(parent, runId);
  await mkdir(dir, { mode: 0o700 });
  file = path.join(dir, "synthetic-private-link.txt");
  await writeFile(file, privateLink, { flag: "wx", mode: 0o600 });
}
const browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  qualification: fixed
    ? "actual Access + complete actual private-file helper on root-owned fixed3100; synthetic only, no DB/Next"
    : "actual Access + exact old/new navigation sequences on ephemeral HTTP; private-file helper destination not altered; no DB/Next/3100",
  cases: [],
};
try {
  const page = await browser.newPage({ baseURL: origin });
  page.setDefaultTimeout(10_000);
  await page.addInitScript(() => {
    const probe = {
      documentId: String(Math.random()),
      replaces: 0,
      erased: 0,
      hashEvents: 0,
    };
    window.accessOpenProbe = probe;
    const native = History.prototype.replaceState;
    const hook = {
      replaceState(
        this: History,
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ) {
        const before = location.hash !== "";
        const value = Reflect.apply(native, this, [data, unused, url]);
        probe.replaces++;
        if (before && location.hash === "") probe.erased++;
        return value;
      },
    };
    History.prototype.replaceState = hook.replaceState;
    window.addEventListener("hashchange", () => {
      probe.hashEvents++;
    });
  });
  await page.goto("/access");
  await expect
    .poll(() => page.evaluate(() => window.accessOpenProbe.replaces))
    .toBe(1);
  const before = await page.evaluate(() => ({
      id: window.accessOpenProbe.documentId,
      replaces: window.accessOpenProbe.replaces,
    })),
    gets = accessGets;
  // Exact old helper order, after the actual initial empty effect is proven done.
  await page.evaluate((value) => {
    location.replace("/access#key=" + value);
  }, raw);
  await expect.poll(() => page.evaluate(() => location.hash !== "")).toBe(true);
  let rejected = false;
  try {
    await expect(
      page.getByRole("button", { name: "验证访问", exact: true }),
    ).toBeEnabled();
  } catch {
    rejected = true;
  }
  const old = await page.evaluate(
    (id) => ({
      sameDocument: window.accessOpenProbe.documentId === id,
      replaces: window.accessOpenProbe.replaces,
      fragmentStillPresent: location.hash !== "",
      buttonCount: document.querySelectorAll("button").length,
    }),
    before.id,
  );
  expect(
    rejected &&
      old.sameDocument &&
      old.fragmentStillPresent &&
      old.replaces === before.replaces &&
      accessGets === gets &&
      exchangePosts === 0,
  ).toBe(true);
  facts.old = {
    ...old,
    rejected,
    noNewDocumentRequest: accessGets === gets,
    automaticExchanges: exchangePosts,
  };
  async function directOpen(link: string) {
    await page.goto("about:blank");
    if (page.url() !== "about:blank") throw Error("SAFE_DOCUMENT_REQUIRED");
    await page.evaluate((value) => {
      location.replace(value);
    }, link);
    await expect(
      page.getByRole("button", { name: "验证访问", exact: true }),
    ).toBeEnabled();
  }
  for (const state of [
    "initial-blank",
    "empty-access",
    "existing-play-document",
    "already-ready-access",
  ]) {
    if (state === "initial-blank") await page.goto("about:blank");
    if (state === "empty-access") {
      await page.goto("/access");
      await expect
        .poll(() => page.evaluate(() => window.accessOpenProbe.replaces))
        .toBe(1);
    }
    if (state === "existing-play-document")
      await page.goto("/play/00000000-0000-4000-8000-000000000001");
    if (state === "already-ready-access")
      await directOpen(origin + "/access#key=" + otherRaw);
    const prior = await page.evaluate(() => window.accessOpenProbe.documentId),
      posts = exchangePosts;
    if (fixed) await openPrivateConsumerLink(page, file);
    else await directOpen(privateLink);
    const result = await page.evaluate(
      (prior) => ({
        newDocument: window.accessOpenProbe.documentId !== prior,
        replaces: window.accessOpenProbe.replaces,
        erased: window.accessOpenProbe.erased,
        hashEmpty: location.hash === "",
        domClean: !/qf[kg]_p4_|#key=/.test(document.documentElement.outerHTML),
        storageClean: ![
          ...Object.values(localStorage),
          ...Object.values(sessionStorage),
        ].some((v) => /qf[kg]_p4_|#key=/.test(v)),
      }),
      prior,
    );
    expect(result).toEqual({
      newDocument: true,
      replaces: 1,
      erased: 1,
      hashEmpty: true,
      domClean: true,
      storageClean: true,
    });
    expect(exchangePosts).toBe(posts);
    expect(httpLeak).toBe(false);
    manual = true;
    await page.getByRole("button", { name: "验证访问", exact: true }).click();
    await expect(
      page.getByText(
        "暂时无法验证访问。可在本页重新验证，或重新打开原私密链接。",
        { exact: true },
      ),
    ).toBeVisible();
    manual = false;
    expect(exchangePosts).toBe(posts + 1);
    expect(manualBodyMatches).toBe(true);
    expect(autoExchange).toBe(false);
    (facts.cases as unknown[]).push({
      state,
      ...result,
      automaticExchanges: 0,
      manualExchanges: 1,
      manualBodyMatches: true,
    });
  }
  facts.httpLeak = httpLeak;
  facts.autoExchange = autoExchange;
  facts.browser = await browser.version();
} finally {
  try {
    await browser.close();
    facts.browserClosed = true;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    facts.serverClosed = true;
    await writeFile(
      path.join(out, "result.json"),
      JSON.stringify(facts, null, 2),
    );
  }
}
console.log(JSON.stringify({ out, passed: true }));
