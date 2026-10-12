import { describe, expect, it } from "vitest";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  runIsolatedImage,
  readMediaRuntimeBinding,
  requestMediaOperationStop,
  MEDIA_STOP_REASONS,
  parseLaunchResult,
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
describe("public media fixed entry without build authorization", () => {
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
  it.each(MEDIA_STOP_REASONS)(
    "retains consistent public stop evidence for %s",
    async (reason) => {
      const context = createMediaOperationContext({
        signal: new AbortController().signal,
        deadlineMonotonicMs: performance.now() + 60_000,
      });
      try {
        requestMediaOperationStop(context, reason);
        const result = await runIsolatedImage(
          new Uint8Array([1]),
          declaration,
          context,
        );
        expect(result.outcome).toBe("failed");
        expect(parseLaunchResult(Buffer.from(JSON.stringify(result)))).toEqual({
          ok: true,
          value: result,
        });
        if (reason === "STOP_UNCONFIRMED")
          expect(result).toMatchObject({
            code: "STOP_UNCONFIRMED",
            stopped: "unknown",
          });
      } finally {
        disposeMediaOperationContext(context);
      }
    },
  );
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
