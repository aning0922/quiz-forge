import { createServer, request as httpRequest } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { NextRequest } from "next/server";
import { consumerRouteFetch } from "../e2e/consumer-flow.network";
import { assertConsumerSource } from "@/features/fulfillment/consumer-flow/http/security";

// Real Chromium interception vs actual server source guard; synthetic credential
// markers only, ephemeral loopback port, no DB/Next server/root3100.
const out = path.resolve(".cache/p4-consumer-interception", String(Date.now()));
await mkdir(out, { recursive: true });
const fixedPort = process.argv.includes("--fixed-3100");
const expectAccepted = process.argv.includes("--expect-native-accepted");
const apiPath = "/api/studio/products/consumer-flow-fixture/access-keys";
const cookie = "synthetic-private-cookie",
  csrf = "A".repeat(43);
let origin = "";
const facts: Record<string, unknown> = {
  qualification:
    "real Chromium interception and actual NextRequest source guard, synthetic only; no DB/Next server; fixed 3100 requires explicit flag and root ownership",
};
const server = createServer(async (req, res) => {
  if (req.url === apiPath) {
    const request = new NextRequest(origin + req.url, {
      method: "POST",
      headers: new Headers(
        Object.entries(req.headers).flatMap<[string, string]>(([k, v]) =>
          v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v]],
        ),
      ),
      body: "{}",
    });
    let status = 200,
      code = "OK";
    try {
      assertConsumerSource(
        request,
        { profile: "local-http-p2a", origin },
        { post: true },
      );
      if (
        req.headers.cookie !== "synthetic=" + cookie ||
        req.headers["x-csrf-token"] !== csrf
      ) {
        status = 401;
        code = "ACCESS_DENIED";
      }
    } catch (e) {
      status = 403;
      code =
        e instanceof Error && e.message === "SOURCE_REJECTED"
          ? "SOURCE_REJECTED"
          : "FINITE_GUARD_ERROR";
    }
    req.resume();
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ code }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(
    "<!doctype html><html><title>Synthetic interception</title><body>Controlled transport probe</body></html>",
  );
});
await new Promise<void>((r) =>
  server.listen(fixedPort ? 3100 : 0, "127.0.0.1", r),
);
const address = server.address();
if (
  !address ||
  typeof address === "string" ||
  (!fixedPort && address.port === 3100) ||
  (fixedPort && address.port !== 3100)
)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
origin = `http://127.0.0.1:${address.port}`;
async function forward(
  headers: Record<string, string>,
  body: Buffer | undefined,
) {
  return new Promise<{ status: number; code: string }>((resolve, reject) => {
    const clean = { ...headers, "accept-encoding": "identity" };
    for (const k of ["content-length", "connection", "transfer-encoding"])
      delete (clean as Record<string, string>)[k];
    const req = httpRequest(
      origin + apiPath,
      {
        method: "POST",
        headers: clean,
        agent: false,
        signal: AbortSignal.timeout(5000),
      },
      (res) => {
        const parts: Buffer[] = [];
        res.on("data", (p) => parts.push(Buffer.from(p)));
        res.on("end", () => {
          const body = JSON.parse(Buffer.concat(parts).toString()) as {
            code: string;
          };
          resolve({
            status: res.statusCode ?? 0,
            code: ["OK", "SOURCE_REJECTED", "ACCESS_DENIED"].includes(body.code)
              ? body.code
              : "other",
          });
        });
        res.on("error", () => reject(Error("SYNTHETIC_RESPONSE_UNAVAILABLE")));
      },
    );
    req.on("error", () => reject(Error("SYNTHETIC_FORWARD_UNAVAILABLE")));
    req.end(body);
  });
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "synthetic",
      value: cookie,
      url: origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(origin);
  await page.route("**" + apiPath, async (route) => {
    const request = route.request(),
      headers = await request.allHeaders(),
      frame = request.frame();
    facts.intercepted = {
      methodPost: request.method() === "POST",
      resourceFetch: request.resourceType() === "fetch",
      navigation: request.isNavigationRequest(),
      requestOriginMatches: new URL(request.url()).origin === origin,
      frameIsMain: frame === page.mainFrame(),
      frameOriginMatches: new URL(frame.url()).origin === origin,
      pageOriginMatches: new URL(page.url()).origin === origin,
      principalOriginMatches:
        (await frame.evaluate(() => location.origin)) === origin,
      headers: {
        hostPresent: headers.host !== undefined,
        hostMatches: headers.host === new URL(origin).host,
        originPresent: headers.origin !== undefined,
        originMatches: headers.origin === origin,
        sitePresent: headers["sec-fetch-site"] !== undefined,
        siteMatches: headers["sec-fetch-site"] === "same-origin",
        cookiePresent: headers.cookie !== undefined,
        cookieMatches: headers.cookie === "synthetic=" + cookie,
        csrfPresent: headers["x-csrf-token"] !== undefined,
        csrfMatches: headers["x-csrf-token"] === csrf,
      },
    };
    if (fixedPort) {
      const actual = await consumerRouteFetch(route, page);
      const value = (await actual.json()) as { code?: unknown };
      facts.originalNative = {
        status: actual.status(),
        code:
          typeof value.code === "string" &&
          ["OK", "SOURCE_REJECTED", "ACCESS_DENIED"].includes(value.code)
            ? value.code
            : "other",
      };
    } else
      facts.originalNative = await forward(
        headers,
        request.postDataBuffer() ?? undefined,
      );
    expect(facts.originalNative).toEqual(
      expectAccepted
        ? { status: 200, code: "OK" }
        : { status: 403, code: "SOURCE_REJECTED" },
    );
    await route.continue();
  });
  const actual = await page.evaluate(
    async ({ csrf, apiPath }) => {
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        credentials: "same-origin",
        mode: "same-origin",
        signal: AbortSignal.timeout(25_000),
        body: JSON.stringify({ synthetic: true }),
      });
      const value = (await response.json()) as { code: string };
      return {
        status: response.status,
        code: ["OK", "SOURCE_REJECTED", "ACCESS_DENIED"].includes(value.code)
          ? value.code
          : "other",
      };
    },
    { csrf, apiPath },
  );
  facts.browserContinued = actual;
  expect(actual).toEqual({ status: 200, code: "OK" });
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
console.log(JSON.stringify({ out, facts }));
