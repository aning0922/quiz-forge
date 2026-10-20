import { chromium, expect, type ElementHandle } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertStudioLayout, sampleStudioLayout } from "../e2e/studio-layout";

// Real Chromium DOM/Locator interleaving only; no DB, HTTP, Next or credentials.
const out = path.resolve(".cache/p4-studio-layout", String(Date.now()));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  await page.setContent(
    '<main><p id="refreshing" style="font-size:16px">Synthetic current fact</p></main>',
  );
  const probe = await page.locator("main p").elementHandle();
  if (!probe) throw Error("SYNTHETIC_PARAGRAPH_MISSING");
  const prototype = Object.getPrototypeOf(probe) as {
    evaluate: ElementHandle["evaluate"];
  };
  const hadOwn = Object.hasOwn(prototype, "evaluate"),
    original = prototype.evaluate;
  let detached: { connected: boolean; fontSize: string } | undefined;
  let measured: number | undefined;
  // Locator.evaluate's actual _withElement has already obtained its handle here.
  // Complete a real DOM refresh at that boundary, then call the original native
  // getComputedStyle through the original ElementHandle implementation.
  prototype.evaluate = async function (
    this: ElementHandle,
    ...args: Parameters<ElementHandle["evaluate"]>
  ) {
    if (!detached && String(args[0]).includes("getComputedStyle")) {
      await page.evaluate(() => {
        const old = document.getElementById("refreshing");
        const next = document.createElement("p");
        next.style.fontSize = "16px";
        next.textContent = "Synthetic refreshed fact";
        old?.replaceWith(next);
      });
      detached = await Reflect.apply(original, this, [
        (e: Element) => ({
          connected: e.isConnected,
          fontSize: getComputedStyle(e).fontSize,
        }),
      ]);
    }
    return Reflect.apply(original, this, args);
  } as ElementHandle["evaluate"];
  let oldRejected = false;
  try {
    for (const paragraph of await page.locator("main p").all()) {
      if (await paragraph.isVisible()) {
        measured = await paragraph.evaluate((e) =>
          Number.parseFloat(getComputedStyle(e).fontSize),
        );
        expect(measured).toBeGreaterThanOrEqual(16);
      }
    }
  } catch {
    oldRejected = true;
  } finally {
    if (hadOwn) prototype.evaluate = original;
    else Reflect.deleteProperty(prototype, "evaluate");
    await probe.dispose();
  }
  expect(
    oldRejected &&
      detached?.connected === false &&
      detached.fontSize === "" &&
      Number.isNaN(measured),
  ).toBe(true);
  const refreshed = await sampleStudioLayout(page);
  expect(refreshed.paragraphFonts).toEqual([16]);
  assertStudioLayout(refreshed);

  await page.setContent(
    '<style>*{box-sizing:border-box}p{font-size:16px}a,button{display:block;height:44px}button{margin-top:16px}</style><main><p>Visible baseline</p><p style="display:none;font-size:15px">Hidden paragraph</p><div data-revision-resolution="applied"><a href="#">Read fixed receipt</a><button>解除已确认成功的本地锚点</button></div></main>',
  );
  const good = await sampleStudioLayout(page);
  assertStudioLayout(good);
  expect(good.paragraphFonts).toEqual([16]);
  expect(good.targetHeights).toEqual([44, 44]);
  const badCases = [];
  for (const change of ["font15", "target43", "gap15"]) {
    await page.evaluate((which) => {
      (document.querySelector("main p") as HTMLElement).style.fontSize =
        which === "font15" ? "15px" : "16px";
      (document.querySelector("button") as HTMLElement).style.height =
        which === "target43" ? "43px" : "44px";
      (document.querySelector("button") as HTMLElement).style.marginTop =
        which === "gap15" ? "15px" : "16px";
    }, change);
    const actual = await sampleStudioLayout(page);
    let rejected = false;
    try {
      assertStudioLayout(actual);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    badCases.push({ change, rejected });
  }
  let nanRejected = false;
  try {
    assertStudioLayout({ ...good, paragraphFonts: [NaN] });
  } catch {
    nanRejected = true;
  }
  expect(nanRejected).toBe(true);
  // Preserve each caller's original selector/role scope instead of broadening
  // font checks to decorative/outside text or targets outside the chosen region.
  await page.setContent(
    "<style>*{box-sizing:border-box}p,pre,dd{font-size:16px}button,input,[role=button]{height:44px;width:80px}#hidden{height:15px}</style><main><p>P</p><pre>Pre</pre><dd>DD</dd><button id=native>x</button><div role=button id=explicit tabindex=0>x</div><input type=submit id=submit><input type=button id=inputbutton><input type=reset id=reset><input type=image id=image alt=img><button id=override role=link>x</button><button id=hidden aria-hidden=true>x</button></main>",
  );
  const expectedButtons = await page.getByRole("button").count();
  const roles = await sampleStudioLayout(page, {
    fontSelector: "main p,main pre,main dd",
    buttonRoleWithin: "html",
    appliedReceipts: false,
  });
  assertStudioLayout(roles);
  expect(roles.paragraphFonts).toEqual([16, 16, 16]);
  expect(roles.targetHeights.length).toBe(expectedButtons);
  expect(expectedButtons).toBe(6);
  await page.evaluate(() => {
    (document.querySelector("dd") as HTMLElement).style.fontSize = "15px";
  });
  let dd15Rejected = false;
  try {
    assertStudioLayout(
      await sampleStudioLayout(page, {
        fontSelector: "main p,main pre,main dd",
        targetSelector: "",
        appliedReceipts: false,
      }),
    );
  } catch {
    dd15Rejected = true;
  }
  expect(dd15Rejected).toBe(true);

  await page.setContent(
    '<style>*{box-sizing:border-box}p{font-size:15px}button{height:43px;width:43px}[data-preview-state] p{font-size:16px}#upper{height:20px}#lower{height:20px}</style><main><p>Outside</p><div data-preview-state><p>Scoped body</p></div><section aria-labelledby=validation-heading style="font-size:16px"><h2 id=validation-heading>验证与私有资源归档</h2><button style="height:44px;width:44px">x</button></section><div id=upper>U</div><div id=lower>L</div></main>',
  );
  const previewScoped = await sampleStudioLayout(page, {
    fontSelector: "[data-preview-state] p",
    targetSelector: "",
    appliedReceipts: false,
    above: [["#upper", "#lower"]],
  });
  assertStudioLayout(previewScoped);
  expect(previewScoped.paragraphFonts).toEqual([16]);
  const region = await sampleStudioLayout(page, {
    fontSelector: 'section[aria-labelledby="validation-heading"]',
    fontVisibility: "all",
    buttonRoleWithin: 'section[aria-labelledby="validation-heading"]',
    appliedReceipts: false,
  });
  assertStudioLayout(region, { requiredFontCount: 1 });
  expect(region.targetHeights).toEqual([44]);
  await page.evaluate(() => {
    (document.querySelector("#lower") as HTMLElement).style.marginTop = "-1px";
  });
  let overlapRejected = false;
  try {
    assertStudioLayout(
      await sampleStudioLayout(page, {
        fontSelector: "",
        targetSelector: "",
        appliedReceipts: false,
        above: [["#upper", "#lower"]],
      }),
    );
  } catch {
    overlapRejected = true;
  }
  expect(overlapRejected).toBe(true);
  await page.setContent(
    '<main><button style="box-sizing:border-box;height:44px;width:43px">x</button></main>',
  );
  const consumer = await sampleStudioLayout(page, {
    fontSelector: "",
    targetSelector: "main button",
    appliedReceipts: false,
  });
  assertStudioLayout(consumer);
  let width43Rejected = false;
  try {
    assertStudioLayout(consumer, { minimumTargetWidth: 44 });
  } catch {
    width43Rejected = true;
  }
  expect(width43Rejected).toBe(true);
  // Native visibility, rather than CSS+rect alone, excludes closed-details
  // and content-visibility descendants which can retain nonzero geometry.
  await page.setContent(
    '<main><p style="font-size:16px">body</p><details><summary style="height:44px">more</summary><p style="font-size:15px">closed</p><button style="height:43px">closed target</button></details><p hidden style="font-size:15px">hidden</p><div style="content-visibility:hidden"><p style="font-size:15px">skipped</p><button style="height:43px">skipped target</button></div><p style="visibility:hidden;font-size:15px">invisible</p><button style="height:44px">visible target</button></main>',
  );
  const oldVisibility = await Promise.all(
    (await page.locator("main p").all()).map((p) => p.isVisible()),
  );
  expect(oldVisibility).toEqual([true, false, false, false, false]);
  const nativeVisibility = await page
    .locator("main p")
    .evaluateAll((ps) =>
      ps.map((p) => p.checkVisibility({ checkVisibilityCSS: true })),
    );
  expect(nativeVisibility).toEqual(oldVisibility);
  const hiddenScope = await sampleStudioLayout(page);
  assertStudioLayout(hiddenScope);
  expect(hiddenScope.paragraphFonts).toEqual([16]);
  expect(hiddenScope.targetHeights).toEqual([44, 44]);
  const hiddenRoles = await sampleStudioLayout(page, {
    buttonRoleWithin: "html",
    appliedReceipts: false,
  });
  assertStudioLayout(hiddenRoles);
  expect(hiddenRoles.targetHeights).toHaveLength(
    await page.getByRole("button").count(),
  );
  expect(hiddenRoles.targetHeights).toEqual([44]);

  const contentsCases: { name: string; fonts: number[]; rejected: boolean }[] =
    [];
  for (const [name, html, fonts, rejected] of [
    [
      "direct-visible-15",
      '<p style="display:contents;font-size:15px">visible text</p>',
      [15],
      true,
    ],
    [
      "nested-visible-15",
      '<p style="display:contents;font-size:15px"><span style="display:contents">visible nested text</span></p>',
      [15],
      true,
    ],
    [
      "element-visible-16",
      '<p style="display:contents;font-size:16px"><span>visible child</span></p>',
      [16],
      false,
    ],
    [
      "closed-contents",
      '<details><summary style="height:44px">more</summary><p style="display:contents;font-size:15px">closed text</p></details>',
      [],
      false,
    ],
    [
      "skipped-contents",
      '<div style="content-visibility:hidden"><p style="display:contents;font-size:15px">skipped text</p></div>',
      [],
      false,
    ],
    [
      "hidden-child",
      '<p style="display:contents;font-size:15px"><span style="visibility:hidden">hidden child</span></p>',
      [],
      false,
    ],
    [
      "hidden-text",
      '<p style="display:contents;visibility:hidden;font-size:15px">hidden text</p>',
      [],
      false,
    ],
  ] as const) {
    await page.setContent(`<main>${html}</main>`);
    const sample = await sampleStudioLayout(page);
    expect(sample.paragraphFonts).toEqual(fonts);
    let actualRejected = false;
    try {
      assertStudioLayout(sample);
    } catch {
      actualRejected = true;
    }
    expect(actualRejected).toBe(rejected);
    contentsCases.push({ name, fonts: sample.paragraphFonts, rejected });
  }
  await page.setContent(
    '<style>button,a,summary{display:block;box-sizing:border-box;height:44px}#clear{margin-top:16px}</style><main><div data-revision-resolution="applied"><a href="#">visible link</a><details><summary>more</summary><a href="#" style="height:43px">closed link</a><button style="height:43px">解除已确认成功的本地锚点</button></details><div style="content-visibility:hidden"><a href="#">skipped link</a><button>解除已确认成功的本地锚点</button></div><button id="clear">解除已确认成功的本地锚点</button></div></main>',
  );
  const receiptVisibility = await sampleStudioLayout(page);
  assertStudioLayout(receiptVisibility);
  expect(receiptVisibility.appliedReceipts[0]!.clearCount).toBe(1);
  expect(receiptVisibility.appliedReceipts[0]!.links).toHaveLength(1);
  await page.locator("#clear").evaluate((e) => e.remove());
  const hiddenClear = await sampleStudioLayout(page);
  expect(hiddenClear.appliedReceipts[0]!.clearCount).toBe(0);
  let hiddenClearRejected = false;
  try {
    assertStudioLayout(hiddenClear);
  } catch {
    hiddenClearRejected = true;
  }
  expect(hiddenClearRejected).toBe(true);
  await page.setContent(
    '<details><summary>more</summary><div id="upper" style="height:20px">closed badge</div></details><div id="lower" style="height:20px">caption</div>',
  );
  const hiddenOverlay = await sampleStudioLayout(page, {
    fontSelector: "",
    targetSelector: "",
    appliedReceipts: false,
    above: [["#upper", "#lower"]],
  });
  expect(hiddenOverlay.abovePairs[0]!.upper).toBeNull();
  let hiddenOverlayRejected = false;
  try {
    assertStudioLayout(hiddenOverlay);
  } catch {
    hiddenOverlayRejected = true;
  }
  expect(hiddenOverlayRejected).toBe(true);
  const result = {
    qualification:
      "controlled real Chromium DOM detach and numeric policy checks only; no DB/HTTP/Next/credentials",
    browser: await browser.version(),
    old: {
      rejected: oldRejected,
      detached,
      measuredNaN: Number.isNaN(measured),
    },
    refreshed: { fonts: refreshed.paragraphFonts, passed: true },
    baseline: { font: 16, target: 44, gap: 16, passed: true },
    badCases,
    nanRejected,
    visibility: {
      oldVisibility,
      nativeVisibility,
      fonts: hiddenScope.paragraphFonts,
      nativeTargets: hiddenScope.targetHeights,
      roleTargets: hiddenRoles.targetHeights,
      contentsCases,
      hiddenClearRejected,
      hiddenOverlayRejected,
      visibleReceiptLinks: receiptVisibility.appliedReceipts[0]!.links.length,
    },
    scopes: {
      expectedButtons,
      measuredButtons: roles.targetHeights.length,
      dd15Rejected,
      previewFont16: true,
      regionFont16: true,
      overlapRejected,
      consumerWidth43Rejected: width43Rejected,
    },
  };
  await writeFile(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ out, oldRejected, badCases, nanRejected }));
} finally {
  await browser.close();
}
