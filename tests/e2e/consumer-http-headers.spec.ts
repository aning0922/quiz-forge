import { expect, test } from "@playwright/test";

// Never retain response bodies, screenshots, traces or videos from consumer routes.
test.use({ trace: "off", video: "off", screenshot: "off" });
const syntheticSession = "00000000-0000-4000-8000-000000000001";
for (const [label, path, status] of [
  ["access", "/access", 200],
  ["session document", `/play/${syntheticSession}`, 200],
  ["report document", `/play/${syntheticSession}/report`, 200],
  ["invalid selector", "/play/not-a-session", 404],
  ["unknown consumer path", `/play/${syntheticSession}/unknown`, 404],
] as const) {
  test(`consumer ${label} has real private response headers and one skip target`, async ({
    page,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(status);
    const headers = response!.headers();
    expect(headers["cache-control"]).toContain("private");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("#main")).toHaveCount(1);
    expect(
      await page
        .locator("#main")
        .evaluate(
          (target) =>
            target.tagName === "MAIN" ||
            target.querySelectorAll("main").length === 1,
        ),
    ).toBe(true);
    await expect(
      page.getByRole("link", { name: "跳转到主要内容" }),
    ).toHaveAttribute("href", "#main");
  });
}
