import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { consumerSessionFixtureV2 } from "@/features/theme/consumer-v2/session.test-support";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";

const out = path.resolve(
  process.env.QZTX_CAPTURE_TARGET === "restore"
    ? ".cache/qztx-d3/restore"
    : process.env.QZTX_CAPTURE_TARGET === "reading"
      ? ".cache/qztx-d3/reading"
      : process.env.QZTX_CAPTURE_TARGET === "finish"
        ? ".cache/qztx-d3/finish"
        : process.env.QZTX_MOTION_STUDY === "1"
          ? ".cache/qztx-d3/motion-study"
          : ".cache/qztx-d3/browser",
);
await mkdir(out, { recursive: true });
const session = await consumerSessionFixtureV2(),
  fixture = structuredReaderFixtureV2();
session.entry.facts.entry = fixture.model.entry!;
const scope = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(scope);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        key === "productId" ? session.session.productId : scope(child),
      ]),
    );
  return value;
};
session.entry.facts.entry = scope(
  session.entry.facts.entry,
) as typeof session.entry.facts.entry;
session.entry.facts.entry.presentationMode = "authored-product";
session.entry.facts.entry.questions.forEach((q) =>
  q.options.forEach((o, i) => {
    o.label = `合成选项 ${i + 1}：这是一段用于窄屏验证的较长情境选择，文字需要完整换行而不截断。`;
  }),
);
session.entry.factsSha256 = await consumerEntryFactsSha256V2(
  session.entry.facts,
);
fixture.completed.report!.view.display.presentationMode = "authored-product";
const body = fixture.completed.report!.view.display.body;
body.matching.selected.label = "合成人物";
body.matching.selected.narrativeIndex = 37;
body.dimensions = [23, 74, 51, 80, 37].map((score, i) => ({
  ...body.dimensions[0]!,
  dimensionRef: { ...body.dimensions[0]!.dimensionRef, id: `axis-${i}` },
  label: ["守心", "寻远", "知情", "决断", "应变"][i]!,
  score,
}));
body.volumes.forEach((v, i) => {
  v.title = `合成卷${i + 1}`;
  v.paragraphs[0]!.text =
    `合成正文${i + 1}：本段仅用于验证完整长文阅读、目录与证据容器，不是作者正式文案。`.repeat(
      12,
    );
});
const fromTsx = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await fromTsx("esbuild").build({
  entryPoints: [
    path.resolve("src/features/theme/qianzai-tongxin/browser.test-support.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  platform: "browser",
  external: ["/assets/*"],
  format: "iife",
  jsx: "automatic",
  loader: { ".css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  logLevel: "silent",
  plugins: [
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
              'export const types = new Proxy({}, { get() { throw Error("UNEXPECTED_NODE_POLICY_IN_UI_PROBE"); } });',
            loader: "js",
          }),
        );
      },
    },
  ],
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
files.set("/assets/fonts/qianzai-v1/serif-600.woff2", {
  body: await readFile("public/assets/fonts/qianzai-v1/serif-600.woff2"),
  type: "font/woff2",
});
if (process.env.QZTX_MOTION_STUDY === "1") {
  const inventoryPath = process.env.QZTX_RESOURCE_INVENTORY;
  if (!inventoryPath || !path.isAbsolute(inventoryPath))
    throw Error("EXPLICIT_PRIVATE_INVENTORY_PATH_REQUIRED");
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  const image = inventory.images.find(
    (v: { image_id: string }) => v.image_id === "image-fc0fb75e94f080cc",
  );
  files.set("/private-v8-reference", {
    body: await readFile(image.copy),
    type: "image/webp",
  });
}
const server = createServer((req, res) => {
  const file = files.get(req.url ?? "");
  if (file) {
    res.writeHead(200, { "content-type": file.type });
    res.end(file.body);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/probe.css"><style>body{margin:0}button,input{font:inherit}</style><div id="root"></div><script id="fixture" type="application/json">' +
      JSON.stringify({ session, completed: fixture.completed }).replaceAll(
        "<",
        "\\u003c",
      ) +
      '</script><script src="/probe.js"></script></html>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const address = server.address();
if (!address || typeof address === "string" || address.port === 3100)
  throw Error("OWN_EPHEMERAL_PORT_REQUIRED");
const origin = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch({ headless: true });
const facts: Record<string, unknown> = {
  scope:
    "actual D3 React and v2 controller; synthetic HTTP/prose, no DB/Next/registry/real resource admission",
  browser: await browser.version(),
  screenshots: [],
};
const continuing = process.env.QZTX_CAPTURE_CONTINUE === "1";
if (continuing) {
  const previous = JSON.parse(
    await readFile(path.join(out, "result.json"), "utf8"),
  );
  await writeFile(
    path.join(out, `result.failed-${Date.now()}.json`),
    JSON.stringify(previous, null, 2),
  );
  facts.screenshots = previous.screenshots;
  facts.continuation =
    "reuse first five completed geometry/capture checks; fix fieldset matcher, then continue serial-save and remaining views";
}
const errors: string[] = [];
async function check(page: Page, name: string, width: number) {
  if (
    continuing &&
    ["cover-neutral", "preference-neutral", "question-long"].includes(name)
  )
    return;
  await page.setViewportSize({ width, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const sizes = await page.locator("button:visible").evaluateAll((nodes) =>
    nodes.map((n) => ({
      text: n.textContent,
      width: n.getBoundingClientRect().width,
      height: n.getBoundingClientRect().height,
    })),
  );
  expect(sizes.every((s) => s.width >= 44 && s.height >= 44)).toBe(true);
  await page.screenshot({
    path: path.join(out, `${name}-${width}.png`),
    fullPage: true,
  });
  (facts.screenshots as unknown[]).push({
    name,
    width,
    height: 900,
    noHorizontalOverflow: true,
    minimumTarget44: true,
  });
}
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.QZTX_MOTION_STUDY === "1") {
    await page.goto(origin + "/?motion-study");
    const water = page.locator("[data-qianzai-water]"),
      petals = page.locator("[data-qianzai-petals]");
    await expect
      .poll(async () => Number(await water.getAttribute("data-water-frames")))
      .toBeGreaterThan(2);
    await expect
      .poll(async () => Number(await petals.getAttribute("data-petal-frames")))
      .toBeGreaterThan(2);
    await expect
      .poll(() =>
        page
          .locator("img")
          .evaluate(
            (image) =>
              image.getAnimations().length > 0 &&
              image
                .getAnimations()
                .every((animation) => animation.playState === "finished"),
          ),
      )
      .toBe(true);
    await page.screenshot({
      path: path.join(out, "v8-private-motion-study-390.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "暂停动效", exact: true }).click();
    const frames = [
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ];
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    expect([
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ]).toEqual(frames);
    await page.getByRole("button", { name: "继续动效", exact: true }).click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(water).toBeHidden();
    await expect(petals).toBeHidden();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("[data-motion]")).toHaveAttribute(
      "data-motion",
      "paused",
    );
    const hidden = [
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ];
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    expect([
      await water.getAttribute("data-water-frames"),
      await petals.getAttribute("data-petal-frames"),
    ]).toEqual(hidden);
    facts.v8MotionStudy = {
      source: "private unchanged V8 bitmap read via inventory",
      waterAndPetalsRan: true,
      manualPauseSuspendedFrames: true,
      reducedMotionHidden: true,
      simulatedVisibilitySuspendedFrames: true,
      resourceAdmission: false,
    };
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
    // Study is separate from prior synthetic UI/controller checks; do not repeat them.
  } else if (process.env.QZTX_CAPTURE_TARGET === "restore") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]"),
      question = page.locator('[data-qianzai-screen="question"]');
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(page.locator('[data-qianzai-screen="cover"]')).toBeVisible();
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(question).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.evaluate(() =>
      (
        window as unknown as {
          qianzaiProbe: {
            owner: { onEvent(e: { type: "navigate"; questionId: null }): void };
          };
        }
      ).qianzaiProbe.owner.onEvent({ type: "navigate", questionId: null }),
    );
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.reload();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(question).toBeVisible();
    await expect(
      question.getByText(
        "合成情境 1：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            qianzaiProbe: { calls: { path: string; method: string }[] };
          }
        ).qianzaiProbe.calls.some((c) => c.method === "POST"),
      ),
    ).toBe(false);
    await question.locator("label").first().click();
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await page.reload();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(question).toBeVisible();
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { qianzaiProbe: { calls: { method: string }[] } }
        ).qianzaiProbe.calls.some((c) => c.method === "POST"),
      ),
    ).toBe(false);
    facts.refreshResume = {
      freshCover: true,
      savedPreferenceZeroAnswersFirstQuestion: true,
      savedQuestionRestored: true,
      resumePosts: 0,
      server:
        "synthetic persisted response fixture; actual controller verification, no DB",
    };
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "reading") {
    await page.goto(origin);
    await expect(page.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.load(
        '600 16px "QuizForge Qianzai Serif"',
        "千载同心木兰",
      );
      await document.fonts.ready;
    });
    await report.getByRole("img").scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        Number(
          await report
            .getByRole("progressbar", { name: "长卷阅读进度" })
            .getAttribute("aria-valuenow"),
        ),
      )
      .toBeGreaterThan(0);
    await check(page, "five-axes-reading-position", 320);
    facts.readingPosition = await report
      .getByRole("progressbar", { name: "长卷阅读进度" })
      .getAttribute("aria-valuenow");
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  } else if (process.env.QZTX_CAPTURE_TARGET === "finish") {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    expect(
      await page.evaluate(async () => {
        await document.fonts.load(
          '600 16px "QuizForge Qianzai Serif"',
          "千载同心木兰",
        );
        await document.fonts.ready;
        return document.fonts.check(
          '600 16px "QuizForge Qianzai Serif"',
          "千载同心木兰",
        );
      }),
    ).toBe(true);
    await expect(
      page.locator('[data-qianzai-screen="cover"] svg'),
    ).toHaveAttribute("aria-hidden", "true");
    await check(page, "cover-program-arrow-fixed-font", 390);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await check(page, "long-question-fixed-font", 320);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    const radar = report.getByRole("img");
    await radar.scrollIntoViewIfNeeded();
    await expect(radar).toHaveAccessibleName(/守心 23分/);
    await check(page, "five-axes-fixed-font", 320);
    await report.getByRole("button", { name: "相逢", exact: true }).click();
    await expect(
      page.locator('[data-qianzai-screen="result"] svg'),
    ).toHaveAttribute("aria-hidden", "true");
    await check(page, "reveal-program-arrow-fixed-font", 390);
    facts.font = {
      family: "QuizForge Qianzai Serif",
      weight: 600,
      loaded: true,
      bitmapAdmission: false,
    };
    await page.close();
    const revoke = await browser.newPage({
      viewport: { width: 390, height: 900 },
    });
    await revoke.addInitScript(() => localStorage.clear());
    revoke.on("pageerror", (e) => errors.push(e.message));
    await revoke.goto(origin);
    await expect(revoke.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await revoke
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await revoke
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      revoke.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(revoke.locator("[data-qianzai-experience]")).toHaveAttribute(
      "data-view-phase",
      "ready",
    );
    await revoke.clock.install();
    const before = await revoke.evaluate(
      () =>
        (
          window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
        ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
    );
    await revoke
      .locator('[data-qianzai-screen="question"] label')
      .first()
      .click();
    await revoke.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { owner: { revoke(): void } } }
      ).qianzaiProbe.owner.revoke(),
    );
    await expect(
      revoke.getByRole("heading", { name: "本次访问已结束", exact: true }),
    ).toBeVisible();
    await revoke.clock.runFor(500);
    expect(
      await revoke.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
      ),
    ).toBe(before);
    facts.revokedFeedback = {
      controlledClockMs: 500,
      delayedSaveNotSent: true,
      consumerContentRemoved: true,
    };
    await revoke.close();
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
  } else {
    await page.goto(origin);
    const host = page.locator("[data-qianzai-experience]");
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await check(page, "cover-neutral", 390);
    await page
      .getByRole("button", { name: "开启穿越之旅", exact: true })
      .click();
    await check(page, "preference-neutral", 390);
    await page
      .locator('[data-qianzai-screen="preference"] label')
      .nth(2)
      .click();
    await expect(
      page.locator('[data-qianzai-screen="question"]'),
    ).toBeVisible();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    const question = page.locator('[data-qianzai-screen="question"]');
    for (const width of [320, 375, 430])
      await check(page, "question-long", width);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { holdNext(): void } }
      ).qianzaiProbe.holdNext(),
    );
    await question.locator("label").first().click();
    await expect(host).toHaveAttribute("data-view-phase", "saving");
    await expect(question.locator("fieldset")).toHaveAttribute("disabled", "");
    await expect(question.getByRole("radio").first()).toBeDisabled();
    await expect(
      question.getByText(
        "合成情境 1：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { release(): void } }
      ).qianzaiProbe.release(),
    );
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { dropNext(): void } }
      ).qianzaiProbe.dropNext(),
    );
    await question.locator("label").first().click();
    await expect(host).toHaveAttribute("data-view-phase", "unknown");
    const before = await page.evaluate(() => {
      const p = (
        window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
      ).qianzaiProbe;
      return {
        posts: p.calls.filter((c) => c.path.endsWith("save")).length,
        storage: JSON.stringify(sessionStorage),
      };
    });
    await check(page, "unknown-preserved", 390);
    await page
      .getByRole("button", { name: "核对保存结果", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "conflict");
    await expect(
      question.getByText(
        "合成情境 2：这段文字用于结构阅读，不是作者正式题目。",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "采用已核对的服务器进度", exact: true })
      .click();
    await expect(host).toHaveAttribute("data-view-phase", "ready");
    await expect(
      question.getByText(
        "合成情境 3：这段文字用于结构阅读，不是作者正式题目。",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (
            window as unknown as { qianzaiProbe: { calls: { path: string }[] } }
          ).qianzaiProbe.calls.filter((c) => c.path.endsWith("save")).length,
      ),
    ).toBe(before.posts);
    facts.serialSave = {
      heldReceiptDidNotAdvance: true,
      lostAckRecoveredOriginal: true,
      noResend: true,
      storageWasPreserved: before.storage.length > 2,
    };
    // Cross-act routing uses actual act fields and controller save, not old Q4/Q8 demo indices.
    await page.getByRole("button", { name: "旅程", exact: true }).click();
    await page
      .locator('[data-qianzai-screen="resume"] li')
      .nth(8)
      .getByRole("button")
      .click();
    await expect(
      question.getByRole("heading", { name: "命运抉择", exact: true }),
    ).toBeVisible();
    await check(page, "act-two-neutral", 390);
    await page.getByRole("button", { name: "旅程", exact: true }).click();
    await page
      .locator('[data-qianzai-screen="resume"] li')
      .nth(16)
      .getByRole("button")
      .click();
    await expect(
      question.getByRole("heading", { name: "归于何处", exact: true }),
    ).toBeVisible();
    await check(page, "act-three-neutral", 390);
    await page.evaluate(() =>
      (
        window as unknown as { qianzaiProbe: { completed(): void } }
      ).qianzaiProbe.completed(),
    );
    const report = page.locator('[data-qianzai-screen="report"]');
    await expect(report).toBeVisible();
    for (const width of [320, 390, 1024])
      await check(page, "sealed-synthetic-report", width);
    await report.locator("details").first().locator("summary").click();
    await report
      .getByRole("link", { name: "卷六 · 合成卷6", exact: true })
      .click();
    await expect
      .poll(async () =>
        Number(
          await report
            .getByRole("progressbar", { name: "长卷阅读进度" })
            .getAttribute("aria-valuenow"),
        ),
      )
      .toBeGreaterThan(50);
    await report.getByRole("button", { name: "相逢", exact: true }).click();
    await expect(page.locator('[data-qianzai-screen="result"]')).toBeVisible();
    await check(page, "reveal-neutral", 390);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(host).toHaveAttribute("data-motion", "paused");
    facts.reducedMotion = true;
    expect(errors).toEqual([]);
    facts.pageErrors = errors;
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(facts, null, 2),
  );
}
console.log(JSON.stringify({ out, passed: true }));
