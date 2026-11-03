import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const mode = process.env.PLATFORM_CAPTURE_ONLY ?? "all";
const focused = mode === "public-menu";
const out = path.resolve(`.cache/platform-home-v2/browser/${Date.now()}`);
await mkdir(out, { recursive: true });
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  entryPoints: [
    path.resolve("src/features/platform-home/browser.test-support.tsx"),
  ],
  outfile: path.join(out, "probe.js"),
  bundle: true,
  format: "iife",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  alias: {
    react: path.resolve("node_modules/react"),
    "react-dom": path.resolve("node_modules/react-dom"),
  },
});
const manifest = JSON.parse(
  await readFile(".cache/platform-home-v2/assets/manifest.json", "utf8"),
) as {
  sourceHtmlSha256: string;
  assets: {
    id: string;
    file: string;
    width: number;
    height: number;
    sha256: string;
  }[];
};
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const files = new Map<string, { bytes: Buffer; contentType: string }>();
for (const asset of manifest.assets) {
  const bytes = await readFile(`.cache/platform-home-v2/assets/${asset.file}`);
  expect(hash(bytes)).toBe(asset.sha256);
  files.set(`/platform-art/${asset.id}`, { bytes, contentType: "image/png" });
}
for (const ext of ["js", "css"])
  files.set(`/probe.${ext}`, {
    bytes: await readFile(path.join(out, `probe.${ext}`)),
    contentType: ext === "js" ? "text/javascript" : "text/css",
  });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Platform V2 scoped UI probe</title><style>*{box-sizing:border-box}body{margin:0}h1,h2,h3,p{margin:0}a{text-decoration:none}button,input{font:inherit}</style><link rel="stylesheet" href="/probe.css"><div id="root"></div><script src="/probe.js"></script></html>`;
const gestureChecks: string[] = [];
const posts: string[] = [],
  errors: string[] = [],
  captures: {
    view: string;
    viewport: { width: number; height: number };
    file: string;
  }[] = [];
const server = createServer((req, res) => {
  if (req.method !== "GET") {
    posts.push(new URL(req.url!, "http://local").pathname);
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url!, "http://local"),
    asset = files.get(url.pathname);
  if (asset) {
    res.writeHead(200, { "Content-Type": asset.contentType });
    res.end(asset.bytes);
    return;
  }
  if (url.pathname.startsWith("/platform-art/")) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(html);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw Error("NO_UI_ADDRESS");
const base = `http://127.0.0.1:${address.port}`,
  browser = await chromium.launch();
let passed = false;
try {
  const widths = process.env.PLATFORM_CAPTURE_WIDTH
    ? [Number(process.env.PLATFORM_CAPTURE_WIDTH)]
    : mode === "missing" || mode === "gesture"
      ? [390]
      : [320, 375, 390, 430, 1280];
  for (const width of widths) {
    const viewport = {
      width,
      height:
        width === 320
          ? 568
          : width === 375
            ? 812
            : width === 390
              ? 844
              : width === 430
                ? 932
                : 900,
    };
    const context = await browser.newContext({
      viewport,
      reducedMotion: "reduce",
      hasTouch: mode === "gesture",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const capture = async (view: string) => {
      await page.locator("img").evaluateAll((nodes) =>
        Promise.all(
          nodes.map(async (node) => {
            try {
              if (node instanceof HTMLImageElement) await node.decode();
            } catch {}
          }),
        ),
      );
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth > innerWidth + 1,
        main: [
          ...document.querySelectorAll<HTMLElement>("[data-platform-scroll]"),
        ].some((node) => node.scrollWidth > node.clientWidth + 1),
      }));
      expect(overflow, `${width} ${view} overflow`).toEqual({
        document: false,
        main: false,
      });
      const dialog = page.getByRole("dialog");
      if (await dialog.count()) {
        const bounds = await dialog.evaluate((node) => {
          const d = node.getBoundingClientRect(),
            f = node.parentElement!.getBoundingClientRect();
          return {
            left: d.left - f.left,
            right: d.right - f.right,
            bottom: d.bottom - f.bottom,
          };
        });
        expect(
          Math.abs(bounds.left),
          `${view} dialog aligned to frame`,
        ).toBeLessThanOrEqual(1);
        expect(
          Math.abs(bounds.right),
          `${view} dialog width aligned to frame`,
        ).toBeLessThanOrEqual(1);
        expect(bounds.bottom).toBeLessThanOrEqual(1);
      }
      const file = `${view}-${width}x${viewport.height}.png`;
      await page.screenshot({ path: path.join(out, file) });
      captures.push({ view, viewport, file });
    };
    const checkPublic = async () => {
      await page.goto(base + "/works/qianzai-tongxin");
      await expect(
        page.getByRole("img", { name: "千载同心，岸边灯影封面", exact: true }),
      ).toBeVisible();
      await expect(page.locator("canvas[data-qianzai-petals]")).toHaveCount(1);
      await expect(page.locator("[data-motion]")).toHaveAttribute(
        "data-motion",
        "paused",
      );
      await expect(page.locator("form")).toHaveCount(0);
      const start = page.getByRole("button", {
        name: "开启穿越之旅，兑换资格",
        exact: true,
      });
      await capture("public-cover");
      await start.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(page.locator("form")).toHaveCount(1);
      const field = page.getByLabel("兑换码", { exact: true });
      await expect(field).toHaveAttribute("type", "password");
      await expect(field).not.toHaveAttribute("name");
      await capture("public-redeem");
      await page
        .getByRole("button", { name: "兑换并进入", exact: true })
        .click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveValue("");
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        expect(
          await sheet.evaluate((node) => node.contains(document.activeElement)),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      await expect(page.locator("form")).toHaveCount(0);
      await expect(start).toBeFocused();
      await page
        .getByRole("button", { name: "上滑也可启程", exact: true })
        .click();
      await expect(page.locator("form")).toHaveCount(1);
      await page
        .getByRole("button", { name: "先看看封面", exact: true })
        .click();
      await expect(page.locator("form")).toHaveCount(0);
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
      if (width === 390) {
        await page.goto(base + "/works/qianzai-tongxin?missing");
        await expect(
          page.getByText("插画暂未载入", { exact: true }),
        ).toBeVisible();
        await capture("missing-cover");
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.goto(base + "/works/qianzai-tongxin");
        await expect(page.locator("[data-motion]")).toHaveAttribute(
          "data-motion",
          "running",
        );
        await page
          .getByRole("button", { name: "封面动效设置", exact: true })
          .click();
        await page
          .getByRole("button", { name: "暂停动效", exact: true })
          .click();
        await expect(page.locator("[data-motion]")).toHaveAttribute(
          "data-motion",
          "paused",
        );
        const lamps = await page
          .locator("[data-motion] i")
          .evaluateAll((nodes) =>
            nodes.map((node) => getComputedStyle(node).animationPlayState),
          );
        expect(lamps).toEqual(Array(6).fill("paused"));
      }
    };
    if (mode === "gesture") {
      await page.goto(base + "/works/qianzai-tongxin");
      await expect(page.locator("canvas[data-qianzai-petals]")).toHaveCount(1);
      const session = await context.newCDPSession(page);
      type Point = { x: number; y: number; id: number };
      const event = (
        type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
        touchPoints: Point[],
      ) => session.send("Input.dispatchTouchEvent", { type, touchPoints });
      const swipe = async (
        x: number,
        y: number,
        endX: number,
        endY: number,
      ) => {
        await event("touchStart", [{ x, y, id: 1 }]);
        await event("touchMove", [{ x: endX, y: endY, id: 1 }]);
        await event("touchEnd", []);
      };
      const absent = async (name: string) => {
        await expect(page.getByRole("dialog")).toHaveCount(0);
        gestureChecks.push(name);
      };
      await swipe(100, 700, 100, 665);
      await absent("short upward movement ignored");
      await swipe(100, 600, 100, 700);
      await absent("downward gesture ignored");
      await swipe(100, 700, 230, 620);
      await absent("horizontal-dominant gesture ignored");
      await event("touchStart", [{ x: 100, y: 700, id: 1 }]);
      await event("touchCancel", []);
      await page.locator("[data-motion]").dispatchEvent("touchend", {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 100, clientY: 550 }],
      });
      await absent("touchcancel clears stale origin");
      await event("touchStart", [
        { x: 100, y: 700, id: 1 },
        { x: 160, y: 700, id: 2 },
      ]);
      await event("touchMove", [
        { x: 100, y: 580, id: 1 },
        { x: 160, y: 580, id: 2 },
      ]);
      await event("touchEnd", []);
      await absent("multi-touch origin ignored");
      await event("touchStart", [{ x: 100, y: 700, id: 1 }]);
      await event("touchStart", [
        { x: 100, y: 700, id: 1 },
        { x: 160, y: 700, id: 2 },
      ]);
      await event("touchMove", [
        { x: 100, y: 580, id: 1 },
        { x: 160, y: 580, id: 2 },
      ]);
      await event("touchEnd", []);
      await absent("second finger invalidates an existing gesture");
      const start = page.getByRole("button", {
        name: "开启穿越之旅，兑换资格",
        exact: true,
      });
      const button = await start.boundingBox();
      if (!button) throw Error("NO_START_TARGET");
      await swipe(
        button.x + button.width / 2,
        button.y + button.height / 2,
        button.x + button.width / 2,
        button.y - 80,
      );
      await absent("button-origin swipe excluded");
      await page
        .getByRole("button", { name: "封面动效设置", exact: true })
        .click();
      await swipe(100, 700, 100, 580);
      await absent("open menu suppresses background swipe");
      const menu = await page
        .getByRole("button", { name: "暂停动效", exact: true })
        .boundingBox();
      if (!menu) throw Error("NO_MENU_TARGET");
      await swipe(
        menu.x + menu.width / 2,
        menu.y + menu.height / 2,
        menu.x + menu.width / 2,
        menu.y - 30,
      );
      await absent("menu-origin swipe excluded");
      await page
        .getByRole("button", { name: "封面动效设置", exact: true })
        .click();
      await page.evaluate(() => {
        Object.assign(window, { platformGestureMounts: 0 });
        new MutationObserver((records) => {
          for (const r of records)
            for (const node of r.addedNodes)
              if (
                node instanceof Element &&
                (node.matches("dialog") || node.querySelector("dialog"))
              )
                (window as unknown as { platformGestureMounts: number })
                  .platformGestureMounts++;
        }).observe(document.getElementById("root")!, {
          childList: true,
          subtree: true,
        });
      });
      await swipe(100, 700, 110, 580);
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.locator("form")).toHaveCount(1);
      await page.locator("[data-motion]").dispatchEvent("touchend", {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 110, clientY: 580 }],
      });
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { platformGestureMounts: number })
              .platformGestureMounts,
        ),
      ).toBe(1);
      gestureChecks.push(
        "valid upward swipe mounts one redemption form; duplicate end ignored",
      );
      const sheet = await page.getByRole("dialog").boundingBox();
      if (!sheet) throw Error("NO_REDEMPTION_TARGET");
      await swipe(sheet.x + 25, sheet.y + 130, sheet.x + 25, sheet.y + 55);
      await expect(page.locator("form")).toHaveCount(1);
      expect(
        await page.evaluate(
          () =>
            (window as unknown as { platformGestureMounts: number })
              .platformGestureMounts,
        ),
      ).toBe(1);
      gestureChecks.push("dialog swipe cannot open another instance");
      await page
        .getByRole("button", { name: "先看看封面", exact: true })
        .click();
      await expect(page.locator("form")).toHaveCount(0);
      await page.locator("[data-motion]").dispatchEvent("touchend", {
        touches: [],
        changedTouches: [{ identifier: 1, clientX: 110, clientY: 580 }],
      });
      await absent("closing dialog clears stale gesture");
      await swipe(100, 700, 100, 580);
      await expect(page.locator("form")).toHaveCount(1);
      gestureChecks.push("fresh gesture works after closing");
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
      await session.detach();
      await context.close();
      continue;
    }
    if (mode === "missing") {
      await page.goto(base + "/works/qianzai-tongxin?missing");
      await expect(
        page.getByRole("heading", { name: "千载同心", exact: true }),
      ).toBeVisible();
      const start = page.getByRole("button", {
        name: "开启穿越之旅，兑换资格",
        exact: true,
      });
      await expect(start).toHaveCSS("color", "rgb(73, 60, 50)");
      await capture("missing-cover");
      await start.click();
      await expect(page.locator("form")).toHaveCount(1);
      await page.keyboard.press("Escape");
      await expect(page.locator("form")).toHaveCount(0);
      await context.close();
      continue;
    }
    await page.goto(base + "/");
    await expect(
      page.getByRole("link", { name: "进入千载同心作品封面", exact: true }),
    ).toBeVisible();
    const targets = await page
      .locator("main a,main button")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const r = node.getBoundingClientRect();
          return {
            text: node.getAttribute("aria-label") ?? node.textContent,
            width: r.width,
            height: r.height,
          };
        }),
      );
    expect(
      targets.filter((r) => r.width < 43.9 || r.height < 43.9),
      `home targets ${width}`,
    ).toEqual([]);
    if (!focused) await capture("home");
    await page.getByRole("button", { name: "打开菜单", exact: true }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭弹层" })).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(
        await modal.evaluate((node) => node.contains(document.activeElement)),
      ).toBe(true);
    }
    await capture("menu");
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "打开菜单", exact: true }),
    ).toBeFocused();
    if (focused) {
      await checkPublic();
      await context.close();
      continue;
    }
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "我的", exact: true })
      .click();
    await expect(page).toHaveURL(base + "/my");
    const input = page.getByLabel("兑换码", { exact: true });
    await expect(input).toHaveAttribute("type", "password");
    await expect(input).not.toHaveAttribute("name");
    await input.scrollIntoViewIfNeeded();
    await capture("mine");
    await page.getByRole("button", { name: "兑换并进入", exact: true }).click();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveValue("");
    await capture("mine-invalid-empty");
    if (width === 1280) {
      await context.close();
      continue;
    }
    await page.goto(base + "/search");
    await page.getByRole("searchbox").fill("心动");
    await expect(
      page.getByRole("heading", { name: "心动气象局", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "千载同心", exact: true }),
    ).toHaveCount(0);
    await capture("search");
    await page.getByRole("searchbox").fill("没有这一款作品");
    await expect(
      page.getByText("没有找到相关作品", { exact: true }),
    ).toBeVisible();
    await page.goto(base + "/works");
    await capture("catalog");
    await page.getByRole("button", { name: "都市", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "千载同心", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "查看预告", exact: true }).click();
    await expect(page).toHaveURL(base + "/works/heart");
    await capture("preview");
    await expect(
      page.getByText("筹备中 · 尚未开放购买与体验", { exact: true }),
    ).toBeVisible();
    await checkPublic();
    if (width === 390) {
      await page.goto(base + "/?missing");
      await expect(
        page.getByText("主页插画暂未载入，仍可浏览作品封面与预告。", {
          exact: true,
        }),
      ).toBeVisible();
      await capture("missing-home");
    }
    await context.close();
  }
  expect(posts).toEqual([]);
  expect(errors).toEqual([]);
  passed = true;
} finally {
  const sources = [
    "src/features/platform-home/platform-home.tsx",
    "src/features/platform-home/platform-home.module.css",
    "src/features/platform-home/qianzai-public-entry.tsx",
    "src/features/platform-home/browser.test-support.tsx",
    "src/features/platform-home/access-form.tsx",
    "src/features/platform-home/access-controller.ts",
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sources.map(async (file) => [file, hash(await readFile(file))]),
    ),
  );
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        scope:
          "Actual platform UI with A's real access form, private archived marketing art, isolated loopback visual server; no successful authorization, database, production route/build or author acceptance",
        passed,
        mode,
        reusedEvidence:
          mode !== "all"
            ? ".cache/platform-home-v2/browser/1793359844557/result.json (unchanged home/mine/search/catalog/preview behavior)"
            : null,
        browser: "Chromium",
        sourceHashes,
        assets: manifest,
        captures,
        gestureChecks,
        posts,
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  console.log(out, passed);
}
