import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { consumerSessionFixtureV2 } from "@/features/theme/consumer-v2/session.test-support";
import { structuredReaderFixtureV2 } from "@/features/theme/consumer-v2/fixtures.test-support";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { consumerEntryFactsSha256V2 } from "@/features/fulfillment/consumer-flow/display-contract-v2";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";

const check = process.argv.includes("--check"),
  out = path.resolve(`.cache/qztx-experience-review/${Date.now()}`);
await mkdir(out, { recursive: true });
const digest = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
function scope<T>(x: T): T {
  return JSON.parse(
    JSON.stringify(x, (key, v) =>
      key === "productId" ? "qianzai-tongxin" : v,
    ),
  );
}
const session = scope(await consumerSessionFixtureV2()),
  reader = scope(structuredReaderFixtureV2()),
  report = scope(await qianzaiExportFixture());
session.entry.facts.entry = reader.model.entry!;
const entry = session.entry.facts.entry,
  bindings = QIANZAI_RUNTIME_INPUTS.resources.filter(
    (r) =>
      !r.slot.startsWith("character.") ||
      r.asset.resourceRef.id.startsWith("qztx-test-li-bai-"),
  );
const asset = (slot: string) => bindings.find((r) => r.slot === slot)!.asset;
entry.presentationMode = "authored-product";
entry.preferences = ["male", "female", "any"];
entry.assets = bindings
  .filter((r) => !r.slot.startsWith("character."))
  .map((r) => ({ ...r.asset, alt: "私有原型参考 · 合成流程" }));
entry.slots.cover = asset("cover").resourceRef;
entry.slots.preferenceScene = asset("preferenceScene").resourceRef;
entry.slots.reportPaper = asset("reportPaper").resourceRef;
entry.slots.acts = ["act-one", "act-two", "act-three"].map((sectionId, i) => ({
  ...entry.slots.acts[0]!,
  sectionId,
  background: asset(`acts.${i}.background`).resourceRef,
  questionPaper: asset(`acts.${i}.questionPaper`).resourceRef,
  optionIdle: asset(`acts.${i}.optionIdle`).resourceRef,
  optionSelected: asset(`acts.${i}.optionSelected`).resourceRef,
}));
entry.questions.forEach((q, i) => {
  q.prompt = `合成情境${i + 1}：你正为下一阶段的兴趣选择方向，已有爱好与陌生领域都值得尝试。你如何取舍？`;
  q.options = Array.from({ length: 4 }, (_, n) => ({
    ref: { ...q.options[0]!.ref, id: `q-${i}-o-${n}` },
    label: [
      "更多参考身边人的建议，继续深耕熟悉方向",
      "更多依据自己的喜好，尝试陌生方向",
      "更多参考身边人的建议，尝试陌生方向",
      "更多依据自己的喜好，继续深耕熟悉方向",
    ][n]!,
  }));
});
session.entry.factsSha256 = await consumerEntryFactsSha256V2(
  session.entry.facts,
);
const completed = report.model,
  display = completed.report!.view.display;
display.body.matching.selected.label = "李白";
display.assets = bindings
  .filter((r) => r.slot.startsWith("character.") || r.slot === "reportPaper")
  .filter(
    (r, i, a) =>
      a.findIndex((b) => b.asset.resourceRef.id === r.asset.resourceRef.id) ===
      i,
  )
  .map((r) => ({ ...r.asset, alt: "李白私有参考 · 非正式人物定稿" }));
for (const slot of ["reveal", "report", "poster", "nameArt"] as const)
  display.slots.character[slot] = asset(`character.${slot}`).resourceRef;
display.slots.neutral.reportPaper = asset("reportPaper").resourceRef;
const assetRoot =
  process.env.QZTX_REVIEW_ASSET_DIR ??
  "/Users/aipuli/.codex/worktrees/quizforge-qztx-full-flow-demo/quiz-forge/.cache/qztx-full-flow/assets";
const files = new Map<string, { body: Buffer | string; type: string }>(),
  visuals: {
    asset: (typeof entry.assets)[number];
    url: string;
    layer: (typeof bindings)[number]["layer"];
  }[] = [],
  completedVisuals: typeof visuals = [];
for (const binding of bindings) {
  const a = binding.asset,
    id = a.resourceRef.id;
  const name = id.startsWith("qztx-v1-")
    ? `${id}.${a.mediaType === "image/jpeg" ? "jpg" : a.mediaType.split("/")[1]}`
    : id === "qztx-test-report-paper"
      ? "report-paper.png"
      : id.endsWith("-name")
        ? "li-bai-name-outline-v4.png"
        : "li-bai-report-reference.jpg";
  const raw = await readFile(path.join(assetRoot, name));
  if (digest(raw) !== a.sha256) throw Error("REFERENCE_BYTES_CHANGED:" + name);
  const url = "/asset/" + id;
  files.set(url, { body: raw, type: a.mediaType });
  const declared = { ...a, alt: "合成流程私有参考" };
  (binding.slot.startsWith("character.") || binding.slot === "reportPaper"
    ? completedVisuals
    : visuals
  ).push({ asset: declared, url, layer: binding.layer });
}
const require = createRequire(
  createRequire(import.meta.url).resolve("tsx/package.json"),
);
await require("esbuild").build({
  entryPoints: [
    path.resolve("src/features/theme/qianzai-tongxin/browser.test-support.tsx"),
  ],
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
      name: "unreachable-node-policy",
      setup(b: {
        onResolve(o: object, cb: () => object): void;
        onLoad(o: object, cb: () => object): void;
      }) {
        b.onResolve({ filter: /^node:util$/ }, () => ({
          path: "node:util",
          namespace: "stub",
        }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents:
            'export const types = new Proxy({}, {get(){throw Error("NODE_POLICY_UNREACHABLE")}});',
          loader: "js",
        }));
      },
    },
  ],
});
for (const ext of ["js", "css"])
  files.set(`/probe.${ext}`, {
    body: await readFile(path.join(out, `probe.${ext}`)),
    type: ext === "js" ? "text/javascript" : "text/css",
  });
for (const file of [report.font.file, report.font.coverage])
  files.set(file, {
    body: await readFile(path.join("public", file)),
    type: file.endsWith("woff2") ? "font/woff2" : "text/plain",
  });
const setup = JSON.stringify({
  session,
  completed,
  visuals,
  completedVisuals,
  review: true,
}).replaceAll("<", "\\u003c");
const controls = `<details id="review-controls"><summary>UI审查 · 合成流程／私有参考</summary><nav><a href="/?motion-question">答题</a> <a href="/?motion-question&review-last">Q24</a> <a href="/?review-report=reveal">李白揭晓</a> <a href="/?review-report=report">报告／分享</a></nav><button data-review="holdNext">下一次保存延迟</button><button data-review="dropNext">下一次回执 UNKNOWN</button><button data-review="release">释放延迟回执</button><button data-review="reset">重置本预览合成记录</button><p>先选延迟／UNKNOWN，再点选项。本预览合并显示测试说明：题目、报告与分数均为合成数据，HTTP模拟且不连接数据库；图片是既有私有参考，姓名为程序排字，正文是候选内容。非正式题目、作者美术验收或正式发布，不证明真实评分与生产准入。</p></details>`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>千载同心 UI审查 · 合成流程</title><link rel="stylesheet" href="/probe.css"><style>@font-face{font-family:"QuizForge Qianzai Serif V4";src:url(${report.font.file});font-weight:600;font-display:swap}body{margin:0;background:#0b1727}#root > details,#root .qianzai_synthetic{display:none}#review-controls{max-width:430px;margin:auto;padding:6px 12px;box-sizing:border-box;background:#f5ead5;color:#203b49;font:16px/1.6 system-ui}#review-controls summary{cursor:pointer;min-height:44px}#review-controls :is(a,button){display:inline-block;min-height:44px;padding:6px 9px;box-sizing:border-box;font:16px/1.6 system-ui;margin:3px;border:1px solid #927242;border-radius:6px;color:#203b49;background:#fff7e8}#review-controls p{margin:8px 0}</style>${controls}<div id="root"></div><script id="fixture" type="application/json">${setup}</script><script src="/probe.js"></script><script>document.querySelector('#review-controls').addEventListener('click',e=>{const k=e.target.dataset.review;if(!k)return;if(k==='reset'){localStorage.removeItem('qianzai-synthetic-server-state');for(const key of Object.keys(sessionStorage))if(key.includes('consumer'))sessionStorage.removeItem(key);location.href='/?motion-question';return;}window.qianzaiProbe?.[k]?.();});</script></html>`;
const unexpectedWrites: string[] = [],
  server = createServer((req, res) => {
    if (req.method !== "GET") {
      unexpectedWrites.push(req.url ?? "");
      res.writeHead(405);
      res.end();
      return;
    }
    const f = files.get(new URL(req.url ?? "/", "http://local").pathname);
    res.writeHead(200, {
      "content-type": f?.type ?? "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(f?.body ?? html);
  });
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const addr = server.address();
if (!addr || typeof addr === "string") throw Error("NO_LOCAL_ADDRESS");
const origin = `http://127.0.0.1:${addr.port}`;
await writeFile(
  path.join(out, "server.json"),
  JSON.stringify(
    {
      origin,
      pid: process.pid,
      scope: "synthetic UI/controller/resource/PNG review only; no database",
      assets: bindings.map((b) => ({ slot: b.slot, ...b.asset })),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    origin,
    out,
    pid: process.pid,
    mode: check ? "check" : "serve",
  }),
);
if (check) {
  const browser = await chromium.launch(),
    errors: string[] = [];
  const result: { name: string; passed: boolean }[] = [];
  let passed = false,
    failure: string | undefined;
  try {
    type Probe = {
      calls: { path: string; method: string }[];
      snapshot(): import("@/lib/consumer-contract/v2/client-contract").ConsumerV2ReaderModel;
      holdNext(): void;
      dropNext(): void;
      release(): void;
      setHidden(v: boolean): void;
      owner: import("@/features/theme/consumer-v2/controller").ConsumerControllerV2;
    };
    const make = async (
      width = 320,
      last = true,
      reducedMotion: "reduce" | "no-preference" = "reduce",
    ) => {
      const p = await browser.newPage({
        viewport: {
          width,
          height:
            width === 320
              ? 568
              : width === 375
                ? 812
                : width === 430
                  ? 932
                  : 844,
        },
        reducedMotion,
      });
      p.on("pageerror", (e) => errors.push(e.message));
      await p.addInitScript("window.__name=(f)=>f");
      await p.goto(
        origin + (last ? "/?motion-question&review-last" : "/?motion-question"),
      );
      await expect(p.locator("[data-view-phase]")).toHaveAttribute(
        "data-view-phase",
        "ready",
      );
      await expect(
        p.locator('[data-qianzai-screen="question"] h2'),
      ).toContainText(last ? "合成情境24" : "合成情境1");
      await expect(
        p.locator('[data-qianzai-screen="question"]'),
      ).toHaveAttribute("data-qianzai-composite", "true");
      await p.clock.install();
      await p.clock.pauseAt(new Date(Date.now() + 100));
      return p;
    };
    const phase = (p: import("@playwright/test").Page, value: string) =>
      expect(p.locator("[data-view-phase]")).toHaveAttribute(
        "data-view-phase",
        value,
      );
    const action = (
      p: import("@playwright/test").Page,
      cmd: "holdNext" | "dropNext" | "release",
    ) =>
      p.evaluate(
        (cmd) =>
          (window as unknown as { qianzaiProbe: Probe }).qianzaiProbe[cmd](),
        cmd,
      );
    const choose = (p: import("@playwright/test").Page, n = 2) =>
      p
        .locator('[data-qianzai-screen="question"] input[type=radio]')
        .nth(n)
        .evaluate((e) => (e as HTMLInputElement).click());
    const counts = (p: import("@playwright/test").Page) =>
      p.evaluate(() => {
        const calls = (window as unknown as { qianzaiProbe: Probe })
          .qianzaiProbe.calls;
        return {
          save: calls.filter(
            (c) => c.method === "POST" && c.path.endsWith("/save"),
          ).length,
          complete: calls.filter(
            (c) => c.method === "POST" && c.path.endsWith("/complete"),
          ).length,
        };
      });
    const readyComplete = async (p: import("@playwright/test").Page) => {
      await phase(p, "ready");
      await p.clock.runFor(60);
      await phase(p, "completed");
      expect((await counts(p)).complete).toBe(1);
    };
    const scenarios = process.env.QZTX_REVIEW_SCENARIOS?.split(",").filter(
      Boolean,
    ) ?? [
      "slow-save",
      "unknown-save",
      "unknown-complete",
      "edit-repeat",
      "hidden",
      "revoked",
    ];
    for (const scenario of scenarios) {
      const p =
        scenario === "fast-next"
          ? await make(390, false, "no-preference")
          : await make();
      if (scenario === "fast-next") {
        const question = p.locator('[data-qianzai-screen="question"]');
        const boundary = () =>
          p.evaluate(() => {
            const probe = (window as unknown as { qianzaiProbe: Probe })
              .qianzaiProbe;
            const input = document.querySelector<HTMLInputElement>(
              '[data-qianzai-screen="question"] input[type=radio]',
            )!;
            const model = probe.snapshot();
            return {
              phase: model.phase,
              question: model.draft?.progress.questionId,
              disabled: input.matches(":disabled"),
              inert: !!input.closest("[inert]"),
            };
          });
        await action(p, "holdNext");
        await question.locator("label").first().click();
        // The first response stays held while feedback/leave time elapses.
        // No clock advance or sleep is allowed between accepted Q2 and its click.
        await p.clock.runFor(600);
        await phase(p, "saving");
        await expect.poll(async () => (await counts(p)).save).toBe(1);
        expect(await counts(p)).toEqual({ save: 1, complete: 0 });
        await action(p, "release");
        await phase(p, "ready");
        await expect(question.locator("h2")).toContainText("合成情境2");
        expect(await boundary()).toEqual({
          phase: "ready",
          question: "q-1",
          disabled: false,
          inert: false,
        });
        await writeFile(
          path.join(out, "fast-next-q2-boundary.json"),
          JSON.stringify(await boundary(), null, 2),
        );
        const revision = await p.evaluate(
          () =>
            (
              window as unknown as { qianzaiProbe: Probe }
            ).qianzaiProbe.snapshot().state!.stateRevision,
        );
        await question.locator("label").first().click();
        const q2Chosen = await question
          .locator("input[type=radio]")
          .first()
          .isChecked();
        if (!q2Chosen)
          await p.screenshot({
            path: path.join(out, "fast-next-q2-dropped-390.png"),
          });
        expect(q2Chosen).toBe(true);
        expect(
          await p.evaluate(
            () =>
              (
                window as unknown as { qianzaiProbe: Probe }
              ).qianzaiProbe.snapshot().draft!.answers,
          ),
        ).toContainEqual({ questionId: "q-1", optionId: "q-1-o-0" });
        expect(await counts(p)).toEqual({ save: 1, complete: 0 });
        await action(p, "holdNext");
        await p.clock.runFor(401);
        await phase(p, "saving");
        await expect.poll(async () => (await counts(p)).save).toBe(2);
        expect(
          await p.evaluate(
            () =>
              (
                window as unknown as { qianzaiProbe: Probe }
              ).qianzaiProbe.snapshot().state!.stateRevision,
          ),
        ).toBe(revision);
        await action(p, "release");
        await phase(p, "ready");
        await expect(question.locator("h2")).toContainText("合成情境3");
        expect(await boundary()).toEqual({
          phase: "ready",
          question: "q-2",
          disabled: false,
          inert: false,
        });
        const accepted = await p.evaluate(
          () =>
            (
              window as unknown as { qianzaiProbe: Probe }
            ).qianzaiProbe.snapshot().state!,
        );
        expect(accepted.stateRevision).toBe(revision + 1);
        expect(accepted.answers).toContainEqual({
          questionId: "q-0",
          optionId: "q-0-o-0",
        });
        expect(accepted.answers).toContainEqual({
          questionId: "q-1",
          optionId: "q-1-o-0",
        });
        await p.clock.runFor(2000);
        expect(await counts(p)).toEqual({ save: 2, complete: 0 });
        await p.screenshot({
          path: path.join(out, "fast-next-ready-q3-390.png"),
        });
        result.push({ name: scenario, passed: true });
        await p.close();
        continue;
      }
      if (scenario === "saving-presentation") {
        const question = p.locator('[data-qianzai-screen="question"]');
        const port = question.locator("[data-qianzai-scroll-region]");
        await port.evaluate((e) => (e.scrollTop = 100));
        const before = {
          page: await p.evaluate(() => scrollY),
          inner: await port.evaluate((e) => e.scrollTop),
          top: (await question.boundingBox())!.y,
        };
        await action(p, "holdNext");
        await choose(p);
        await p.clock.runFor(401);
        await phase(p, "saving");
        await expect(p.getByLabel("本轮旅程状态")).toHaveCSS("width", "1px");
        await expect(
          question.getByText("保存中", { exact: true }),
        ).toBeVisible();
        expect({
          page: await p.evaluate(() => scrollY),
          inner: await port.evaluate((e) => e.scrollTop),
          top: (await question.boundingBox())!.y,
        }).toEqual(before);
        await p.screenshot({
          path: path.join(out, "saving-presentation-320.png"),
        });
        result.push({ name: scenario, passed: true });
        await p.close();
        continue;
      }
      const q = p.locator('[data-qianzai-screen="question"]'),
        port = q.locator("[data-qianzai-scroll-region]");
      await port.evaluate((e) => (e.scrollTop = 100));
      const before = await port.evaluate((e) => e.scrollTop),
        top = (await q.boundingBox())!.y;
      const original = await q
        .locator("input[type=radio]")
        .first()
        .elementHandle();
      if (["slow-save", "revoked"].includes(scenario))
        await action(p, "holdNext");
      if (scenario === "unknown-save") await action(p, "dropNext");
      await choose(p);
      if (scenario === "hidden") {
        await p.clock.runFor(200);
        await p.evaluate(() =>
          (window as unknown as { qianzaiProbe: Probe }).qianzaiProbe.setHidden(
            true,
          ),
        );
        await p.clock.runFor(2000);
        await p.evaluate(() =>
          (window as unknown as { qianzaiProbe: Probe }).qianzaiProbe.setHidden(
            false,
          ),
        );
        await p.clock.runFor(1000);
        expect(await counts(p)).toEqual({ save: 0, complete: 0 });
      } else if (scenario === "edit-repeat") {
        await p.clock.runFor(100);
        await choose(p, 3);
        await choose(p, 3);
        await p.clock.runFor(401);
        await readyComplete(p);
        expect(await counts(p)).toEqual({ save: 1, complete: 1 });
        expect(
          await p.evaluate(
            () =>
              JSON.parse(
                localStorage.getItem("qianzai-synthetic-server-state")!,
              ).answers.find(
                (a: { questionId: string }) => a.questionId === "q-23",
              )?.optionId,
          ),
        ).toBe("q-23-o-3");
      } else {
        await p.clock.runFor(401);
        if (scenario === "slow-save" || scenario === "revoked") {
          await phase(p, "saving");
          expect(await port.evaluate((e) => e.scrollTop)).toBe(before);
          expect((await q.boundingBox())!.y).toBe(top);
          expect(await original!.evaluate((e) => e.isConnected)).toBe(true);
          await expect(q.locator("h2")).toHaveCSS("opacity", "1");
          await q.screenshot({ path: path.join(out, `${scenario}-320.png`) });
          const pending = await p.evaluate(() =>
            JSON.stringify(sessionStorage),
          );
          await p.clock.runFor(2000);
          expect(await p.evaluate(() => JSON.stringify(sessionStorage))).toBe(
            pending,
          );
          expect(await counts(p)).toEqual({ save: 1, complete: 0 });
          if (scenario === "revoked") {
            await p.evaluate(() =>
              (
                window as unknown as { qianzaiProbe: Probe }
              ).qianzaiProbe.owner.revoke(),
            );
            await expect(
              p.getByRole("heading", { name: "本次访问已结束", exact: true }),
            ).toBeVisible();
            await action(p, "release");
            await p.clock.runFor(1000);
            expect((await counts(p)).complete).toBe(0);
          } else {
            await action(p, "release");
            await phase(p, "ready");
            await action(p, "holdNext");
            await p.clock.runFor(60);
            await phase(p, "completing");
            expect((await counts(p)).complete).toBe(1);
            await expect(
              p.locator('[data-qianzai-screen="result"]'),
            ).toHaveCount(0);
            await action(p, "release");
            await phase(p, "completed");
          }
        } else if (scenario === "unknown-save") {
          await phase(p, "unknown");
          expect(await original!.evaluate((e) => e.isConnected)).toBe(true);
          expect(await port.evaluate((e) => e.scrollTop)).toBe(before);
          const pending = await p.evaluate(() =>
            JSON.stringify(sessionStorage),
          );
          await p.clock.runFor(2000);
          expect(await counts(p)).toEqual({ save: 1, complete: 0 });
          expect(await p.evaluate(() => JSON.stringify(sessionStorage))).toBe(
            pending,
          );
          await p
            .getByRole("button", { name: "核对保存结果", exact: true })
            .click();
          await phase(p, "conflict");
          expect(await port.evaluate((e) => e.scrollTop)).toBe(before);
          await p
            .getByRole("button", {
              name: "采用已核对的服务器进度",
              exact: true,
            })
            .evaluate((e) => (e as HTMLButtonElement).click());
          await readyComplete(p);
          expect(await counts(p)).toEqual({ save: 1, complete: 1 });
        } else {
          await phase(p, "ready");
          await action(p, "dropNext");
          await p.clock.runFor(60);
          await phase(p, "unknown");
          expect((await counts(p)).complete).toBe(1);
          await p.clock.runFor(2000);
          expect((await counts(p)).complete).toBe(1);
          await p
            .getByRole("button", { name: "核对相逢结果", exact: true })
            .evaluate((e) => (e as HTMLButtonElement).click());
          await phase(p, "conflict");
          await p
            .getByRole("button", {
              name: "采用已核对的服务器进度",
              exact: true,
            })
            .evaluate((e) => (e as HTMLButtonElement).click());
          await phase(p, "completed");
          expect((await counts(p)).complete).toBe(1);
        }
      }
      result.push({ name: scenario, passed: true });
      await p.close();
    }
    if (process.env.QZTX_REVIEW_SKIP_PREFERENCE !== "1")
      for (const width of [320, 375, 390, 430]) {
        const p = await browser.newPage({
          viewport: {
            width,
            height:
              width === 320
                ? 568
                : width === 375
                  ? 812
                  : width === 430
                    ? 932
                    : 844,
          },
          reducedMotion: "reduce",
        });
        p.on("pageerror", (e) => errors.push(e.message));
        await p.addInitScript("window.__name=(f)=>f");
        await p.goto(origin);
        await expect(p.locator("[data-view-phase]")).toHaveAttribute(
          "data-view-phase",
          "ready",
        );
        await expect(p.locator('[data-qianzai-screen="cover"]')).toBeVisible();
        await p
          .getByRole("button", { name: "开启穿越之旅", exact: true })
          .click();
        await expect(
          p.locator('[data-qianzai-screen="preference"]'),
        ).toBeVisible();
        await expect(
          p.locator('[data-qianzai-screen="preference"]'),
        ).toHaveAttribute("data-qianzai-composite", "true");
        await p.clock.install();
        await p.clock.pauseAt(new Date(Date.now() + 100));
        await p
          .locator('[data-qianzai-screen="preference"] input[value="female"]')
          .evaluate((e) => (e as HTMLInputElement).click());
        const rect = await p
          .locator(
            '[data-qianzai-screen="preference"] label[data-selected="true"]',
          )
          .boundingBox();
        const frame = await p
          .locator('[data-qianzai-screen="preference"]')
          .boundingBox();
        expect(Math.abs(rect!.width - (frame!.width * 364) / 390)).toBeLessThan(
          1,
        );
        await p
          .locator('[data-qianzai-screen="preference"]')
          .screenshot({ path: path.join(out, `preference-${width}.png`) });
        result.push({ name: `preference-${width}`, passed: true });
        await p.close();
      }
    for (const width of process.env.QZTX_REVIEW_VISUAL_WIDTHS?.split(",")
      .filter(Boolean)
      .map(Number) ?? [320, 390]) {
      const p = await make(width);
      const target = p.locator('[data-qianzai-screen="question"] label').nth(2);
      await target.scrollIntoViewIfNeeded();
      const position = await p.evaluate(() => ({
        page: scrollY,
        inner: document.querySelector(
          '[data-qianzai-screen="question"] [data-qianzai-scroll-region]',
        )!.scrollTop,
      }));
      await target.click();
      expect(
        await p.evaluate(() => ({
          page: scrollY,
          inner: document.querySelector(
            '[data-qianzai-screen="question"] [data-qianzai-scroll-region]',
          )!.scrollTop,
        })),
      ).toEqual(position);
      result.push({ name: `native-choice-no-jump-${width}`, passed: true });
      await p
        .locator('[data-qianzai-screen="question"]')
        .screenshot({ path: path.join(out, `selected-${width}.png`) });
      await p.goto(origin + "/?review-report=reveal");
      await p.clock.runFor(100);
      await expect(
        p.locator('[data-qianzai-screen="result"] [data-qianzai-art-crop]'),
      ).toHaveAttribute("viewBox", "0 0 780 874");
      await p
        .locator('[data-qianzai-screen="result"]')
        .screenshot({ path: path.join(out, `reveal-${width}.png`) });
      await p.clock.resume();
      await p.goto(origin + "/?review-report=report");

      const reportScroll = p
        .locator('[data-qianzai-screen="report"] > div')
        .first();
      await reportScroll.evaluate((e) => (e.scrollTop = e.scrollHeight));
      await p
        .getByRole("button", { name: "保存我的结果", exact: false })
        .click();
      try {
        await expect(p.locator("[data-qianzai-share] img")).toHaveCount(2, {
          timeout: 30000,
        });
      } catch (error) {
        await writeFile(
          path.join(out, `share-failure-${width}.txt`),
          await p.locator("[data-qianzai-share]").innerText(),
        );
        throw error;
      }
      await p.screenshot({ path: path.join(out, `share-${width}.png`) });
      result.push({ name: `selected-reveal-share-${width}`, passed: true });
      await p.close();
    }
    expect(unexpectedWrites).toEqual([]);
    expect(errors).toEqual([]);
    passed = true;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await writeFile(
      path.join(out, "result.json"),
      JSON.stringify(
        {
          passed,
          failure,
          result,
          errors,
          unexpectedWrites,
          scope:
            "isolated synthetic controller/runtime/producer; no author DB or Key",
        },
        null,
        2,
      ),
    );
    await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
