import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  expect,
  type Page,
  type Response as BrowserResponse,
} from "@playwright/test";
import { observeNextConsumerExchange } from "../e2e/consumer-exchange-observer";
import { proveExchangeObserverTransport } from "./consumer-exchange-observer-transport";
import { consumerExchangeResultSchema } from "@/features/fulfillment/consumer-flow/contracts";
import { createConsumerToken } from "@/lib/consumer-contract/v1/credentials";

// Actual SSR/hydrated gateway and real HTTP. All credentials are ephemeral,
// synthetic and memory-only; artifacts expose booleans/counts/categories only.
declare global {
  interface Window {
    accessLifecycleProbe: {
      hold: boolean;
      held: number;
      aborted: number;
      erasures: number;
      failErase: "none" | "throw" | "noop";
      events: string[];
      release: (index: number, reject?: boolean) => void;
      beforeHydration?: () => void;
    };
  }
}
const out = path.resolve(".cache/p4-access-v1-1", String(Date.now()));
await mkdir(out, { recursive: true });
const require = createRequire(import.meta.url),
  esbuild = createRequire(require.resolve("tsx/package.json"))("esbuild");
await esbuild.build({
  entryPoints: [path.resolve("tests/browser/consumer-access-v1-1.ssr.tsx")],
  outfile: path.join(out, "ssr.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  logLevel: "silent",
});
const ssr = (
  require(path.join(out, "ssr.cjs")) as { render: () => string }
).render();
expect(/qf[kg]_p4_|#key=/.test(ssr)).toBe(false);
const files = new Map<string, { body: Buffer; type: string }>();
// Apply the app's actual explicit global rules. This isolated host does not run
// the Next/Tailwind build; those package imports remain root's build evidence.
files.set("/global-rules.css", {
  body: Buffer.from(
    (await readFile("src/app/globals.css", "utf8")).replace(
      /^@import[^;]+;\s*/gm,
      "",
    ),
  ),
  type: "text/css",
});
for (const kind of ["production", "development"]) {
  const outfile = path.join(out, kind + ".js");
  await esbuild.build({
    entryPoints: [
      path.resolve("tests/browser/consumer-access-v1-1.client.tsx"),
    ],
    outfile,
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": JSON.stringify(kind) },
    logLevel: "silent",
  });
  files.set("/" + kind + ".js", {
    body: await readFile(outfile),
    type: "text/javascript",
  });
  files.set("/" + kind + ".css", {
    body: await readFile(outfile.replace(/\.js$/, ".css")),
    type: "text/css",
  });
}
let expectedKey = "",
  posts = 0,
  destinations = 0,
  httpLeak = false,
  bodiesMatch = true,
  success = false,
  permittedPosts = 0,
  plannedManualPosts = 0,
  automaticPost = false;
let responseContent: "valid" | "malformed" | "oversized" | "hang" = "valid";
function permitManualPost() {
  permittedPosts++;
  plannedManualPosts++;
}
const exchangeResult = {
  schemaVersion: "quizforge.consumer-exchange.v1",
  session: {
    productId: "synthetic-product",
    keyId: "00000000-0000-4000-8000-000000000020",
    sessionId: "00000000-0000-4000-8000-000000000021",
    playVersionId: "00000000-0000-4000-8000-000000000022",
    playSnapshotSha256: "a".repeat(64),
  },
  destination: "play",
};
const server = createServer(async (req, res) => {
  httpLeak ||= /qf[kg]_p4_|#key=/.test(
    (req.url ?? "") + Object.values(req.headers).join(" "),
  );
  const target = new URL(req.url ?? "/", "http://127.0.0.1");
  if (target.pathname === "/access/exchange") {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("synthetic method rejection");
      return;
    }
    posts++;
    automaticPost ||= permittedPosts === 0;
    if (permittedPosts > 0) permittedPosts--;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let matches = false;
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      matches = Object.keys(body).length === 1 && body.rawKey === expectedKey;
    } catch {}
    bodiesMatch &&= matches;
    res.writeHead(success ? 200 : 503, { "content-type": "application/json" });
    if (success && responseContent === "hang") {
      res.write('{"synthetic":');
      return;
    }
    res.end(
      JSON.stringify(
        success
          ? responseContent === "valid"
            ? exchangeResult
            : responseContent === "malformed"
              ? { schemaVersion: "synthetic-invalid" }
              : { oversized: "synthetic".repeat(1024) }
          : {
              schemaVersion: "quizforge.consumer-error.v1",
              code: "UNAVAILABLE",
              requestId: exchangeResult.session.sessionId,
            },
      ),
    );
    return;
  }
  const file = files.get(target.pathname);
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  if (target.pathname.startsWith("/play/")) {
    destinations++;
    res.end(
      "<!doctype html><main>Synthetic exchange destination; no real grant.</main>",
    );
    return;
  }
  const dev = target.pathname === "/strict/access",
    kind = dev ? "development" : "production";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!doctype html><html lang="zh-CN" data-strict="${dev}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global-rules.css"><link rel="stylesheet" href="/${kind}.css"><div id="root">${ssr}</div><script src="/${kind}.js"></script></html>`,
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  qualification:
    "actual new SSR/hydrated Access and existing client/codec, ephemeral synthetic HTTP; no DB/Next/3100/registry acceptance",
  cases: [],
};
let pageErrors = 0,
  hydrationErrors = 0;
async function newPage(
  strict = false,
  initialKey?: string,
  queuedBeforeHydration?: { first: string; last: string },
  nativeFetchOnly = false,
) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.setDefaultTimeout(10_000);
  page.on("pageerror", () => {
    pageErrors++;
  });
  page.on("console", (message) => {
    if (/hydration|hydrating|server rendered/i.test(message.text()))
      hydrationErrors++;
  });
  await page.addInitScript(
    ({
      queued,
      nativeFetchOnly,
    }: {
      queued: { first: string; last: string } | null;
      nativeFetchOnly: boolean;
    }) => {
      const releases: ((reject?: boolean) => void)[] = [];
      const probe = (window.accessLifecycleProbe = {
        hold: false,
        held: 0,
        aborted: 0,
        erasures: 0,
        failErase: "none" as "none" | "throw" | "noop",
        events: [] as string[],
        release(index: number, reject?: boolean) {
          releases[index]?.(reject);
        },
        beforeHydration() {
          if (!queued) return;
          location.hash = "key=" + queued.first;
          location.hash = "";
          location.hash = "key=" + queued.last;
        },
      });
      const replaceState = History.prototype.replaceState;
      const historyHook = {
        replaceState(
          this: History,
          data: unknown,
          unused: string,
          url?: string | URL | null,
        ) {
          probe.erasures++;
          if (probe.failErase === "throw")
            throw Error("synthetic erasure failure");
          if (probe.failErase !== "noop")
            return Reflect.apply(replaceState, this, [data, unused, url]);
        },
      };
      History.prototype.replaceState = historyHook.replaceState;
      window.addEventListener("popstate", () => probe.events.push("popstate"));
      window.addEventListener("hashchange", () =>
        probe.events.push("hashchange"),
      );
      if (nativeFetchOnly) return;
      const nativeFetch = globalThis.fetch;
      const fetchHook = {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const response = await nativeFetch(input, init);
          if (!probe.hold || !String(input).endsWith("/access/exchange"))
            return response;
          const bytes = await response.arrayBuffer();
          init?.signal?.addEventListener(
            "abort",
            () => {
              probe.aborted++;
            },
            { once: true },
          );
          return new Promise<Response>((resolve, reject) => {
            releases.push((fail) =>
              fail
                ? reject(new TypeError("synthetic delayed failure"))
                : resolve(
                    new Response(bytes, {
                      status: response.status,
                      headers: response.headers,
                    }),
                  ),
            );
            probe.held++;
          });
        },
      };
      globalThis.fetch = fetchHook.fetch;
    },
    { queued: queuedBeforeHydration ?? null, nativeFetchOnly },
  );
  const safeURL = origin + (strict ? "/strict/access" : "/access");
  if (initialKey) {
    await page.goto("about:blank");
    await page.evaluate(
      (value) => {
        location.replace(value);
      },
      safeURL + "#key=" + initialKey,
    );
  } else await page.goto(safeURL);
  await expect(
    page.getByRole("heading", { name: "进入你的测评", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.accessLifecycleProbe.erasures))
    .toBeGreaterThan(0);
  return page;
}
async function clean(page: Page) {
  expect(
    await page.evaluate(
      () =>
        !location.hash &&
        !location.search &&
        !/qf[kg]_p4_|#key=/.test(document.documentElement.outerHTML) &&
        ![
          ...Object.values(localStorage),
          ...Object.values(sessionStorage),
        ].some((v) => /qf[kg]_p4_|#key=/.test(v)),
    ),
  ).toBe(true);
  expect(httpLeak).toBe(false);
  expect(bodiesMatch).toBe(true);
}
async function input(page: Page, raw: string) {
  await page.evaluate((value) => {
    location.hash = "key=" + value;
  }, raw);
  await expect(
    page.getByRole("button", { name: "验证访问", exact: true }),
  ).toBeEnabled();
  await clean(page);
}
const unavailable =
  "暂时无法验证访问。可在本页重新验证，或重新打开原私密链接。";
const verifyButton = (page: Page) =>
  page.getByRole("button", { name: "验证访问", exact: true });
async function manualFailure(page: Page, raw: string) {
  expectedKey = raw;
  success = false;
  const before = posts;
  permitManualPost();
  await verifyButton(page).click();
  await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
  expect(posts).toBe(before + 1);
  await clean(page);
}
function record(name: string, detail: Record<string, unknown> = {}) {
  (facts.cases as unknown[]).push({ name, passed: true, ...detail });
}
async function readExchangeResponse(response: BrowserResponse) {
  const status = response.status();
  try {
    const parsed = consumerExchangeResultSchema.safeParse(
      await response.json(),
    );
    return {
      status,
      bodyRead: true,
      schemaMatched:
        parsed.success &&
        parsed.data.session.sessionId === exchangeResult.session.sessionId,
      failureType: null,
      failureCode: null,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    return {
      status,
      bodyRead: false,
      schemaMatched: false,
      failureType: ["Error", "TypeError", "ProtocolError"].includes(name)
        ? name
        : "OTHER",
      failureCode:
        error instanceof Error &&
        /No resource with given identifier|No data found for resource|evicted|Target closed|context was destroyed/i.test(
          error.message,
        )
          ? "RESPONSE_BODY_RESOURCE_UNAVAILABLE"
          : "RESPONSE_BODY_READ_FAILED",
    };
  }
}
async function responseObserverScenarios() {
  for (const mode of [
    "after-click",
    "early-then",
    "native-clone-binding",
  ] as const) {
    for (let iteration = 0; iteration < 5; iteration++) {
      const raw = createConsumerToken("access-key"),
        page = await newPage(false, undefined, undefined, true);
      await input(page, raw);
      expectedKey = raw;
      success = true;
      const beforePosts = posts,
        beforeDestinations = destinations;
      const observer =
        mode === "native-clone-binding"
          ? await observeNextConsumerExchange(page)
          : null;
      if (observer && iteration === 0) {
        let notified = false;
        void observer.observation.then(() => {
          notified = true;
        });
        const methodStatus = await page.evaluate(
          async () =>
            (await fetch("/access/exchange", { method: "GET" })).status,
        );
        expect(methodStatus === 405 && !notified).toBe(true);
      }
      const pending = page.waitForResponse(
        (r) =>
          r.url() === origin + "/access/exchange" &&
          r.request().method() === "POST",
      );
      // Early strategy starts reading at response notification, before click/navigation returns.
      const early =
        mode === "early-then" ? pending.then(readExchangeResponse) : null;
      permitManualPost();
      await verifyButton(page).click();
      const response = await pending;
      expect(response.status()).toBe(200);
      const cloned = observer ? await observer.observation : null;
      const observed = cloned
        ? {
            status: cloned.status,
            bodyRead: cloned.ok,
            schemaMatched:
              cloned.ok &&
              cloned.result.session.sessionId ===
                exchangeResult.session.sessionId,
            failureType: null,
            failureCode: cloned.ok ? null : cloned.code,
          }
        : early
          ? await early
          : await readExchangeResponse(response);
      if (observer) {
        expect(cloned?.ok).toBe(true);
        await observer.dispose();
      }
      await page.waitForURL(
        (url) =>
          url.pathname === "/play/" + exchangeResult.session.sessionId &&
          !url.search &&
          !url.hash,
      );
      expect(
        posts === beforePosts + 1 && destinations === beforeDestinations + 1,
      ).toBe(true);
      record("exchange-response-" + mode, {
        iteration,
        ...observed,
        transport: observer
          ? "one-native-fetch-original-response-clone-observed"
          : "unmodified-native-fetch",
        posts: 1,
        destinations: 1,
      });
      await page.close();
    }
  }
  for (const negative of ["http-503", "malformed", "oversized"] as const) {
    const page = await newPage(false, undefined, undefined, true),
      raw = createConsumerToken("access-key");
    await input(page, raw);
    expectedKey = raw;
    success = negative !== "http-503";
    responseContent = negative === "http-503" ? "valid" : negative;
    await page.evaluate(() => {
      Reflect.set(
        window.accessLifecycleProbe,
        "originalFetch",
        globalThis.fetch,
      );
    });
    const observer = await observeNextConsumerExchange(page),
      beforePosts = posts,
      beforeDestinations = destinations;
    permitManualPost();
    await verifyButton(page).click();
    const observed = await observer.observation;
    expect(
      !observed.ok &&
        observed.code ===
          (negative === "http-503"
            ? "EXCHANGE_HTTP_FAILURE"
            : negative === "malformed"
              ? "EXCHANGE_BODY_INVALID"
              : "EXCHANGE_BODY_UNAVAILABLE"),
    ).toBe(true);
    await expect(page.getByText(unavailable, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          globalThis.fetch ===
          Reflect.get(window.accessLifecycleProbe, "originalFetch"),
      ),
    ).toBe(true);
    await observer.dispose();
    expect(
      await page.evaluate(
        () =>
          Object.getOwnPropertyNames(globalThis).filter((key) =>
            key.startsWith("__qfExchangeObservation_"),
          ).length,
      ),
    ).toBe(0);
    expect(
      posts === beforePosts + 1 && destinations === beforeDestinations,
    ).toBe(true);
    record("exchange-observer-negative-" + negative, {
      status: observed.status,
      ok: observed.ok,
      code: observed.ok ? null : observed.code,
      originalFetchRestored: true,
      documentBindingsRemoved: true,
      posts: 1,
      destinations: 0,
    });
    await page.close();
    responseContent = "valid";
  }
  {
    const page = await newPage(false, undefined, undefined, true),
      before = posts;
    await page.evaluate(() => {
      Reflect.set(
        window.accessLifecycleProbe,
        "originalFetch",
        globalThis.fetch,
      );
    });
    const observer = await observeNextConsumerExchange(page);
    await observer.dispose();
    const observed = await observer.observation;
    expect(
      !observed.ok &&
        observed.code === "EXCHANGE_OBSERVER_UNAVAILABLE" &&
        posts === before,
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          globalThis.fetch ===
            Reflect.get(window.accessLifecycleProbe, "originalFetch") &&
          !Object.getOwnPropertyNames(globalThis).some((key) =>
            key.startsWith("__qfExchangeObservation_"),
          ),
      ),
    ).toBe(true);
    record("exchange-observer-unused-dispose", {
      originalFetchRestored: true,
      documentBindingsRemoved: true,
      posts: 0,
    });
    await page.close();
  }
  const extra = await proveExchangeObserverTransport({
    newPage: () => newPage(false, undefined, undefined, true),
    ready: input,
    permit(raw, content) {
      expectedKey = raw;
      success = true;
      responseContent = content;
      permitManualPost();
    },
    posts: () => posts,
  });
  (facts.cases as unknown[]).push(
    ...extra.map((proof) => ({ ...proof, passed: true })),
  );
  responseContent = "valid";
}
async function lifecycleScenarios() {
  for (const strict of [false, true]) {
    const first = createConsumerToken("access-key"),
      last = createConsumerToken("access-key"),
      before = posts;
    const page = await newPage(strict, undefined, { first, last });
    await expect(verifyButton(page)).toBeEnabled();
    await clean(page);
    expect(posts).toBe(before);
    await manualFailure(page, last);
    record(
      strict
        ? "SSR-StrictMode-queued-native-events-before-hydration"
        : "SSR-production-queued-native-events-before-hydration",
    );
    await page.close();
  }
  for (const strict of [false, true]) {
    const raw = createConsumerToken("access-key"),
      before = posts,
      page = await newPage(strict, raw);
    await expect(verifyButton(page)).toBeEnabled();
    await clean(page);
    expect(posts).toBe(before);
    await manualFailure(page, raw);
    record(
      strict
        ? "SSR-StrictMode-initial-valid-fragment"
        : "SSR-production-initial-valid-fragment",
    );
    await page.close();
  }
  for (const strict of [false, true]) {
    const page = await newPage(strict),
      raw = createConsumerToken("access-key"),
      count = posts;
    await input(page, raw);
    expect(posts).toBe(count);
    await manualFailure(page, raw);
    record(
      strict ? "SSR-dev-StrictMode-empty-to-B" : "SSR-production-empty-to-B",
    );
    const b = createConsumerToken("access-key");
    await input(page, b);
    await manualFailure(page, b);
    record(strict ? "StrictMode-ready-A-to-B-only-B" : "ready-A-to-B-only-B");
    if (strict)
      expect(
        await page.evaluate(() => window.accessLifecycleProbe.erasures),
      ).toBeGreaterThanOrEqual(2);
    await page.close();
  }
  for (const invalid of ["malformed", "duplicate", "empty", "query"]) {
    const page = await newPage(),
      raw = createConsumerToken("access-key");
    await input(page, raw);
    const before = posts;
    await page.evaluate(
      ({ raw, invalid }) => {
        if (invalid === "empty") {
          history.pushState(null, "", location.pathname + "#");
          document.querySelector<HTMLButtonElement>("button")!.click();
        } else if (invalid === "query") {
          history.replaceState(
            null,
            "",
            location.pathname + "?source=synthetic",
          );
          location.hash = "key=" + raw;
        } else
          location.hash =
            invalid === "duplicate"
              ? "key=" + raw + "&key=" + raw
              : invalid === "empty"
                ? "#"
                : "key=bad";
      },
      { raw, invalid },
    );
    await expect(verifyButton(page)).toHaveCount(0);
    await clean(page);
    expect(posts).toBe(before);
    record("invalid-clears-A-" + invalid);
    await page.close();
  }
  {
    const page = await newPage(),
      raw = createConsumerToken("access-key");
    await input(page, raw);
    const before = posts;
    await page.evaluate(() => {
      history.back();
    });
    await expect(verifyButton(page)).toHaveCount(0);
    await clean(page);
    expect(posts).toBe(before);
    record("native-history-traversal-to-clean-invalidates-Key");
    await page.close();
  }
  {
    const page = await newPage(),
      a = createConsumerToken("access-key"),
      c = createConsumerToken("access-key");
    await input(page, a);
    const before = posts;
    await page.evaluate(
      ({ a, c }) => {
        location.hash = "key=" + a;
        location.hash = "";
        location.hash = "key=" + c;
      },
      { a, c },
    );
    await expect(verifyButton(page)).toBeEnabled();
    await clean(page);
    expect(posts).toBe(before);
    await manualFailure(page, c);
    record("native-rapid-B-empty-C");
    await page.close();
  }
  for (const roundTrip of [false, true]) {
    const page = await newPage(),
      a = createConsumerToken("access-key"),
      b = createConsumerToken("access-key");
    await input(page, a);
    await page.evaluate(() => {
      window.accessLifecycleProbe.hold = true;
    });
    expectedKey = a;
    success = true;
    permitManualPost();
    await verifyButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.accessLifecycleProbe.held))
      .toBe(1);
    const beforeDestinations = destinations;
    await page.evaluate(
      ({ b, roundTrip }) => {
        const p = window.accessLifecycleProbe;
        p.events.length = 0;
        p.events.push("before-B");
        location.hash = "key=" + b;
        p.events.push("after-B");
        if (roundTrip) {
          location.hash = "";
          p.events.push("after-clean");
        }
        p.release(0);
        queueMicrotask(() => p.events.push("release-microtask"));
      },
      { b, roundTrip },
    );
    await expect
      .poll(() => page.evaluate(() => window.accessLifecycleProbe.aborted))
      .toBe(1);
    await expect(verifyButton(page)).toBeEnabled();
    await clean(page);
    expect(destinations).toBe(beforeDestinations);
    const order = await page.evaluate(() => window.accessLifecycleProbe.events);
    expect(
      order.indexOf("popstate") < order.indexOf("after-B") &&
        order.indexOf("release-microtask") < order.indexOf("hashchange"),
    ).toBe(true);
    await page.evaluate(() => {
      window.accessLifecycleProbe.hold = false;
    });
    await manualFailure(page, b);
    record(
      roundTrip
        ? "native-inflight-A-B-clean-before-hashchange"
        : "native-inflight-A-B-before-hashchange",
      { nativeEventCategories: order, oldDestinations: 0 },
    );
    await page.close();
  }
  {
    const page = await newPage(),
      a = createConsumerToken("access-key"),
      b = createConsumerToken("access-key");
    await input(page, a);
    await page.evaluate(() => {
      window.accessLifecycleProbe.hold = true;
    });
    expectedKey = a;
    success = true;
    permitManualPost();
    await verifyButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.accessLifecycleProbe.held))
      .toBe(1);
    const beforeDestinations = destinations;
    await page.evaluate((b) => {
      history.replaceState(null, "", location.pathname + "#key=" + b);
      window.accessLifecycleProbe.release(0);
    }, b);
    await expect(verifyButton(page)).toBeEnabled();
    await clean(page);
    expect(destinations).toBe(beforeDestinations);
    await page.evaluate(() => {
      window.accessLifecycleProbe.hold = false;
    });
    await manualFailure(page, b);
    record("actual-address-guard-native-replaceState-no-event");
    await page.close();
  }
  {
    const page = await newPage(),
      a = createConsumerToken("access-key"),
      b = createConsumerToken("access-key");
    await input(page, a);
    await page.evaluate(() => {
      window.accessLifecycleProbe.hold = true;
    });
    expectedKey = a;
    success = true;
    permitManualPost();
    await verifyButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.accessLifecycleProbe.held))
      .toBe(1);
    await input(page, b);
    expectedKey = b;
    permitManualPost();
    await verifyButton(page).click();
    await expect
      .poll(() => page.evaluate(() => window.accessLifecycleProbe.held))
      .toBe(2);
    await page.evaluate(() => window.accessLifecycleProbe.release(0, true));
    await expect(
      page.getByRole("button", { name: "正在验证", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => window.accessLifecycleProbe.release(1));
    await expect
      .poll(
        () =>
          new URL(page.url()).pathname ===
          "/play/00000000-0000-4000-8000-000000000021",
      )
      .toBe(true);
    record("old-catch-finally-preserves-new-busy-attempt");
    await page.close();
  }
  for (const fail of ["throw", "noop"] as const) {
    const page = await newPage();
    await input(page, createConsumerToken("access-key"));
    const before = posts;
    await page.evaluate(
      ({ raw, fail }) => {
        window.accessLifecycleProbe.failErase = fail;
        location.hash = "key=" + raw;
      },
      { raw: createConsumerToken("access-key"), fail },
    );
    await expect(verifyButton(page)).toHaveCount(0);
    await expect(
      page.getByText("暂时无法安全读取私密链接。请重新打开原私密链接。", {
        exact: true,
      }),
    ).toBeVisible();
    expect(posts).toBe(before);
    // The platform is intentionally unable to erase; never screenshot/serialize that URL.
    expect(
      await page.evaluate(
        () =>
          !/qf[kg]_p4_/.test(document.documentElement.outerHTML) &&
          ![
            ...Object.values(localStorage),
            ...Object.values(sessionStorage),
          ].some((v) => /qf[kg]_p4_/.test(v)),
      ),
    ).toBe(true);
    record("erasure-" + fail + "-closed");
    await page.close();
  }
  {
    const page = await newPage();
    await input(page, createConsumerToken("access-key"));
    const screenshots: string[] = [];
    for (const width of [320, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      await clean(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const filename = `ready-${width}.png`;
      await page.screenshot({ path: path.join(out, filename), fullPage: true });
      screenshots.push(filename);
    }
    facts.screenshots = screenshots;
    facts.screenshotViewports = [320, 375, 390, 430];
    await page.close();
  }
}
try {
  if (process.argv.includes("--response-observer-only"))
    await responseObserverScenarios();
  else await lifecycleScenarios();
  expect(pageErrors).toBe(0);
  expect(hydrationErrors).toBe(0);
  expect(httpLeak).toBe(false);
  expect(bodiesMatch).toBe(true);
  facts.browser = await browser.version();
  facts.pageErrors = pageErrors;
  facts.hydrationErrors = hydrationErrors;
  facts.httpLeak = httpLeak;
  facts.allManualBodiesMatched = bodiesMatch;
  expect(automaticPost).toBe(false);
  expect(posts).toBe(plannedManualPosts);
  expect(permittedPosts).toBe(0);
  facts.automaticPost = automaticPost;
  facts.totalExplicitPosts = posts;
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
