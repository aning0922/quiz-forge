import { expect, test, type Page } from "@playwright/test";

const root = "/studies/visual-v2-c";
const question = `${root}/question`;

async function answerThrough(page: Page, count: number) {
  for (let index = 0; index < count; index += 1) {
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /^(下一题|核对答卷)$/ }).click();
  }
}

test("D1-C keeps the four halls, restore, confirm editing and reveal chain usable", async ({
  page,
}) => {
  await page.goto(question);
  const shell = page.locator("[data-cabinet-questions]");
  await answerThrough(page, 3);
  await expect(shell).toHaveAttribute("data-room", "1");
  await page.reload();
  await page.getByRole("button", { name: "继续探馆" }).click();
  await answerThrough(page, 9);
  await expect(page.getByRole("heading", { name: /行记齐备/ })).toBeVisible();
  await page.getByRole("button", { name: "返回修改回答" }).click();
  await expect(
    page.getByRole("heading", { name: /告别一段重要经历/ }),
  ).toBeVisible();
  await page.getByRole("radio").nth(1).click();
  await page.getByRole("button", { name: "核对答卷" }).click();
  await page.getByRole("button", { name: "查看合成揭晓" }).click();
  await expect(page).toHaveURL(/\/reveal$/);
});

test("D1-C report anchors receive focus and mobile viewports do not overflow", async ({
  page,
}) => {
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${root}/report`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("link", { name: "匹配依据" }).click();
  await expect(page.locator("#matching")).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${root}/report`);
  await expect(page.locator('[data-v2c="report"]')).toBeVisible();
});
