import { expect, test, type Page } from "@playwright/test";

const widths = [320, 375, 390, 430, 1440];
const report = (direction: string, variant = "classical") =>
  `/studies/visual-v2/${direction}/report?inscription=${variant}`;
const atlas = (direction: string, sample: string) =>
  `/studies/visual-v2/atlas?direction=${direction}&sample=${sample}`;

async function fits(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const element of await page
    .locator("[data-dimension-id], [data-inscription], [data-poster-tags]")
    .all()) {
    expect(
      await element.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  }
}

for (const direction of ["journey", "collection"]) {
  test(`${direction}: fixed scores, early placement, meter semantics and evidence continuity`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(report(direction));
    await page.evaluate(() => document.fonts.ready);
    const meters = page.getByRole("meter");
    await expect(meters).toHaveCount(5);
    expect(
      await meters.evaluateAll((nodes) =>
        nodes.map((node) => Number(node.getAttribute("aria-valuenow"))),
      ),
    ).toEqual([88, 82, 64, 46, 38]);
    for (const meter of await meters.all()) {
      await expect(meter).toHaveAttribute("aria-valuemin", "0");
      await expect(meter).toHaveAttribute("aria-valuemax", "100");
      await expect(meter).toHaveAttribute("aria-valuetext", /合成示意/);
      const labelled = await meter.getAttribute("aria-labelledby");
      await expect(page.locator(`#${labelled}`)).toBeVisible();
    }
    const first = await meters.first().boundingBox();
    expect(first!.y + first!.height).toBeLessThanOrEqual(844);
    await expect(page.getByText("SYNTHETIC · 固定模拟分数")).toBeVisible();
    const order = await page
      .locator(
        "[data-inscription], [data-result-atlas], #matching, #practice, #footnotes",
      )
      .evaluateAll((nodes) =>
        nodes.map((node) => node.id || node.getAttribute("data-inscription")),
      );
    expect(order).toEqual([
      "classical",
      "character",
      "matching",
      "practice",
      "footnotes",
    ]);
    await page.getByRole("link", { name: "匹配依据", exact: true }).click();
    await expect(page.locator("#matching")).toContainText("自主探索 88 / 100");
    await expect(page.locator("#matching")).toContainText("稳健执行 38 / 100");
    await page.getByText("每把尺，分别读什么？", { exact: true }).click();
    await expect(
      page.getByText("不是创造能力的评分。", { exact: false }),
    ).toBeVisible();
  });

  test(`${direction}: 4, 5 and 7 dimensions preserve all boundary values at five widths`, async ({
    page,
  }) => {
    for (const width of widths) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      for (const [sample, values] of [
        ["four", [0, 50, 100, 0.5]],
        ["five", [88, 82, 64, 46, 38]],
        ["seven", [1, 33.33, 49.99, 50, 50.01, 99.5, 100]],
      ] as const) {
        await page.goto(atlas(direction, sample));
        const meters = page.getByRole("meter");
        await expect(meters).toHaveCount(values.length);
        for (const [i, value] of values.entries()) {
          const meter = meters.nth(i);
          await expect(meter).toHaveAttribute("aria-valuenow", String(value));
          const ratio = await meter.evaluate(
            (el) =>
              (el.firstElementChild!.getBoundingClientRect().width /
                el.getBoundingClientRect().width) *
              100,
          );
          expect(Math.abs(ratio - value)).toBeLessThan(0.06);
        }
        await fits(page);
      }
    }
  });

  test(`${direction}: long dimension descriptions and 24px reading text remain complete`, async ({
    page,
  }) => {
    await page.goto(atlas(direction, "long"));
    await page.addStyleTag({
      content:
        "[data-result-atlas] :is(h2,h3,p,summary,dt,dd) {font-size:24px !important;}",
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await fits(page);
      await expect(page.getByRole("meter")).toHaveCount(7);
      for (const heading of await page.locator("[data-dimension-id] h3").all())
        expect(
          await heading.evaluate(
            (el) => el.scrollHeight <= el.clientHeight + 1,
          ),
        ).toBe(true);
    }
  });

  test(`${direction}: real attribution, original disclosure, optional verse and poster continuity`, async ({
    page,
  }) => {
    for (const variant of ["classical", "original", "none"]) {
      await page.goto(report(direction, variant));
      if (variant === "none")
        await expect(page.locator("[data-inscription]")).toHaveCount(0);
      else {
        const verse = page.locator("[data-inscription]");
        await expect(verse).toHaveAttribute("data-inscription", variant);
        await verse.locator("summary").click();
        if (variant === "classical") {
          await expect(verse).toContainText("李白《行路难·其一》");
          await expect(verse.getByRole("link")).toHaveAttribute(
            "href",
            "https://sxss.ntu.edu.cn/2018/0301/c6266a165818/page.htm",
          );
        } else {
          await expect(verse).toContainText("原创拟古");
          await expect(verse).toContainText("非古诗引用");
          await expect(verse).not.toContainText("李白");
        }
        await expect(verse).toContainText("未按答题或分数动态选择");
      }
      await page.getByRole("link", { name: "查看收藏海报" }).click();
      const plate = page.locator("[data-character-plate]");
      await expect(plate.locator("[data-poster-tags] > span")).toHaveCount(2);
      await expect(plate).toContainText("88");
      await expect(plate).toContainText("82");
      if (variant === "original") await expect(plate).toContainText("原创拟古");
      if (variant === "classical")
        await expect(plate).toContainText("李白《行路难·其一》");
      for (const width of widths) {
        await page.setViewportSize({ width, height: 844 });
        await fits(page);
        const frame = await plate.boundingBox();
        expect(frame!.width / frame!.height).toBeCloseTo(
          direction === "journey" ? 3 / 4 : 2 / 3,
          2,
        );
        expect(
          await plate.evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
        ).toBe(true);
        const boxes = await plate.evaluate((el) => ({
          plate: el.getBoundingClientRect().toJSON(),
          text: [...el.querySelectorAll("h1,h2,p,[data-poster-tags]")].map(
            (t) => t.getBoundingClientRect().toJSON(),
          ),
        }));
        for (const b of boxes.text) {
          expect(b.right).toBeLessThanOrEqual(boxes.plate.right + 1);
          expect(b.bottom).toBeLessThanOrEqual(boxes.plate.bottom + 1);
        }
      }
      await page.getByRole("link", { name: "返回报告", exact: true }).click();
      if (variant !== "classical")
        await expect(page).toHaveURL(new RegExp(`inscription=${variant}`));
    }
  });

  test(`${direction}: enlarged verse, contrast and reduced motion stay readable`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(report(direction));
    await page.locator("[data-inscription] summary").click();
    await page.addStyleTag({
      content:
        "[data-inscription] :is(p,summary,a) {font-size:24px !important;}",
    });
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await fits(page);
    }
    const contrasts = await page
      .locator("[data-result-atlas]")
      .evaluate((root) => {
        const luminance = (color: string) => {
          const c = color
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number)
            .map((n) => {
              const s = n / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
          return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
        };
        const ratio = (a: string, b: string) => {
          const x = luminance(a),
            y = luminance(b);
          return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
        };
        const rows = [...root.querySelectorAll("[data-dimension-id]")];
        return rows.map((row) => {
          const gauge = row.querySelector('[role="meter"]')!;
          const fill = gauge.firstElementChild!;
          const bg = getComputedStyle(row).backgroundColor;
          const surface = bg === "rgba(0, 0, 0, 0)" ? "rgb(246, 241, 231)" : bg;
          return {
            title: ratio(
              getComputedStyle(row.querySelector("h3")!).color,
              surface,
            ),
            body: ratio(
              getComputedStyle(row.querySelector('[id^="interpretation"]')!)
                .color,
              surface,
            ),
            bar: ratio(
              getComputedStyle(fill).backgroundColor,
              getComputedStyle(gauge).backgroundColor,
            ),
            animation: getComputedStyle(fill).animationName,
          };
        });
      });
    for (const result of contrasts) {
      expect(result.title).toBeGreaterThanOrEqual(4.5);
      expect(result.body).toBeGreaterThanOrEqual(4.5);
      expect(result.bar).toBeGreaterThanOrEqual(3);
      expect(result.animation).toBe("none");
    }
  });
}

test("unknown research presets are rejected rather than silently selecting a result", async ({
  page,
}) => {
  expect(
    (await page.goto("/studies/visual-v2/atlas?sample=untrusted"))!.status(),
  ).toBe(404);
  expect(
    (await page.goto(
      "/studies/visual-v2/journey/report?inscription=unverified",
    ))!.status(),
  ).toBe(404);
});
