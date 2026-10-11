import { expect, test, type Locator, type Page } from "@playwright/test";

const directions = ["landscape", "celestial"] as const;
const widths = [320, 375, 390, 430, 1440] as const;
const scoreValues = [88, 82, 64, 46, 38];

const route = (
  direction: (typeof directions)[number],
  view: "reveal" | "report" | "poster",
  query = "",
) => `/studies/visual-v2-b/${direction}/${view}${query}`;

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function expectVisibleTextFits(locator: Locator) {
  for (const node of await locator.all()) {
    await expect(node).toBeVisible();
    expect(
      await node.evaluate((element) => {
        const style = getComputedStyle(element);
        const isVisibleHorizontally =
          style.overflowX === "visible" ||
          Math.ceil(element.scrollWidth) <= Math.ceil(element.clientWidth) + 1;
        const isVisibleVertically =
          style.overflowY === "visible" ||
          Math.ceil(element.scrollHeight) <=
            Math.ceil(element.clientHeight) + 1;
        return isVisibleHorizontally && isVisibleVertically;
      }),
    ).toBe(true);
  }
}

async function expectIdentityArtContrast(page: Page) {
  const ratio = await page
    .locator("article[aria-label]")
    .evaluate((article) => {
      const foreground = getComputedStyle(
        article.querySelector("[data-art-identity]")!,
      ).color;
      const background = getComputedStyle(
        article.querySelector("[data-artwork]")!,
      ).backgroundColor;
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.04045
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
        return (
          0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
        );
      };
      const left = luminance(foreground);
      const right = luminance(background);
      return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
    });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const direction of directions) {
  test(`${direction}: reveal establishes the character, complete art and verse as one composition`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route(direction, "reveal"));
    await expect(page.locator("[data-v2b]")).toHaveAttribute(
      "data-direction",
      direction,
    );
    await expect(page.locator("[data-v2b]")).toHaveAttribute(
      "data-view",
      "reveal",
    );

    const composition = page.locator("article[aria-label]");
    const artwork = page.locator("[data-artwork]");
    await expect(composition).toBeVisible();
    await expect(artwork).toBeVisible();
    const identity = composition.locator("[data-art-identity]");
    await expect(identity).toContainText("李白");
    await expect(composition.getByRole("heading", { level: 2 })).toContainText(
      "浪漫自由的行路者",
    );
    await expect(composition.locator("[data-art-verse]")).toContainText(
      "长风破浪会有时",
    );
    await expect(composition.locator("[data-art-verse]")).toContainText(
      "直挂云帆济沧海",
    );

    const image = artwork.locator("[data-art-image]");
    await expect(image).toBeVisible();
    expect(
      await image.evaluate(
        (element) =>
          element instanceof HTMLImageElement &&
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    ).toBe(true);
    expect(
      await artwork.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return box.width / box.height;
      }),
    ).toBeCloseTo(2 / 3, 2);
    expect(
      await image.evaluate((element) => getComputedStyle(element).objectFit),
    ).not.toBe("cover");
    await expectNoOverflow(page);
  });

  test(`${direction}: report retains synthetic scores and gives the atlas a readable secondary hierarchy`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route(direction, "report"));
    await expect(page.locator("[data-v2b]")).toHaveAttribute(
      "data-view",
      "report",
    );
    await expect(page.locator("[data-artwork]")).toBeVisible();
    await expect(page.locator("[data-report-transition]")).toBeVisible();
    const atlas = page.locator("[data-result-atlas]");
    await expect(atlas).toBeVisible();
    const meters = atlas.getByRole("meter");
    await expect(meters).toHaveCount(5);
    for (const [index, score] of scoreValues.entries()) {
      await expect(meters.nth(index)).toHaveAttribute("aria-valuemin", "0");
      await expect(meters.nth(index)).toHaveAttribute("aria-valuemax", "100");
      await expect(meters.nth(index)).toHaveAttribute(
        "aria-valuenow",
        String(score),
      );
      await expect(meters.nth(index)).toHaveAttribute(
        "aria-valuetext",
        /合成示意/,
      );
    }
    await expect(atlas).toContainText("SYNTHETIC");
    const order = await page
      .locator("article[aria-label], [data-report-transition]")
      .evaluateAll((nodes) =>
        nodes.map(
          (node) => node.getAttribute("data-report-transition") ?? "art",
        ),
      );
    expect(order).toEqual(["art", "true"]);
    await expectNoOverflow(page);
  });

  test(`${direction}: reveal, report and poster stay complete from 320px through desktop`, async ({
    page,
  }) => {
    for (const width of widths) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      for (const view of ["reveal", "report", "poster"] as const) {
        await page.goto(route(direction, view));
        await expect(page.locator("[data-v2b]")).toHaveAttribute(
          "data-view",
          view,
        );
        await expect(page.locator("[data-artwork]")).toBeVisible();
        await expectNoOverflow(page);
        await expectVisibleTextFits(
          page.locator(
            "[data-art-identity], [data-art-verse], [data-result-atlas] h2, [data-result-atlas] h3",
          ),
        );
      }
    }
  });

  test(`${direction}: inscription variants and explicit long-content stress state remain honest`, async ({
    page,
  }) => {
    for (const query of [
      "",
      "?inscription=original",
      "?inscription=none",
      "?sample=long",
    ]) {
      await page.setViewportSize({ width: 320, height: 740 });
      await page.goto(route(direction, "report", query));
      if (query.includes("none"))
        await expect(page.locator("[data-art-verse]")).toHaveCount(0);
      else await expect(page.locator("[data-art-verse]")).toBeVisible();
      if (query.includes("original")) {
        await expect(page.locator("[data-art-verse]")).toContainText(
          "原创拟古",
        );
        await expect(page.locator("[data-art-verse]")).toContainText(
          "非古诗引用",
        );
      }
      await expectNoOverflow(page);
      await expectVisibleTextFits(
        page.locator(
          "[data-art-identity], article h2, [data-art-verse], [data-result-atlas] h3",
        ),
      );
    }
  });

  test(`${direction}: reduced motion disables decorative motion without removing content`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route(direction, "reveal"));
    await expect(page.locator("[data-artwork]")).toBeVisible();
    const motion = await page.locator("[data-artwork]").evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("*")].map((element) => ({
        animation: getComputedStyle(element).animationName,
        transition: getComputedStyle(element).transitionDuration,
      })),
    );
    expect(motion.every((style) => style.animation === "none")).toBe(true);
    expect(
      motion.every((style) => Number.parseFloat(style.transition) <= 0.001),
    ).toBe(true);
  });

  test(`${direction}: unavailable art is disclosed instead of presenting an empty result`, async ({
    page,
  }) => {
    await page.route(
      `**/assets/themes/historical/visual-v2-b/li-bai-${direction}.webp`,
      (route) => route.abort(),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route(direction, "reveal"));
    await expect(
      page.locator('[data-artwork-state="unavailable"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-artwork-state="unavailable"]'),
    ).toContainText("画作暂未呈现");
    await expectIdentityArtContrast(page);
    await expectNoOverflow(page);
  });

  test(`${direction}: an in-flight artwork request keeps an honest loading state until the asset is ready`, async ({
    page,
  }) => {
    let releaseImage: () => void = () => {};
    const imageGate = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    await page.route(
      `**/assets/themes/historical/visual-v2-b/li-bai-${direction}.webp`,
      async (route) => {
        await imageGate;
        await route.continue();
      },
    );
    await page.goto(route(direction, "reveal"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator('[data-artwork-state="loading"]')).toBeVisible();
    await expect(page.locator('[data-artwork-state="loading"]')).toContainText(
      "画作正在展开",
    );
    await expect(page.locator("[data-art-identity]")).toContainText("李白");
    await expectIdentityArtContrast(page);
    releaseImage();
    await expect(page.locator('[data-artwork-state="ready"]')).toBeVisible();
  });

  test(`${direction}: 24px art titles and verse wrap without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(route(direction, "report", "?sample=long"));
    await page.addStyleTag({
      content:
        "article h2, [data-art-verse] blockquote { font-size: 24px !important; }",
    });
    await expectNoOverflow(page);
    for (const text of await page
      .locator("article h2, [data-art-verse] blockquote")
      .all()) {
      expect(
        await text.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      ).toBe(true);
    }
  });

  test(`${direction}: navigation is a closed, truthful loop and the collectible itself has no web controls`, async ({
    page,
  }) => {
    await page.goto(route(direction, "reveal"));
    await page
      .getByRole("link", {
        name: direction === "landscape" ? "展开性情长卷" : "翻阅人物图鉴",
      })
      .click();
    await expect(page).toHaveURL(/\/report(?:\?.*)?$/);
    await page.getByRole("link", { name: "欣赏收藏画作" }).click();
    await expect(page).toHaveURL(/\/poster(?:\?.*)?$/);
    const collectible = page.locator("[data-collectible]");
    await expect(collectible).toBeVisible();
    await expect(collectible.getByRole("button")).toHaveCount(0);
    await expect(collectible.getByRole("link")).toHaveCount(0);
    await expect(collectible.locator("nav")).toHaveCount(0);
    await page.getByRole("link", { name: "返回人物报告" }).click();
    await expect(page).toHaveURL(/\/report(?:\?.*)?$/);
    await page.getByRole("link", { name: "阅读完整报告" }).click();
    await expect(page).toHaveURL(/\/studies\/visual-v2\//);
  });
}

test("Visual V2-B leaves the Visual V2-A baseline available and routes reject unknown visual variants", async ({
  page,
}) => {
  await expect(
    page.goto("/studies/visual-v2/journey/reveal"),
  ).resolves.toBeTruthy();
  await expect(page.locator("[data-v2b]")).toHaveCount(0);
  expect(
    (await page.goto("/studies/visual-v2-b/untrusted/reveal"))?.status(),
  ).toBe(404);
  expect(
    (await page.goto("/studies/visual-v2-b/landscape/untrusted"))?.status(),
  ).toBe(404);
});
