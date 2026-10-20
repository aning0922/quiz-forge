import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { consumerHostFixtureV1 } from "@/features/theme/consumer-v1/host.test-support";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import type { ConsumerControllerV1 } from "@/features/theme/consumer-v1/controller";
import type { ConsumerSessionView } from "@/features/fulfillment/consumer-flow/contracts";
const f = await consumerHostFixtureV1(),
  report = await persistedReportFixture();
const out = path.resolve(".cache/p4-consumer-deadlines", String(Date.now()));
await mkdir(out, { recursive: true });
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
const bundle = await require("esbuild").build({
  stdin: {
    contents:
      "import{ConsumerControllerV1}from './src/features/theme/consumer-v1/controller';window.Controller=ConsumerControllerV1;",
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  write: false,
  logLevel: "silent",
});
const server = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<!doctype html><title>Synthetic timer boundary</title><script>" +
      bundle.outputFiles[0].text +
      "</script>",
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript("window.__name=(v)=>v");
  await page.goto(`http://127.0.0.1:${address.port}`);
  const cases = await page.evaluate(
    async ({ f, report }) => {
      const result: {
        label: string;
        initial: string;
        after: string;
        posts: number;
        taskCurrent: boolean;
      }[] = [];
      const Controller = (
        window as Window & { Controller?: typeof ConsumerControllerV1 }
      ).Controller!;
      async function run(
        label: string,
        view: ConsumerSessionView,
        wait: number,
      ) {
        let posts = 0;
        const fetcher: typeof fetch = async (url, options) => {
          if (options?.method === "POST") posts++;
          const data = String(url).endsWith("session")
            ? view
            : String(url).endsWith("report")
              ? { receipt: report.receipt, view: report.view }
              : f.entry;
          return new Response(JSON.stringify(data), {
            headers: { "content-type": "application/json" },
          });
        };
        const controller = new Controller(
          f.session.sessionId,
          sessionStorage,
          fetcher,
        );
        try {
          await controller.bootstrap();
          const initial = controller.getSnapshot().phase;
          await new Promise<void>((r) => setTimeout(r, wait));
          result.push({
            label,
            initial,
            after: controller.getSnapshot().phase,
            posts,
            taskCurrent: controller.task()?.current() ?? false,
          });
        } finally {
          controller.dispose();
        }
      }
      for (const days of [1, 7, 24, 25, 30]) {
        const view = structuredClone(f.view);
        view.keyExpiresAt = new Date(
          Date.parse(view.observedAt) + days * 86400000,
        ).toISOString();
        await run(`${days}-days`, view, 30);
      }
      const short = structuredClone(f.view);
      short.keyExpiresAt = new Date(
        Date.parse(short.observedAt) + 800,
      ).toISOString();
      await run("short-expiry", short, 900);
      const completed: ConsumerSessionView = {
        ...f.view,
        keyExpiresAt: "2026-10-17T00:00:00.000Z",
        outcome: { kind: "completed", report: report.receipt },
      };
      await run("completed-expired-key", completed, 30);
      return result;
    },
    { f, report },
  );
  for (const c of cases.slice(0, 5))
    expect(c).toMatchObject({
      initial: "active",
      after: "active",
      posts: 0,
      taskCurrent: true,
    });
  expect(cases[5]).toMatchObject({
    initial: "active",
    after: "expired",
    posts: 0,
    taskCurrent: true,
  });
  expect(cases[6]).toMatchObject({
    initial: "completed",
    after: "completed",
    posts: 0,
    taskCurrent: true,
  });
  const result = {
    browser: await browser.version(),
    scope:
      "actual browser timers + strict synthetic facts; no DB/business owner/native/3100",
    cases,
  };
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ out, ...result }));
} finally {
  await browser?.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
}
