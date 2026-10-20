import { expect, type Page } from "@playwright/test";

type LayoutOptions = Readonly<{
  fontSelector?: string;
  fontVisibility?: "visible" | "all";
  targetSelector?: string;
  buttonRoleWithin?: string;
  appliedReceipts?: boolean;
  above?: readonly (readonly [string, string])[];
}>;

/** One synchronous browser turn. Return numeric evidence only, never DOM text/answers or URLs. */
export async function sampleStudioLayout(
  page: Page,
  options: LayoutOptions = {},
) {
  const query = {
    fontSelector: options.fontSelector ?? "main p",
    fontVisibility: options.fontVisibility ?? "visible",
    targetSelector:
      options.buttonRoleWithin !== undefined
        ? `:is(${options.buttonRoleWithin}) :is(button, input[type=button], input[type=submit], input[type=reset], input[type=image], [role=button])`
        : (options.targetSelector ??
          "main button, main a, main select, main summary"),
    buttonRoleOnly: options.buttonRoleWithin !== undefined,
    appliedReceipts: options.appliedReceipts ?? true,
    above: [...(options.above ?? [])],
  };
  return page.evaluate((query) => {
    // Object method syntax keeps this self-contained when TSX serializes evaluate.
    const layout = {
      visible(element: Element): boolean {
        if (!element.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
        const style = getComputedStyle(element);
        if (style.display === "contents") {
          // No own box: inspect children, but Range alone can report geometry
          // for text suppressed by closed details/content-visibility ancestors.
          for (
            let ancestor: Element | null = element;
            ancestor;
            ancestor = ancestor.parentElement
          ) {
            const ancestorStyle = getComputedStyle(ancestor);
            if (
              ancestorStyle.display === "none" ||
              ancestorStyle.contentVisibility === "hidden"
            )
              return false;
            if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
              const summary = ancestor.querySelector(":scope > summary");
              if (!summary?.contains(element)) return false;
            }
          }
          for (const child of element.childNodes) {
            if (child instanceof Element && layout.visible(child)) return true;
            if (
              child.nodeType === Node.TEXT_NODE &&
              style.visibility === "visible"
            ) {
              const range = document.createRange();
              range.selectNode(child);
              const rect = range.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) return true;
            }
          }
          return false;
        }
        // Match Chromium Playwright's native check (including closed details
        // and content-visibility), then its CSS visibility and nonempty box rule.
        if (!element.checkVisibility() || style.visibility !== "visible")
          return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
    };
    const paragraphFonts: number[] = [];
    const targetHeights: number[] = [];
    const targetWidths: number[] = [];
    const abovePairs: {
      upper: { y: number; height: number } | null;
      lower: { y: number; height: number } | null;
      upperCount: number;
      lowerCount: number;
    }[] = [];
    const appliedReceipts: {
      clear: { y: number; height: number } | null;
      clearCount: number;
      links: { y: number; height: number }[];
    }[] = [];
    for (const element of query.fontSelector
      ? document.querySelectorAll(query.fontSelector)
      : []) {
      if (!element.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
      const style = getComputedStyle(element);
      if (query.fontVisibility === "all" || layout.visible(element))
        paragraphFonts.push(Number.parseFloat(style.fontSize));
    }
    for (const element of query.targetSelector
      ? document.querySelectorAll(query.targetSelector)
      : []) {
      if (!element.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
      if (query.buttonRoleOnly) {
        const role = element.getAttribute("role")?.trim().split(/\s+/)[0];
        if (
          (role && role !== "button") ||
          element.closest('[aria-hidden="true" i], [inert]')
        )
          continue;
      }
      const rect = element.getBoundingClientRect();
      if (layout.visible(element)) {
        targetHeights.push(rect.height);
        targetWidths.push(rect.width);
      }
    }
    for (const receipt of query.appliedReceipts
      ? document.querySelectorAll('[data-revision-resolution="applied"]')
      : []) {
      if (!receipt.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
      let clear: { y: number; height: number } | null = null;
      let clearCount = 0;
      const links: { y: number; height: number }[] = [];
      for (const button of receipt.querySelectorAll("button")) {
        if (!button.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
        const role = button.getAttribute("role")?.trim().split(/\s+/)[0];
        if (
          (role && role !== "button") ||
          button.closest('[aria-hidden="true" i], [inert]')
        )
          continue;
        if (button.textContent?.trim() !== "解除已确认成功的本地锚点") continue;
        const rect = button.getBoundingClientRect();
        if (layout.visible(button)) {
          clear = { y: rect.y, height: rect.height };
          clearCount++;
        }
      }
      for (const link of receipt.querySelectorAll("a[href], [role=link]")) {
        if (!link.isConnected) throw Error("STUDIO_LAYOUT_NODE_DETACHED");
        const role = link.getAttribute("role")?.trim().split(/\s+/)[0];
        if (
          (role && role !== "link") ||
          link.closest('[aria-hidden="true" i], [inert]')
        )
          continue;
        const rect = link.getBoundingClientRect();
        if (layout.visible(link))
          links.push({ y: rect.y, height: rect.height });
      }
      appliedReceipts.push({ clear, clearCount, links });
    }
    for (const [upperSelector, lowerSelector] of query.above) {
      let upper: { y: number; height: number } | null = null,
        lower: { y: number; height: number } | null = null;
      const upperMatches = document.querySelectorAll(upperSelector),
        lowerMatches = document.querySelectorAll(lowerSelector);
      const upperElement = upperMatches[0],
        lowerElement = lowerMatches[0];
      if (upperElement) {
        const rect = upperElement.getBoundingClientRect();
        if (layout.visible(upperElement))
          upper = { y: rect.y, height: rect.height };
      }
      if (lowerElement) {
        const rect = lowerElement.getBoundingClientRect();
        if (layout.visible(lowerElement))
          lower = { y: rect.y, height: rect.height };
      }
      abovePairs.push({
        upper,
        lower,
        upperCount: upperMatches.length,
        lowerCount: lowerMatches.length,
      });
    }
    return {
      overflow: document.documentElement.scrollWidth > innerWidth,
      paragraphFonts,
      targetHeights,
      targetWidths,
      appliedReceipts,
      abovePairs,
    };
  }, query);
}

export function assertStudioLayout(
  sample: Awaited<ReturnType<typeof sampleStudioLayout>>,
  options: Readonly<{
    minimumTargetWidth?: number;
    requiredFontCount?: number;
  }> = {},
) {
  expect(sample.overflow).toBe(false);
  if (options.requiredFontCount !== undefined)
    expect(sample.paragraphFonts).toHaveLength(options.requiredFontCount);
  for (const font of sample.paragraphFonts) {
    expect(Number.isFinite(font)).toBe(true);
    expect(font).toBeGreaterThanOrEqual(16);
  }
  for (const height of sample.targetHeights) {
    expect(Number.isFinite(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(44);
  }
  if (options.minimumTargetWidth !== undefined)
    for (const width of sample.targetWidths) {
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(options.minimumTargetWidth);
    }
  for (const receipt of sample.appliedReceipts) {
    expect(receipt.clearCount).toBe(1);
    expect(receipt.clear).not.toBeNull();
    for (const link of receipt.links) {
      const gap = receipt.clear!.y - (link.y + link.height);
      expect(Number.isFinite(gap)).toBe(true);
      expect(gap).toBeGreaterThanOrEqual(16);
    }
  }
  for (const pair of sample.abovePairs) {
    expect(pair.upperCount).toBe(1);
    expect(pair.lowerCount).toBe(1);
    expect(pair.upper).not.toBeNull();
    expect(pair.lower).not.toBeNull();
    expect(pair.upper!.y + pair.upper!.height).toBeLessThanOrEqual(
      pair.lower!.y,
    );
  }
}
