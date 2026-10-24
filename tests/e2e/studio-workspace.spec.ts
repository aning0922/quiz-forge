import { test, expect, type Page } from "@playwright/test";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

type PrivateFixture = { operator: string; readOnly: string };
let fixture: PrivateFixture;
let prepared = false;
const runId = randomUUID();
const helper = path.resolve("tests/db/p2b1-e2e-fixture.ts");
const execute = promisify(execFile);

async function fixtureCommand(mode: "prepare" | "cleanup") {
  try {
    await execute(
      process.execPath,
      ["--conditions=react-server", "--import", "tsx", helper, mode, runId],
      { cwd: process.cwd(), env: process.env, timeout: 30000, maxBuffer: 4096 },
    );
  } catch {
    throw new Error("WORKSPACE_E2E_FIXTURE_FAILED");
  }
}

async function readFixture(): Promise<PrivateFixture> {
  try {
    const configFile = process.env.QUIZFORGE_P2A_CONFIG;
    if (!configFile || !path.isAbsolute(configFile)) throw new Error();
    const file = await open(
      path.join(path.dirname(configFile), "workspace-e2e-fixture.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        (info.mode & 0o777) !== 0o600 ||
        info.uid !== process.getuid?.() ||
        info.size > 4096
      )
        throw new Error();
      const bytes = Buffer.alloc(4097);
      let length = 0;
      while (length < bytes.length) {
        const part = await file.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (part.bytesRead === 0) break;
        length += part.bytesRead;
      }
      if (length > 4096) throw new Error();
      const value: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, length),
        ),
      );
      if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).length !== 4 ||
        !("version" in value) ||
        value.version !== 1 ||
        !("runId" in value) ||
        value.runId !== runId ||
        !("operator" in value) ||
        !("readOnly" in value) ||
        typeof value.operator !== "string" ||
        typeof value.readOnly !== "string" ||
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.operator) ||
        !/^qfo_p2a_[A-Za-z0-9_-]{43}$/.test(value.readOnly)
      )
        throw new Error();
      return { operator: value.operator, readOnly: value.readOnly };
    } finally {
      await file.close();
    }
  } catch {
    throw new Error("WORKSPACE_E2E_FIXTURE_UNAVAILABLE");
  }
}

// Avoid locator.fill(secret): its failure call log can print the value even with tracing off.
async function enterCredential(page: Page, credential: string): Promise<void> {
  try {
    await page.evaluate((value) => {
      const input = document.getElementById("studio-credential");
      if (!(input instanceof HTMLInputElement) || input.disabled)
        throw new Error("INPUT_UNAVAILABLE");
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (!setter) throw new Error("INPUT_UNAVAILABLE");
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, credential);
  } catch {
    throw new Error("WORKSPACE_E2E_INPUT_UNAVAILABLE");
  }
}

test.beforeAll(async () => {
  await fixtureCommand("prepare");
  prepared = true;
  fixture = await readFixture();
});
test.afterAll(async () => {
  if (prepared) await fixtureCommand("cleanup");
});

async function navigateStudio(
  page: Page,
  name: "工作区" | "类目与标签" | "身份与退出",
) {
  // Directory business regression also keeps the supported legacy deep link.
  if (name === "类目与标签") {
    await page.goto("/studio/taxonomy");
    return;
  }
  const link = page.getByRole("link", {
    name: name === "工作区" ? "测评管理" : name,
    exact: true,
  });
  if (!(await link.isVisible()))
    await page.getByText("Studio 导航", { exact: true }).click();
  await expect(link).toHaveCount(1);
  await link.click();
}

async function openEditor(page: Page) {
  const form = page.getByRole("form", { name: "测评信息", exact: true });
  if (!(await form.isVisible()))
    await page.getByText("编辑测评信息", { exact: true }).click();
  await expect(form).toBeVisible();
}

async function openCreate(page: Page) {
  await page.getByRole("link", { name: "创建测评", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/new-product$/);
  await expect(
    page.getByRole("heading", { name: "创建测评", exact: true }),
  ).toBeVisible();
}

async function signIn(page: Page, role: "operator" | "readOnly" = "operator") {
  await page.goto("/studio/login");
  await expect(page.getByLabel("运营凭证")).toBeEnabled();
  await enterCredential(page, fixture[role]);
  await page.getByRole("button", { name: "登录 Studio" }).click();
  await expect(page).not.toHaveURL(/\/studio\/login$/);
  await navigateStudio(page, "工作区");
  await expect(page.getByRole("heading", { name: "测评管理" })).toBeVisible();
}

// The root runs this project only after studio-auth, with a real migrated test DB.
test("empty workspace and responsive read-only navigation", async ({
  page,
}, testInfo) => {
  await signIn(page, "readOnly");
  await expect(page.getByText("尚无测评", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建测评", exact: true }),
  ).toHaveCount(0);
  for (const width of [1440, 320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    const navigation = page.getByRole("navigation", {
      name: "Studio 导航",
      exact: true,
    });
    const toggle = page.getByText("Studio 导航", { exact: true });
    if (width < 960) {
      await expect(toggle).toBeVisible();
      if (await navigation.isVisible()) await toggle.click();
      await expect(navigation).toBeHidden();
      await toggle.focus();
      await page.keyboard.press("Enter");
    } else {
      await expect(toggle).toBeHidden();
      expect(
        await page
          .locator("main")
          .evaluate((element) => element.getBoundingClientRect().width),
      ).toBeGreaterThan(900);
    }
    await expect(navigation).toBeVisible();
    for (const name of ["工作台", "测评管理", "内测运营", "系统设置"]) {
      const link = navigation.getByRole("link", { name, exact: true });
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(
        1,
      );
      expect(
        await link.evaluate(
          (element) =>
            element.getBoundingClientRect().height >= 44 &&
            element.getBoundingClientRect().width >= 44,
        ),
      ).toBe(true);
    }
    await expect(
      navigation.getByRole("link", { name: "测评管理", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-empty-read-only-${width}.png`),
      fullPage: true,
    });
  }
  await navigateStudio(page, "身份与退出");
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "运营登录" })).toBeVisible();
});

async function openProductDetail(page: Page) {
  await page
    .getByRole("link", {
      name: /^查看测评 .*（编号 e2e-workspace）$/,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/studio\/products\/e2e-workspace$/);
  // Wait for the actual overview instead of requiring collapsed support fields.
  await expect(
    page.getByRole("link", { name: "查看内容与修订", exact: true }),
  ).toBeVisible();
  if (await page.getByText("编辑测评信息", { exact: true }).count())
    await openEditor(page);
}

async function createDirectory(
  page: Page,
  kind: "category" | "tag",
  slug: string,
  name: string,
) {
  await page
    .getByRole("button", {
      name: kind === "category" ? "管理分类" : "管理标签",
      exact: true,
    })
    .click();
  await page.getByLabel("名称", { exact: true }).fill(name);
  await page.getByLabel("英文标识", { exact: true }).fill(slug);
  await page
    .getByRole("button", {
      name: kind === "category" ? "创建分类" : "创建标签",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("article", {
      name: `${kind === "category" ? "分类" : "标签"} ${slug}`,
      exact: true,
    }),
  ).toBeVisible();
}

const longTitle =
  "这是用于移动端检查的合成长标题：一段可以自然换行且不会挤出屏幕的工作区显示文本";

test("operator creates taxonomy and product, checks 8 tags, filters and safe mobile UI", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await openCreate(page);
  for (const label of ["分类", "标签"]) {
    const picker = page.getByRole("region", {
      name: `${label}选择`,
      exact: true,
    });
    await expect(
      picker.getByText(`暂无可选${label}，可暂不设置。`, { exact: true }),
    ).toBeVisible();
    await expect(picker.getByRole("textbox")).toHaveCount(0);
    await expect(
      picker.getByRole("navigation", { name: "分页", exact: true }),
    ).toHaveCount(0);
    await expect(
      picker.getByRole("button", { name: `重新读取${label}`, exact: true }),
    ).toBeEnabled();
    await expect(
      picker.getByRole("link", {
        name: "管理分类与标签（新标签页）",
        exact: true,
      }),
    ).toHaveAttribute("target", "_blank");
  }
  await navigateStudio(page, "类目与标签");
  await createDirectory(page, "category", "e2e-category-one", "同名目录");
  await createDirectory(page, "category", "e2e-category-two", "同名目录");
  for (let index = 1; index <= 9; index++)
    await createDirectory(page, "tag", `e2e-tag-${index}`, `合成标签${index}`);
  await navigateStudio(page, "工作区");
  await expect(
    page.getByRole("form", { name: "新建测评", exact: true }),
  ).toHaveCount(0);
  await openCreate(page);
  for (const width of [320, 375, 390, 430, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`workspace-create-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByLabel("测评编号（需与内容包一致）", { exact: true })
    .fill("e2e-workspace");
  await page.getByLabel("测评名称", { exact: true }).fill(longTitle);
  await page.getByLabel("测评英文标识", { exact: true }).fill("e2e-workspace");
  const createForm = page.getByRole("form", {
    name: "新建测评",
    exact: true,
  });
  const categoryPicker = createForm.getByRole("region", {
    name: "分类选择",
    exact: true,
  });
  await categoryPicker
    .getByLabel("搜索分类名称或英文标识", { exact: true })
    .fill("no-matching-category");
  await categoryPicker
    .getByRole("button", { name: "搜索分类", exact: true })
    .click();
  await expect(
    categoryPicker.getByText("没有符合搜索条件的分类，请更换关键词。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    categoryPicker.getByLabel("搜索分类名称或英文标识", { exact: true }),
  ).toBeVisible();
  await categoryPicker
    .getByLabel("搜索分类名称或英文标识", { exact: true })
    .fill("");
  await categoryPicker
    .getByRole("button", { name: "搜索分类", exact: true })
    .click();
  await createForm
    .getByLabel("同名目录 · e2e-category-one", { exact: true })
    .check();
  for (let index = 1; index <= 8; index++)
    await createForm
      .getByLabel(`合成标签${index} · e2e-tag-${index}`, { exact: true })
      .check();
  await expect(
    createForm.getByLabel("合成标签9 · e2e-tag-9", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "创建测评", exact: true }).click();
  await expect(page).toHaveURL(/\/studio\/products\/e2e-workspace$/);
  await expect(
    page.getByRole("heading", { name: longTitle, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "测评信息", exact: true }),
  ).toBeHidden();
  await openEditor(page);
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByLabel("测评名称", { exact: true })
        .evaluate(
          (element) =>
            parseFloat(getComputedStyle(element).fontSize) >= 16 &&
            element.getBoundingClientRect().height >= 44,
        ),
    ).toBe(true);
    const removeButtons = page.getByRole("button", {
      name: /^移除(分类|标签) /,
    });
    await expect(removeButtons).toHaveCount(9);
    for (const button of await removeButtons.all()) {
      expect(
        await button.evaluate(
          (element) =>
            getComputedStyle(element).whiteSpace === "nowrap" &&
            element.getBoundingClientRect().height >= 44 &&
            element.getBoundingClientRect().width >= 44,
        ),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`workspace-detail-${width}.png`),
      fullPage: true,
    });
  }
  await navigateStudio(page, "工作区");
  await expect(
    page.getByRole("link", {
      name: /^查看测评 .*（编号 e2e-workspace）$/,
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("workspace-list-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("更多筛选", { exact: true }).click();
  const unclassified = page.getByRole("checkbox", {
    name: "仅未分类测评",
    exact: true,
  });
  await unclassified.check();
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.getByText("当前筛选无结果", { exact: true })).toBeVisible();
  await page.getByText("更多筛选", { exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "当前：" }),
  ).toContainText("仅未分类");
  await page.getByText("更多筛选", { exact: true }).click();
  await expect(unclassified).toBeChecked();
  await unclassified.uncheck();
  await page.getByLabel("搜索测评名称或编号").fill("不存在的合成筛选");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.getByText("当前筛选无结果", { exact: true })).toBeVisible();
  await page.getByLabel("搜索测评名称或编号").fill("e2e-workspace");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: /^查看测评 .*（编号 e2e-workspace）$/,
      exact: true,
    }),
  ).toBeVisible();
});

test("catalog filters restore through URL reload and Back/Forward, while invalid addresses never query products", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("搜索测评名称或编号").fill("e2e-workspace");
  await page.getByLabel("归档状态", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("e2e-workspace");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("status"))
    .toBe("all");
  await page.reload();
  await expect(page.getByLabel("搜索测评名称或编号")).toHaveValue(
    "e2e-workspace",
  );
  await expect(page.getByLabel("归档状态", { exact: true })).toHaveValue("all");
  await expect(
    page.getByRole("link", { name: /^查看测评 .*（编号 e2e-workspace）$/ }),
  ).toBeVisible();
  await page.getByLabel("搜索测评名称或编号").fill("不存在的合成URL筛选");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(page.getByText("当前筛选无结果", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("搜索测评名称或编号")).toHaveValue(
    "e2e-workspace",
  );
  await expect(
    page.getByRole("link", { name: /^查看测评 .*（编号 e2e-workspace）$/ }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("搜索测评名称或编号")).toHaveValue(
    "不存在的合成URL筛选",
  );
  await expect(page.getByText("当前筛选无结果", { exact: true })).toBeVisible();
  let productReads = 0;
  const countRead = (request: import("@playwright/test").Request) => {
    if (new URL(request.url()).pathname === "/api/studio/products")
      productReads++;
  };
  page.on("request", countRead);
  await page.goto("/studio/products?page=01&status=all&status=active");
  await expect(
    page.getByRole("heading", { name: "无法使用此列表地址", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("无效或重复");
  expect(productReads).toBe(0);
  await expect(
    page.getByRole("button", { name: "重置筛选并查看测评", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "重置筛选并查看测评", exact: true })
    .click();
  await expect(page).toHaveURL(/\/studio\/products$/);
  await expect(page.getByLabel("搜索测评名称或编号")).toHaveValue("");
  page.off("request", countRead);
});

// Executes a real second writer without exposing session CSRF or cookies to assertions/output.
async function externalTitleChange(page: Page, title: string) {
  try {
    return await page.evaluate(async (value) => {
      const sessionResponse = await fetch("/api/studio/auth/session", {
        cache: "no-store",
      });
      const currentResponse = await fetch(
        "/api/studio/products/e2e-workspace",
        { cache: "no-store" },
      );
      if (!sessionResponse.ok || !currentResponse.ok) throw new Error();
      const session = await sessionResponse.json();
      const current = await currentResponse.json();
      const saved = await fetch("/api/studio/products/e2e-workspace", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: JSON.stringify({
          expectedMetadataRevision: current.metadataRevision,
          slug: current.slug,
          title: value,
          primaryCategoryId: current.primaryCategory?.id ?? null,
          tagIds: current.tags.map((tag: { id: string }) => tag.id),
        }),
      });
      return saved.status;
    }, title);
  } catch {
    throw new Error("WORKSPACE_E2E_SECOND_WRITER_FAILED");
  }
}

test("creating directory records preserves another row's draft and unknown outcome", async ({
  page,
}) => {
  await signIn(page);
  await navigateStudio(page, "类目与标签");
  const row = page.getByRole("article", {
    name: "分类 e2e-category-two",
    exact: true,
  });
  const name = row.getByLabel("显示名称 · e2e-category-two", { exact: true });
  await name.fill("保留的目录输入");
  await expect(
    page.getByRole("button", { name: "管理标签", exact: true }),
  ).toBeDisabled();

  async function create(slug: string) {
    await page.getByLabel("名称", { exact: true }).fill(`合成新增 ${slug}`);
    await page.getByLabel("英文标识", { exact: true }).fill(slug);
    const response = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/studio/categories" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "创建分类", exact: true }).click();
    expect((await response).status()).toBe(201);
    await expect(
      page.getByText(
        "新目录已提交。当前列表有未保存或待核实内容，暂不刷新；处理完毕后可刷新查看新目录。",
        { exact: true },
      ),
    ).toBeVisible();
  }
  await create("e2e-during-draft");
  await expect(name).toHaveValue("保留的目录输入");
  await expect(
    page.getByRole("article", { name: "分类 e2e-during-draft", exact: true }),
  ).toHaveCount(0);
  // An attempted filter must not evict the dirty row either.
  await page.getByLabel("搜索名称或英文标识").fill("e2e-during-draft");
  await page.getByRole("button", { name: "应用筛选", exact: true }).click();
  await expect(name).toHaveValue("保留的目录输入");

  const inputId = await name.getAttribute("id");
  if (!inputId || !/^name-[0-9a-f-]{36}$/.test(inputId))
    throw new Error("WORKSPACE_E2E_DIRECTORY_ID_UNAVAILABLE");
  const id = inputId.slice(5);
  let lost = false;
  await page.route(`**/api/studio/categories/${id}`, async (route) => {
    if (route.request().method() !== "PATCH" || lost) {
      await route.continue();
      return;
    }
    lost = true;
    try {
      await route.fetch();
    } catch {
      throw new Error("WORKSPACE_E2E_RESPONSE_LOSS_SETUP_FAILED");
    }
    await route.abort("failed");
  });
  await row.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(
    row.getByRole("heading", { name: "提交结果尚未确认", exact: true }),
  ).toBeVisible();
  await create("e2e-during-unknown");
  await expect(name).toHaveValue("保留的目录输入");
  await expect(
    row.getByRole("heading", { name: "提交结果尚未确认", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("button", { name: "保存名称", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "分类 e2e-during-unknown", exact: true }),
  ).toHaveCount(0);

  await row
    .getByRole("button", { name: "读取服务器最新内容", exact: true })
    .click();
  await expect(
    row.getByText("保留的目录输入 · e2e-category-two", { exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: "采用服务器内容", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "管理标签", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "刷新目录", exact: true }).click();
  await expect(
    page.getByRole("article", { name: "分类 e2e-during-draft", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: "分类 e2e-during-unknown", exact: true }),
  ).toBeVisible();
});

test("CAS preserves unsaved input and requires an explicit latest revision resubmission", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await openProductDetail(page);
  const editor = page.getByRole("form", { name: "测评信息", exact: true });
  const title = editor.getByLabel("测评名称", { exact: true });
  await title.fill("我的未保存输入");
  await page.getByText("编辑测评信息", { exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.locator('form[aria-label="测评信息"]')).toHaveCount(1);
  await openEditor(page);
  await expect(title).toHaveValue("我的未保存输入");
  expect(await externalTitleChange(page, "第二写者标题")).toBe(200);
  await editor
    .getByRole("button", { name: "保存测评信息", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "内容发生冲突", exact: true }),
  ).toBeVisible();
  await expect(title).toHaveValue("我的未保存输入");
  await expect(
    editor.getByRole("button", { name: "保存测评信息", exact: true }),
  ).toBeDisabled();
  await page.getByText("编辑测评信息", { exact: true }).click();
  await expect(page.locator('form[aria-label="测评信息"]')).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: "内容发生冲突", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-conflict.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "读取服务器最新内容", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "第二写者标题", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "保留我的输入，以最新修订重提", exact: true })
    .click();
  await openEditor(page);
  await expect(title).toHaveValue("我的未保存输入");
  await editor
    .getByRole("button", { name: "保存测评信息", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "我的未保存输入", exact: true }),
  ).toBeVisible();
});

test("lost write response is reconciled by reading and archival has a visible restore path", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await openProductDetail(page);
  let lost = false;
  await page.route("**/api/studio/products/e2e-workspace", async (route) => {
    if (route.request().method() !== "PATCH" || lost) {
      await route.continue();
      return;
    }
    lost = true;
    try {
      await route.fetch();
    } catch {
      throw new Error("WORKSPACE_E2E_RESPONSE_LOSS_SETUP_FAILED");
    }
    await route.abort("failed");
  });
  await page
    .getByRole("form", { name: "测评信息", exact: true })
    .getByLabel("测评名称", { exact: true })
    .fill("响应丢失后的实际标题");
  await page.getByRole("button", { name: "保存测评信息", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提交结果尚未确认", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存测评信息", exact: true }),
  ).toBeDisabled();
  await page.getByText("编辑测评信息", { exact: true }).click();
  await expect(
    page.getByRole("form", { name: "测评信息", exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "提交结果尚未确认", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "读取服务器最新内容", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "响应丢失后的实际标题", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "采用服务器内容", exact: true })
    .click();
  await page.getByRole("button", { name: "归档测评", exact: true }).click();
  await page.getByRole("button", { name: "确认归档测评", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "恢复测评", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存测评信息", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("workspace-archived.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "恢复测评", exact: true }).click();
  await openEditor(page);
  await expect(
    page.getByRole("button", { name: "保存测评信息", exact: true }),
  ).toBeVisible();
});

test("taxonomy archival keeps old association readable and creation uncertainty uses exact slug/all", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await navigateStudio(page, "类目与标签");
  const category = page.getByRole("article", {
    name: "分类 e2e-category-one",
    exact: true,
  });
  await category.getByRole("button", { name: "归档分类", exact: true }).click();
  await category
    .getByRole("button", { name: "确认归档分类", exact: true })
    .click();
  await expect(
    category.getByRole("button", { name: "恢复分类", exact: true }),
  ).toBeVisible();
  await navigateStudio(page, "工作区");
  await openProductDetail(page);
  await expect(
    page.getByText("同名目录 · e2e-category-one · 已归档（可保留或移除）", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("form", { name: "测评信息", exact: true })
    .getByLabel("测评名称", { exact: true })
    .fill("保留归档目录后的标题");
  await page.getByRole("button", { name: "保存测评信息", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "保留归档目录后的标题", exact: true }),
  ).toBeVisible();
  await navigateStudio(page, "类目与标签");
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  let lost = false;
  await page.route("**/api/studio/tags", async (route) => {
    if (route.request().method() !== "POST" || lost) {
      await route.continue();
      return;
    }
    lost = true;
    try {
      await route.fetch();
    } catch {
      throw new Error("WORKSPACE_E2E_RESPONSE_LOSS_SETUP_FAILED");
    }
    await route.abort("failed");
  });
  await page.getByLabel("名称", { exact: true }).fill("未知提交合成标签");
  await page.getByLabel("英文标识", { exact: true }).fill("e2e-unknown-tag");
  await page.getByRole("button", { name: "创建标签", exact: true }).click();
  const recovered = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      request.method() === "GET" &&
      url.pathname === "/api/studio/tags" &&
      url.searchParams.get("slug") === "e2e-unknown-tag" &&
      url.searchParams.get("status") === "all"
    );
  });
  await page
    .getByRole("button", { name: "核实目录创建结果", exact: true })
    .click();
  await recovered;
  await expect(
    page.getByText("未知提交合成标签 · e2e-unknown-tag", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("taxonomy-unknown-reconciled.png"),
    fullPage: true,
  });
});

test("read-only can inspect existing products but sees no executable writes", async ({
  page,
}) => {
  await signIn(page, "readOnly");
  await openProductDetail(page);
  await expect(
    page.getByRole("heading", { name: "保留归档目录后的标题", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存测评信息", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "归档测评", exact: true }),
  ).toHaveCount(0);
  await page.goto("/studio/new-product");
  await expect(
    page.getByRole("heading", { name: "创建测评", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "新建测评", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建测评", exact: true }),
  ).toHaveCount(0);
  await navigateStudio(page, "类目与标签");
  await expect(
    page.getByRole("button", { name: "创建分类", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存名称", exact: true }),
  ).toHaveCount(0);
});

test("list loading and read failure have distinct safe states and an explicit retry", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await expect(
    page.getByRole("button", { name: "刷新列表", exact: true }),
  ).toBeVisible();
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reject = true;
  await page.route("**/api/studio/products?*", async (route) => {
    await paused;
    if (reject) await route.abort("failed");
    else await route.continue();
  });
  try {
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expect(
      page.getByText("正在加载测评…", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("workspace-list-loading.png"),
      fullPage: true,
    });
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "重新读取测评", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("workspace-list-read-error.png"),
    fullPage: true,
  });
  reject = false;
  await page.getByRole("button", { name: "重新读取测评", exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: /^查看测评 .*（编号 e2e-workspace）$/,
      exact: true,
    }),
  ).toBeVisible();
});

test("unknown product creation is read by immutable ID without replaying POST", async ({
  page,
}) => {
  await signIn(page);
  await openCreate(page);
  let writes = 0;
  await page.route("**/api/studio/products", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    writes += 1;
    try {
      await route.fetch();
    } catch {
      throw new Error("WORKSPACE_E2E_RESPONSE_LOSS_SETUP_FAILED");
    }
    await route.abort("failed");
  });
  await page
    .getByLabel("测评编号（需与内容包一致）", { exact: true })
    .fill("e2e-unknown-workspace");
  await page.getByLabel("测评名称", { exact: true }).fill("未知创建合成工作区");
  await page
    .getByLabel("测评英文标识", { exact: true })
    .fill("e2e-unknown-workspace");
  await page.getByRole("button", { name: "创建测评", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "核实创建结果", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "创建测评", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "核实创建结果", exact: true }).click();
  const serverRecord = page.getByRole("link", {
    name: /^在新标签查看服务器记录 .*（编号 e2e-unknown-workspace）$/,
    exact: true,
  });
  await expect(serverRecord).toBeVisible();
  await expect(serverRecord).toHaveAttribute("target", "_blank");
  await expect(serverRecord).toHaveAttribute("rel", /noopener/);
  const popupWait = page.waitForEvent("popup");
  await serverRecord.click();
  const popup = await popupWait;
  await expect(popup).toHaveURL(/\/studio\/products\/e2e-unknown-workspace$/);
  await popup.close();
  await expect(page).toHaveURL(/\/studio\/new-product$/);
  await expect(
    page.getByLabel("测评编号（需与内容包一致）", { exact: true }),
  ).toHaveValue("e2e-unknown-workspace");
  await expect(page.getByLabel("测评名称", { exact: true })).toHaveValue(
    "未知创建合成工作区",
  );
  await expect(
    page.getByRole("button", { name: "创建测评", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
});
