import { chromium, devices } from "@playwright/test";
import { mkdir, readdir, rename } from "node:fs/promises";
const root = process.cwd();
const output = `${root}/docs/qa/d1b`;
const oldOutput = `${root}/.cache/d1b-previous-captures`;
await mkdir(output, { recursive: true });
await mkdir(oldOutput, { recursive: true });
for (const name of await readdir(output)) {
  if (name.endsWith(".png"))
    await rename(`${output}/${name}`, `${oldOutput}/${name}`);
}
const browser = await chromium.launch();
const version = browser.version();
const major = version.split(".")[0];
const baseURL = "http://127.0.0.1:3100";
const experience = `${baseURL}/studies/historical/selected/experience`;
const cover = `${baseURL}/studies/historical/selected/cover`;
const storageKey = "quizforge.d1b.historical-demo.v1";
const records = [];
async function photo(page, state, width, height, extra = {}) {
  if (await page.locator("body").count())
    await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error(`${state} overflows at ${width}`);
  // Normalize the full-page capture origin: offscreen fixed skip links must stay offscreen.
  await page.evaluate(() => window.scrollTo(0, 0));
  const name = `historical-${state}-${width}x${height}-chromium-${major}.png`;
  await page.screenshot({
    path: `${output}/${name}`,
    fullPage: true,
    animations: "disabled",
  });
  records.push({
    name,
    state,
    width,
    height,
    browser: `Chromium ${version}`,
    dpr: 1,
    ua: "Desktop Chrome / CSS viewport",
    ...extra,
  });
}
async function context(options = {}) {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    timezoneId: "Asia/Shanghai",
    ...options,
  });
}
for (const [width, height] of [
  [320, 740],
  [375, 812],
  [390, 844],
  [430, 932],
  [1440, 1000],
]) {
  const ctx = await context({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(cover);
  await photo(page, "cover", width, height);
  await page.getByRole("link", { name: "开始演示答题" }).click();
  await page.getByRole("radio").first().waitFor();
  await photo(page, "question", width, height);
  for (const radio of await page.getByRole("radio").all()) {
    const box = await radio.boundingBox();
    if (!box || box.width < 44 || box.height < 44)
      throw new Error("Option below 44px");
  }
  await page.getByRole("radio").first().click();
  await page.reload();
  await page.getByRole("heading", { name: "上次的思考，仍停在这里" }).waitFor();
  await photo(page, "resume", width, height);
  await ctx.close();
}
{
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(experience);
  for (let i = 0; i < 11; i++) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
  await photo(page, "long-question", 390, 844);
  await page.getByRole("radio").first().press("ArrowDown");
  await photo(page, "keyboard-focus", 390, 844);
  await page.getByRole("button", { name: "核对答卷" }).click();
  await photo(page, "confirm", 390, 844);
  await page.getByRole("button", { name: "确认完成演示" }).click();
  await photo(page, "complete-demo", 390, 844);
  await ctx.close();
}
{
  const ctx = await context({ viewport: { width: 320, height: 740 } });
  const page = await ctx.newPage();
  await page.goto(experience);
  for (let i = 0; i < 11; i++) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
  await page.addStyleTag({
    content: '[role="radiogroup"] strong { font-size: 24px !important; }',
  });
  const fontSize = await page
    .getByRole("radio")
    .first()
    .locator("strong")
    .evaluate((el) => getComputedStyle(el).fontSize);
  if (fontSize !== "24px") throw new Error("Large text fixture did not apply");
  await photo(page, "long-24px", 320, 740, {
    condition: "Actual long question, option font 24px",
  });
  await ctx.close();
}
{
  const ctx = await context();
  await ctx.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key)
        throw new DOMException("Synthetic quota failure", "QuotaExceededError");
      return original.call(this, k, v);
    };
  }, storageKey);
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.getByRole("radio").first().click();
  await page
    .getByRole("status")
    .filter({ hasText: "暂存没有写入浏览器" })
    .waitFor();
  await photo(page, "save-failed", 390, 844, {
    condition: "Actual adapter setItem throws synthetic QuotaExceededError",
  });
  await ctx.close();
}
{
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.evaluate(
    (key) => localStorage.setItem(key, "bad-json"),
    storageKey,
  );
  await page.reload();
  await page.getByRole("button", { name: "丢弃损坏书签，重新开始" }).waitFor();
  await photo(page, "corrupt-recovery", 390, 844);
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: "丢弃损坏书签，重新开始" }).waitFor();
  await photo(page, "corrupt-after-edit", 390, 844);
  await page.getByRole("button", { name: "丢弃损坏书签，重新开始" }).click();
  await page.getByRole("radio").first().click();
  await page.getByText("已暂存到此浏览器", { exact: true }).waitFor();
  await ctx.close();
}
{
  const ctx = await context();
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.getByRole("radio").first().click();
  const other = await ctx.newPage();
  await other.goto(experience);
  await other.evaluate(() => localStorage.clear());
  await page
    .getByRole("status")
    .filter({ hasText: "另一个演示副本" })
    .waitFor();
  await page.getByRole("radio").nth(1).click();
  await page.getByRole("radio").nth(2).click();
  const value = await other.evaluate(
    (key) => localStorage.getItem(key),
    storageKey,
  );
  if (value !== null)
    throw new Error("Conflict protection overwrote external clear");
  await photo(page, "conflict-real-clear", 390, 844, {
    condition:
      "Two actual browser tabs; clear then two edits; storage remains null",
  });
  await ctx.close();
}
{
  const ctx = await context({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.getByRole("radio").first().click();
  const duration = await page
    .locator('[aria-label^="已完成"] i')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  if (parseFloat(duration) > 0.001)
    throw new Error("Reduced motion transition active");
  await photo(page, "reduced-motion", 390, 844, {
    condition: "prefers-reduced-motion: reduce; transition 0s",
  });
  await ctx.close();
}
{
  const ctx = await context();
  await ctx.route("**/jade-landscape.webp", (route) => route.abort());
  const page = await ctx.newPage();
  await page.goto(cover);
  await photo(page, "missing-landscape", 390, 844, {
    condition: "Decorative landscape request aborted; paper and entry retained",
  });
  await ctx.close();
}
{
  const ctx = await context({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.getByText("正在打开演示书卷…").waitFor();
  await photo(page, "loading-ssr", 390, 844, {
    condition:
      "JavaScript disabled to retain pre-hydration loading state; not a remote data failure",
  });
  await ctx.close();
}
{
  const ctx = await context({
    ...devices["Pixel 7"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.goto(experience);
  await page.getByRole("radio").first().click();
  await photo(page, "pixel7-emulation", 390, 844, {
    ua: "Pixel 7 / Android Chrome UA and touch emulation; not physical device",
  });
  await ctx.close();
}
await browser.close();
await import("node:fs/promises").then((fs) =>
  fs.writeFile(
    `${root}/.cache/d1b-capture-records.json`,
    JSON.stringify(records, null, 2),
  ),
);
console.log(
  JSON.stringify({
    captures: records.length,
    browser: version,
    recordsPath: ".cache/d1b-capture-records.json",
  }),
);
