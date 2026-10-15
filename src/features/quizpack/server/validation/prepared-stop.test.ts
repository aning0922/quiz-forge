import { performance } from "node:perf_hooks";
import { describe, it, expect, vi } from "vitest";
const binding = vi.hoisted(() => vi.fn());
vi.mock("../media", async (importActual) => ({
  ...(await importActual<typeof import("../media")>()),
  readMediaRuntimeBinding: binding,
}));
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  requestMediaOperationStop,
  readMediaOperationState,
} from "../media";
import { prepareValidationIdentity } from "./prepared";
import { validateArchiveCandidate } from "./engine";
import { createValidationOperationScope } from "./operation-scope";
function context() {
  return createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60000,
  });
}
describe("shared stop uncertainty overrides finite local binding failure", () => {
  it.each(["prepare", "validate"] as const)(
    "preserves synchronous abort escalation in %s",
    async (mode) => {
      binding.mockResolvedValue({
        outcome: "unavailable",
        code: "ISOLATION_UNAVAILABLE",
      });
      const ctx = context();
      ctx.signal.addEventListener(
        "abort",
        () => requestMediaOperationStop(ctx, "STOP_UNCONFIRMED"),
        { once: true },
      );
      try {
        const result =
          mode === "prepare"
            ? await prepareValidationIdentity(ctx)
            : await validateArchiveCandidate(
                new Uint8Array([1]),
                "synthetic-product",
                ctx,
              );
        expect(readMediaOperationState(ctx)).toMatchObject({
          phase: "stopping",
          stop: { reason: "STOP_UNCONFIRMED" },
        });
        expect(result).toMatchObject({
          outcome: "interrupted",
          code: "MEDIA_STOP_UNCONFIRMED",
        });
        const evidence = "evidence" in result ? result.evidence : result;
        expect(evidence).toMatchObject({
          runtimeFailure: "STOP_UNCONFIRMED",
          completion: {
            mediaStopped: "unknown",
            relatedIo: "unconfirmed",
            maintenanceRequired: true,
          },
        });
        expect(result).not.toHaveProperty("prepared");
        expect(result).not.toHaveProperty("candidate");
      } finally {
        disposeMediaOperationContext(ctx);
      }
    },
  );
  it("absorbs a late shared UNKNOWN at completion and never downgrades it", () => {
    const ctx = context(),
      scope = createValidationOperationScope(ctx);
    try {
      scope.runtimeFailure = "ISOLATION_UNAVAILABLE";
      scope.requestStop();
      requestMediaOperationStop(ctx, "STOP_UNCONFIRMED");
      expect(scope.completion()).toEqual({
        mediaStopped: "unknown",
        relatedIo: "unconfirmed",
        maintenanceRequired: true,
      });
      scope.runtimeFailure = "WORKER_FAILED";
      scope.runtimeIoUnconfirmed = false;
      expect(scope.runtimeFailure).toBe("STOP_UNCONFIRMED");
      expect(scope.completion()).toEqual({
        mediaStopped: "unknown",
        relatedIo: "unconfirmed",
        maintenanceRequired: true,
      });
    } finally {
      disposeMediaOperationContext(ctx);
    }
  });
});
