/** Directed visual checks for an explicitly supplied local-art demo. Does not
 * start a server, register content, or contact a real consumer/database. */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";

type Probe = {
  snapshot(): ConsumerV2ReaderModel;
  owner: {
    navigate(
      position: { questionId: string },
      screen: "question",
    ): Promise<unknown>;
  };
  calls: { path: string; method: string }[];
};
const origin = process.env.QZTX_SCENES_ORIGIN;
if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error("OWNED_LOCAL_ART_ORIGIN_REQUIRED");
const out = path.resolve(`.cache/qztx-art-scenes-check/${Date.now()}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch(),
  errors: string[] = [],
  networkWrites: string[] = [],
  results: unknown[] = [];
let passed = false;
try {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [430, 932],
  ] as const) {
    for (const index of [0, 8, 21, ...(width === 390 ? [23] : [])]) {
      const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: "reduce",
        }),
        page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.method() !== "GET")
          networkWrites.push(r.method() + " " + new URL(r.url()).pathname);
      });
      await page.goto(origin + "/?motion-question");
      await expect(
        page.locator("[data-qztx-question-skin=paper]"),
      ).toBeVisible();
      await page.evaluate(async (index) => {
        const p = (window as unknown as { qianzaiProbe: Probe }).qianzaiProbe;
        await p.owner.navigate(
          { questionId: p.snapshot().entry!.questions[index]!.ref.id },
          "question",
        );
      }, index);
      const progress = page
        .locator("[data-qianzai-screen=question]")
        .getByText(`${index + 1} / 24`, { exact: true });
      await expect(progress).toBeVisible();
      await expect(page.locator("[data-qztx-question-skin]")).toHaveCount(5);
      await expect(page.locator("[data-qztx-skin-piece]")).toHaveCount(45);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await expect
        .poll(() =>
          page
            .locator("[data-qztx-question-background] img")
            .evaluate((n) => (n as HTMLImageElement).complete),
        )
        .toBe(true);
      const act = Math.floor(index / 8),
        expected = QIANZAI_RUNTIME_INPUTS.resources.find(
          (r) => r.slot === `acts.${act}.background`,
        )!,
        nav = QIANZAI_RUNTIME_INPUTS.resources.find(
          (r) => r.slot === `acts.${act}.navigation`,
        )!;
      const background = await page
        .locator("[data-qztx-question-background] img")
        .evaluate(async (n) => {
          const i = n as HTMLImageElement,
            b = i.getBoundingClientRect(),
            bytes = await fetch(i.src).then((r) => r.arrayBuffer());
          return {
            sha256: [
              ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            ]
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
            natural: [i.naturalWidth, i.naturalHeight],
            rendered: [b.width, b.height],
            fit: getComputedStyle(i).objectFit,
          };
        });
      expect(background.sha256).toBe(expected.asset.sha256);
      expect(background.natural).toEqual([853, 1844]);
      // Width-based natural height on short screens, cover's uniform scale for
      // the small source/design aspect difference on tall screens. No squash.
      expect(
        Math.abs(
          background.rendered[0]! / 853 - background.rendered[1]! / 1844,
        ),
      ).toBeLessThan(0.002);
      expect(
        await page.locator("[data-qztx-question-background] img").count(),
      ).toBe(1);
      expect(
        await page.locator("[data-qztx-clean-question-water],pattern").count(),
      ).toBe(0);
      const navFacts = await page
        .locator("[data-qztx-question-nav-art]")
        .evaluateAll(async (nodes) =>
          Promise.all(
            nodes.map(async (n) => {
              const svg = n as SVGSVGElement,
                img = svg.querySelector(":scope>image")!,
                href = img.getAttribute("href")!,
                bytes = await fetch(href).then((r) => r.arrayBuffer());
              return {
                viewBox: svg.getAttribute("viewBox"),
                clip: img.getAttribute("clip-path"),
                sha256: [
                  ...new Uint8Array(
                    await crypto.subtle.digest("SHA-256", bytes),
                  ),
                ]
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join(""),
              };
            }),
          ),
        );
      expect(navFacts).toHaveLength(2);
      expect(navFacts.map((n) => n.viewBox)).toEqual([
        "18 751 114 62",
        "251 751 122 62",
      ]);
      expect(
        navFacts.every(
          (n) =>
            n.sha256 === nav.asset.sha256 &&
            n.sha256 !== background.sha256 &&
            n.clip?.startsWith("url("),
        ),
      ).toBe(true);
      const inspect = () =>
        page.locator("[data-qianzai-scroll-region]").evaluate((port) => {
          const root = port.firstElementChild!,
            parent = root.getBoundingClientRect();
          const geometry = [...root.querySelectorAll("h2,label")].map((n) => {
            const b = n.getBoundingClientRect();
            return [b.x - parent.x, b.y - parent.y, b.width, b.height];
          });
          const text = [
            ...root.querySelectorAll("h2,label>span:nth-last-of-type(2)"),
          ].map((n) => {
            const r = document.createRange();
            r.selectNodeContents(n);
            const b = n.getBoundingClientRect(),
              t = r.getBoundingClientRect(),
              s = getComputedStyle(n),
              card = (
                n.tagName === "H2"
                  ? root.querySelector("[data-qztx-question-skin=paper]")
                  : n.closest("label")
              )!.getBoundingClientRect();
            return {
              font: s.fontFamily,
              size: s.fontSize,
              weight: s.fontWeight,
              fits: t.width <= b.width + 1 && t.height <= b.height + 1,
              lines: new Set(
                [...r.getClientRects()].map((v) => Math.round(v.top)),
              ).size,
              cardInsets: [
                t.left - card.left,
                t.top - card.top,
                card.right - t.right,
                card.bottom - t.bottom,
              ],
            };
          });
          const skins = [
            ...root.querySelectorAll("[data-qztx-question-skin]"),
          ].map((n) => ({
            kind: n.getAttribute("data-qztx-question-skin"),
            window: n.getAttribute("data-qztx-skin-window"),
            columns: getComputedStyle(n).gridTemplateColumns,
            rows: getComputedStyle(n).gridTemplateRows,
          }));
          return {
            geometry,
            text,
            skins,
            scrollTop: port.scrollTop,
            scrollHeight: port.scrollHeight,
            portHeight: port.clientHeight,
            horizontal: document.documentElement.scrollWidth <= innerWidth,
            touch: geometry.slice(1).every((b) => b[3]! >= 44),
          };
        });
      let view = await inspect();
      expect(
        view.text.every(
          (t) =>
            t.size === "16px" &&
            t.weight === "600" &&
            t.font.includes("QuizForge Qianzai Serif V7") &&
            t.fits,
        ),
      ).toBe(true);
      expect(view.text.slice(1).every((t) => t.lines <= 2)).toBe(true);
      expect(view.text.every((t) => t.cardInsets.every((v) => v >= 0))).toBe(
        true,
      );
      expect(view.skins[0]!.window).toBe("4 19 2173 651");
      expect(
        view.skins.slice(1).every((s) => s.window === "0 159 2171 390"),
      ).toBe(true);
      expect(view.touch && view.horizontal).toBe(true);
      await page.screenshot({
        path: path.join(out, `act-${act + 1}-q${index + 1}-${width}-idle.png`),
      });
      await page.clock.install();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      const first = page.locator("[data-qianzai-scroll-region] label").first();
      await first.scrollIntoViewIfNeeded();
      view = await inspect();
      await first.click();
      await expect(first.locator("input")).toBeChecked();
      const selected = await inspect();
      expect(selected.geometry).toEqual(view.geometry);
      expect(selected.scrollTop).toBe(view.scrollTop);
      await expect(first.locator("[data-qztx-question-skin]")).toHaveAttribute(
        "data-qztx-skin-window",
        "0 159 2170 394",
      );
      const port = page.locator("[data-qianzai-scroll-region]");
      await port.evaluate((n) => {
        n.scrollTop = n.scrollHeight;
      });
      const lower = await port.evaluate((n) => {
        const d = n
            .querySelector("label:last-of-type")!
            .getBoundingClientRect(),
          b = n.getBoundingClientRect();
        return d.top >= b.top - 0.5 && d.bottom <= b.bottom + 0.5;
      });
      expect(lower).toBe(true);
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.screenshot({
        path: path.join(
          out,
          `act-${act + 1}-q${index + 1}-${width}-selected-bottom.png`,
        ),
      });
      const calls = await page.evaluate(
        () => (window as unknown as { qianzaiProbe: Probe }).qianzaiProbe.calls,
      );
      expect(calls.some((c) => c.path.includes("complete"))).toBe(false);
      results.push({
        width,
        height,
        index,
        background,
        nav: navFacts,
        before: view,
        selected: { geometry: selected.geometry, skins: selected.skins },
        lowerOnlyScroll: true,
        syntheticCalls: calls,
      });
      await context.close();
    }
  }
  expect(errors).toEqual([]);
  expect(networkWrites).toEqual([]);
  passed = true;
} finally {
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(
      {
        passed,
        scope:
          "real React/controller/resource lease in explicit local-demo-only art fixture; directed question layout and source-image checks; synthetic session transport, no DB/QuizPack/author/native acceptance",
        results,
        errors,
        networkWrites,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed,
      out,
      cases: results.length,
      errors,
      networkWrites,
    }),
  );
  await browser.close();
}
