import { describe, expect, it } from "vitest";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  runIsolatedImage,
  readMediaRuntimeBinding,
} from "./index";
import type { ImageDeclaration, MediaOperationContext } from "./index";
const declaration: ImageDeclaration = {
  path: "assets/synthetic.png",
  mediaType: "image/png",
  bytes: 1,
  sha256: "a".repeat(64),
  width: 2,
  height: 2,
};
describe("public media entry before platform migration", () => {
  it("does not authorize unbound execution", async () => {
    const context = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 60_000,
    });
    try {
      expect(await readMediaRuntimeBinding(context)).toEqual({
        outcome: "unavailable",
        code: "ISOLATION_UNAVAILABLE",
      });
      expect(
        await runIsolatedImage(new Uint8Array([1]), declaration, context),
      ).toMatchObject({
        outcome: "failed",
        code: "ISOLATION_UNAVAILABLE",
        stopped: "not-started",
        profileId: null,
      });
    } finally {
      disposeMediaOperationContext(context);
    }
  });
  it("rejects forged contexts without starting anything", async () => {
    expect(
      await runIsolatedImage(
        new Uint8Array([1]),
        declaration,
        {} as MediaOperationContext,
      ),
    ).toMatchObject({
      outcome: "failed",
      code: "INVALID_INPUT",
      stopped: "not-started",
    });
  });
});
