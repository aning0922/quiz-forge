import { expectTypeOf, it } from "vitest";
import type {
  PreviewEntry,
  PreviewReveal,
  PreviewPosterExport,
} from "./contracts";
it("preserves exact component state types at the shared boundary", () => {
  expectTypeOf<
    PreviewEntry["layouts"]["cover"]["component"]["id"]
  >().toEqualTypeOf<"folio-cover">();
  expectTypeOf<
    PreviewEntry["layouts"]["question"]["component"]["id"]
  >().toEqualTypeOf<"folio-question">();
  expectTypeOf<
    PreviewReveal["result"]["layout"]["component"]["id"]
  >().toEqualTypeOf<"cabinet-result">();
  expectTypeOf<
    PreviewPosterExport["poster"]["kind"]
  >().toEqualTypeOf<"ready">();
});
