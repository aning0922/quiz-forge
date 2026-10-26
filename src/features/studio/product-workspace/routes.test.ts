import { describe, expect, it } from "vitest";
import { productWorkspaceHref, workspaceQuerySchema } from "./routes";
const draftId = "00000000-0000-4000-8000-000000000001";
describe("current workspace URLs", () => {
  it("keeps the exact target in preview and review URLs", () => {
    for (const task of ["preview", "review"] as const) {
      const href = productWorkspaceHref("test-product", task, {
        draftId,
        revision: 2,
      });
      expect(
        workspaceQuerySchema.parse(
          Object.fromEntries(
            new URL(href, "https://example.invalid").searchParams,
          ),
        ),
      ).toEqual({ task, draftId, revision: 2 });
    }
  });
  it.each([
    { task: "legacy" },
    { task: ["review", "preview"] },
    { task: "preview", draftId },
    { task: "review", revision: "2" },
    { task: "preview", draftId, revision: "latest" },
    { task: "preview", draftId, revision: "0" },
    { task: "preview", draftId, revision: "2147483648" },
    { task: "testing", draftId, revision: "2" },
    { task: "content", unexpected: "target" },
  ])("rejects ambiguous or invalid URL identity %j", (query) => {
    expect(workspaceQuerySchema.safeParse(query).success).toBe(false);
  });
});
