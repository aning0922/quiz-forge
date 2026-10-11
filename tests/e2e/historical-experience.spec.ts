import { expect, test } from "@playwright/test";

const route = "/studies/historical/selected/experience";

test("answers can be selected, cancelled, revised, saved and confirmed without a result", async ({
  page,
}) => {
  await page.goto(route);
  const options = page.getByRole("radio");
  await expect(options).toHaveCount(4);
  await expect(page.getByRole("button", { name: "下一题" })).toBeDisabled();
  await options.nth(0).click();
  await expect(options.nth(0)).toHaveAttribute("aria-checked", "true");
  await options.nth(0).click();
  await expect(options.nth(0)).toHaveAttribute("aria-checked", "false");
  await options.nth(2).click();
  await page.getByRole("button", { name: "下一题" }).click();
  await expect(page.getByText("第 2 题 / 共 12 题")).toBeVisible();
  await page.getByRole("button", { name: "上一题" }).click();
  await expect(page.getByRole("radio").nth(2)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "下一题" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "上次的思考，仍停在这里" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续答题" }).click();
  await expect(page.getByText("第 2 题 / 共 12 题")).toBeVisible();
  expect(await page.locator("main").innerText()).not.toContain("李白");
});

test("save failure, corruption and conflict each tell the user what happened", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByText("查看异常演示").click();
  await page.getByRole("button", { name: "模拟保存失败" }).click();
  await page.getByRole("radio").first().click();
  await expect(page.getByRole("status")).toContainText("暂存没有写入浏览器");
  await page.getByRole("button", { name: "模拟冲突副本" }).click();
  await expect(page.getByRole("status")).toContainText("另一个演示副本");
  await expect(page.getByRole("button", { name: "继续答题" })).toBeDisabled();
  await page.getByRole("button", { name: "放弃并重新开始" }).click();
  await page.getByText("查看异常演示").click();
  await page.getByRole("button", { name: "模拟损坏书签" }).click();
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: "无法读取的演示书签" }),
  ).toBeVisible();
});

test("another tab clearing browser storage pauses this draft before it can overwrite", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("radio").first().click();
  const otherTab = await page.context().newPage();
  await otherTab.goto(route);
  await otherTab.evaluate(() => localStorage.clear());
  await expect(
    page.getByRole("status").filter({ hasText: "另一个演示副本" }),
  ).toBeVisible();
  await page.getByRole("radio").nth(1).click();
  await page.getByRole("radio").nth(2).click();
  await expect(
    page.getByRole("status").filter({ hasText: "另一个演示副本" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      otherTab.evaluate(() =>
        localStorage.getItem("quizforge.d1b.historical-demo.v1"),
      ),
    )
    .toBeNull();
  await expect(page.getByRole("button", { name: "下一题" })).toBeDisabled();
  await otherTab.close();
});

test("a conflict at confirmation cannot delete the other tab's bookmark", async ({
  page,
}) => {
  await page.goto(route);
  for (let i = 0; i < 12; i++) {
    await page.getByRole("radio").first().click();
    await page
      .getByRole("button", { name: i === 11 ? "核对答卷" : "下一题" })
      .click();
  }
  const otherTab = await page.context().newPage();
  await otherTab.goto(route);
  const external = await otherTab.evaluate(() => {
    const key = "quizforge.d1b.historical-demo.v1";
    const value = JSON.stringify({
      version: 1,
      answers: { pace: 2 },
      updatedAt: "2026-10-11T08:00:00.000Z",
    });
    localStorage.setItem(key, value);
    return value;
  });
  await expect(
    page.getByRole("status").filter({ hasText: "另一个演示副本" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认完成演示" }),
  ).toBeDisabled();
  expect(
    await otherTab.evaluate(() =>
      localStorage.getItem("quizforge.d1b.historical-demo.v1"),
    ),
  ).toBe(external);
  await otherTab.close();
});

test("a malformed initial bookmark can be explicitly discarded before saving again", async ({
  page,
}) => {
  await page.goto(route);
  await page.evaluate(() =>
    localStorage.setItem("quizforge.d1b.historical-demo.v1", "bad"),
  );
  await page.reload();
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: "丢弃损坏书签，重新开始" }).click();
  await page.getByRole("radio").first().click();
  await expect(page.getByText("已暂存到此浏览器")).toBeVisible();
});

test("returning to the first question scrolls and focuses its heading", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("radio").first().click();
  await page.getByRole("button", { name: "下一题" }).click();
  await page.getByRole("button", { name: "上一题" }).click();
  await expect(
    page.getByRole("heading", { name: /遇到一项没有现成答案/ }),
  ).toBeFocused();
});

test("mobile long options, keyboard focus and reduced motion remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto(route);
  await page.addStyleTag({
    content: '[role="radiogroup"] strong { font-size: 24px !important; }',
  });
  await expect(page.getByRole("radio").first().locator("strong")).toHaveCSS(
    "font-size",
    "24px",
  );
  for (let i = 0; i < 11; i++) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: "下一题" }).click();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("radio").first().focus();
  await expect(page.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const detailsTarget = page.getByText("查看异常演示");
  await expect(detailsTarget).toHaveJSProperty("offsetHeight", 44);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio").nth(1)).toBeFocused();
  await expect(page.getByRole("radio").nth(1)).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("radio").first()).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await page.getByRole("button", { name: "继续答题" }).click();
  expect(
    parseFloat(
      await page
        .locator('[aria-label^="已完成"] i')
        .evaluate((element) => getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThanOrEqual(0.001);
});

test("captures D1-B review states without changing historical evidence", async ({
  page,
  browser,
}, testInfo) => {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(route);
    await page.screenshot({
      path: `test-results/d1b-regression/${testInfo.project.name}/historical-experience-${viewport.width}x${viewport.height}-chromium-${browser.version().split(".")[0]}-question.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("radio").first().click();
  await page.reload();
  await page.screenshot({
    path: `test-results/d1b-regression/${testInfo.project.name}/historical-experience-390x844-chromium-${browser.version().split(".")[0]}-resume.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "继续答题" }).click();
  await page.getByText("查看异常演示").click();
  await page.getByRole("button", { name: "模拟冲突副本" }).click();
  await page.screenshot({
    path: `test-results/d1b-regression/${testInfo.project.name}/historical-experience-390x844-chromium-${browser.version().split(".")[0]}-conflict.png`,
    fullPage: true,
    animations: "disabled",
  });
});
