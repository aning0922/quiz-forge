import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import {
  createConsumerToken,
  CONSUMER_COOKIE_NAME_V1,
} from "@/lib/consumer-contract/v1/credentials";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { normalizeRuntimeConfig } from "@/lib/db/runtime";
import { handleConsumerHttp } from "@/features/fulfillment/consumer-flow/http/handler";
import type { ConsumerFlowService } from "@/features/fulfillment/consumer-flow/service-contract";
import type { createStudioRequestBudget } from "@/lib/http-security/request-budget";
/** Actual React form/client + HTTP handler/cookie; synthetic service, no database or business acceptance. */
const out = path.resolve(
  ".cache/platform-home-access/browser",
  String(Date.now()),
);
await mkdir(out, { recursive: true, mode: 0o700 });
const esbuild = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
)("esbuild");
await esbuild.build({
  entryPoints: [path.resolve("tests/browser/platform-home-access.client.tsx")],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "silent",
});
const files = new Map<string, { body: Buffer | string; type: string }>([
  [
    "/probe.js",
    {
      body: await readFile(path.join(out, "probe.js")),
      type: "text/javascript",
    },
  ],
]);
files.set("/", {
  body: '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#faf1f8;color:#483650;font:16px/1.8 system-ui}.card{max-width:430px;margin:24px auto;padding:24px;background:#fff;border:1px solid #eadeee;border-radius:24px}.label{display:block;font-size:16px}.input{display:block;width:100%;min-height:48px;font:16px system-ui;border:1px solid #d9c7e0;border-radius:14px;padding:12px}.message{font-size:16px}.button{min-height:46px;padding:10px 18px;border:0;border-radius:24px;background:#d96596;color:white;font:16px system-ui;margin:6px}#toggle{min-height:44px;font:16px system-ui}</style><main id="root"></main><script src="/probe.js"></script></html>',
  type: "text/html; charset=utf-8",
});
const sessionId = "00000000-0000-4000-8000-000000000002";
const response = (destination: "play" | "report") => ({
  schemaVersion: "quizforge.consumer-exchange.v1" as const,
  destination,
  session: {
    productId: "synthetic-other-work",
    keyId: "00000000-0000-4000-8000-000000000001",
    sessionId,
    playVersionId: "00000000-0000-4000-8000-000000000003",
    playSnapshotSha256: "a".repeat(64),
  },
});
let origin = "",
  expectedKey = "",
  posts = 0,
  bodyMatches = true,
  headerLeak = false,
  destinationCookie = false,
  mode: "play" | "report" | "claimed" | "invalid" | "hold" = "play";
let release: (() => void) | undefined;
const inFlight = new Set<Promise<void>>();
const server = createServer((req, res) => {
  const work = (async () => {
    headerLeak ||= /qfk_p4_|#key=/.test(
      (req.url ?? "") + Object.values(req.headers).join(" "),
    );
    if (req.url === "/access/exchange") {
      posts++;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      try {
        const parsed = JSON.parse(body.toString());
        bodyMatches &&=
          parsed.rawKey === expectedKey && Object.keys(parsed).length === 1;
      } catch {
        bodyMatches = false;
      }
      if (mode === "invalid") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ...response("play"),
            destination: "https://invalid.example",
          }),
        );
        return;
      }
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value)
          headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(origin + req.url, {
        method: req.method ?? "GET",
        headers,
        body,
        signal: abort.signal,
      });
      const id = "a".repeat(32);
      const config = normalizeRuntimeConfig({
        version: 1,
        profile: "local-http-p2a",
        purpose: "test",
        origin,
        instanceId: id,
        database: {
          host: "127.0.0.1",
          port: 55421,
          name: `qf_db_${id}`,
          user: `qf_app_${id}`,
          password: "A".repeat(43),
        },
        server: { version: 180004, address: "127.0.0.1", port: 55421 },
      });
      let clock: ReturnType<typeof createStudioRequestBudget> | undefined;
      const missing = async (): Promise<never> => {
        throw Error("UNEXPECTED_SYNTHETIC_SERVICE_METHOD");
      };
      const selected = mode;
      const service: ConsumerFlowService = {
        readSession: missing,
        readEntry: missing,
        save: missing,
        resolveSave: missing,
        complete: missing,
        resolveComplete: missing,
        readReport: missing,
        readResource: missing,
        logout: missing,
        exchange: async () => {
          if (selected === "claimed")
            throw new ConsumerError("KEY_ALREADY_CLAIMED");
          if (selected === "hold")
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          return {
            result: response(selected === "report" ? "report" : "play"),
            cookieGrantToken: createConsumerToken("grant"),
          };
        },
      };
      const actual = await handleConsumerHttp(
        request,
        { action: "exchange" },
        {
          loadConfig: async () => config,
          createOwner: (_config, budget) => {
            clock = budget;
            return {
              closeIfNotTransferred: async () => {
                clock?.dispose();
              },
              resourceBody: () => {
                throw Error("NO_RESOURCE");
              },
            };
          },
          createService: () => service,
        },
      );
      if (!res.destroyed) {
        res.writeHead(actual.status, Object.fromEntries(actual.headers));
        res.end(Buffer.from(await actual.arrayBuffer()));
      }
      return;
    }
    if (req.url?.startsWith(`/play/${sessionId}`)) {
      destinationCookie ||= (req.headers.cookie ?? "").includes(
        `${CONSUMER_COOKIE_NAME_V1}=`,
      );
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        "<!doctype html><title>Synthetic destination</title><p>合成会话目的地</p>",
      );
      return;
    }
    const file = files.get(req.url ?? "");
    res.writeHead(file ? 200 : 404, {
      "content-type": file?.type ?? "text/plain",
      "cache-control": "no-store",
    });
    res.end(file?.body);
  })();
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("ISOLATED_PORT_REQUIRED");
origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const checks: unknown[] = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    page = await context.newPage(),
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.name));
  const ready = async () => {
    await page.goto(origin);
    await page.waitForFunction(
      () => document.documentElement.dataset.ready === "true",
    );
  };
  const fill = async (raw: string) => {
    await page.locator('input[type="password"]').evaluate((element, raw) => {
      (element as HTMLInputElement).value = raw;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, raw);
  };
  await ready();
  expect(posts).toBe(0);
  for (const destination of ["play", "report"] as const) {
    mode = destination;
    expectedKey = createConsumerToken("access-key");
    await fill(expectedKey);
    await page.getByRole("button", { name: "兑换并进入", exact: true }).click();
    await expect(page).toHaveURL(
      origin + `/play/${sessionId}${destination === "report" ? "/report" : ""}`,
    );
    const cookie = (await context.cookies(origin + `/play/${sessionId}`)).find(
      (c) => c.name === CONSUMER_COOKIE_NAME_V1,
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe(`/play/${sessionId}`);
    expect(destinationCookie).toBe(true);
    checks.push({
      destination,
      protocol: "actual-handler",
      httpOnly: true,
      sessionScopedCookie: true,
    });
    await ready();
  }
  mode = "claimed";
  expectedKey = createConsumerToken("access-key");
  await fill(expectedKey);
  await page.getByRole("button", { name: "兑换并进入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已有绑定访问");
  expect(await page.locator("input").inputValue()).toBe("");
  await page.screenshot({ path: path.join(out, "error-390.png") });
  mode = "invalid";
  expectedKey = createConsumerToken("access-key");
  await fill(expectedKey);
  await page.getByRole("button", { name: "兑换并进入", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("暂时无法验证");
  expect(page.url()).toBe(origin + "/");
  const before = posts;
  mode = "hold";
  expectedKey = createConsumerToken("access-key");
  await fill(expectedKey);
  await page.locator("form").evaluate((form) => {
    if (!(form instanceof HTMLFormElement)) throw Error("FORM_REQUIRED");
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => posts).toBe(before + 1);
  await expect.poll(() => Boolean(release)).toBe(true);
  expect(await page.locator("input").inputValue()).toBe("");
  await page.getByRole("button", { name: "取消验证" }).click();
  await expect(page.getByRole("status")).toContainText("服务端可能已处理");
  release!();
  await expect.poll(() => inFlight.size).toBe(0);
  expect(page.url()).toBe(origin + "/");
  expect(posts).toBe(before + 1);
  expectedKey = createConsumerToken("access-key");
  await fill(expectedKey);
  await page.locator("#toggle").click();
  expect(await page.locator("input").inputValue()).toBe("");
  expect(await page.locator("input").isDisabled()).toBe(true);
  const secretFree = await page.evaluate(
    (raw) =>
      !JSON.stringify({
        html: document.documentElement.outerHTML,
        text: document.body.textContent,
        history: history.state,
        location: location.href,
        local: { ...localStorage },
        session: { ...sessionStorage },
      }).includes(raw),
    expectedKey,
  );
  expect(secretFree && bodyMatches && !headerLeak).toBe(true);
  expect(errors).toEqual([]);
  checks.push({
    strictMode: true,
    automaticPosts: 0,
    duplicatePosts: 1,
    cancelLateNavigation: false,
    inactiveClearsInput: true,
    invalidResponseRejected: true,
    secretFree: true,
  });
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        qualification:
          "actual-form-client-http-handler-cookie-synthetic-service-no-db",
        browser: browser.version(),
        viewport: [390, 844],
        posts,
        bodyMatches,
        headerLeak,
        errors,
        checks,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ out, posts, checks }));
} finally {
  release?.();
  await browser?.close();
  await Promise.allSettled([...inFlight]);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
