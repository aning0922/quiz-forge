import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { consumerDisplayFixture } from "./fixtures.test-support";
import { projectConsumerEntryV1, projectConsumerResultV1 } from "./projection";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";

describe("consumer server-only display projection, not session authority", () => {
  it.each(["archetype", "dimensions"] as const)(
    "projects %s entry without hidden scoring or portraits and freezes independent data",
    async (engine) => {
      const f = await consumerDisplayFixture(engine);
      expect(f.entry.assets.map((a) => a.purpose)).not.toContain("portrait");
      const text = JSON.stringify(f.entry);
      expect(text).not.toMatch(
        /weights|targets|witness|reportTemplates|resultCards|portrait|draftId|requestId|binding|resourceRefs/,
      );
      expect(f.entry.layouts.cover.component).toEqual(
        f.content.layouts.cover.component,
      );
      expect(f.display.report.baseline).toEqual(
        f.content.reportTemplates.find(
          (r) => r.id === f.display.reportTemplateRef.id,
        )!.baseline,
      );
      f.content.product.title = "修改测试来源";
      expect(f.entry.product.title).not.toBe(f.content.product.title);
      expect(Object.isFrozen(f.entry.visualPresentation.sections[0])).toBe(
        true,
      );
      expect(Object.isFrozen(f.display.report.baseline)).toBe(true);
    },
  );
  it("rejects source hash, layout tuple, unsupported fields, proxy/getter and score identity mismatches", async () => {
    const f = await consumerDisplayFixture();
    expect(projectConsumerEntryV1(f.content, "f".repeat(64))).toEqual({
      ok: false,
      code: "SOURCE_MISMATCH",
    });
    const changed = structuredClone(f.content);
    Object.assign(changed.layouts.cover.component, { version: "3.0.0" });
    expect(
      projectConsumerEntryV1(
        changed,
        createHash("sha256").update(canonicalP1Json(changed)).digest("hex"),
      ).ok,
    ).toBe(false);
    let invoked = false;
    const getter = Object.defineProperty({}, "schemaVersion", {
      enumerable: true,
      get() {
        invoked = true;
        return "quizpack-content.v2";
      },
    });
    expect(projectConsumerEntryV1(getter, f.sha).ok).toBe(false);
    expect(invoked).toBe(false);
    expect(projectConsumerEntryV1(new Proxy(f.content, {}), f.sha).ok).toBe(
      false,
    );
    const wrong = structuredClone(f.scored);
    Object.assign(wrong, { canonicalContentSha256: "f".repeat(64) });
    expect(projectConsumerResultV1(f.content, wrong, f.sha)).toEqual({
      ok: false,
      code: "SOURCE_MISMATCH",
    });
  });
});
