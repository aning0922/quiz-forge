import { describe, it, expect } from "vitest";
import { StudioError, errorResponse } from "@/lib/http-security/errors";
describe("controlled B1 revision error response", () => {
  it("returns currentRevision only for authorized CAS conflict and valid integer", async () => {
    for (const code of [
      "METADATA_REVISION_CONFLICT",
      "TAXONOMY_REVISION_CONFLICT",
    ] as const)
      expect(
        await errorResponse(
          new StudioError(code, 2),
          "synthetic-request",
        ).json(),
      ).toEqual({ code, requestId: "synthetic-request", currentRevision: 2 });
    for (const n of [0, -1, 1.5, 2147483648, NaN])
      expect(
        await errorResponse(
          new StudioError("METADATA_REVISION_CONFLICT", n),
          "synthetic-request",
        ).json(),
      ).toEqual({
        code: "METADATA_REVISION_CONFLICT",
        requestId: "synthetic-request",
      });
    expect(
      await errorResponse(
        new StudioError("INVALID_REQUEST", 2),
        "synthetic-request",
      ).json(),
    ).toEqual({ code: "INVALID_REQUEST", requestId: "synthetic-request" });
  });
  it("never serializes raw internal errors", async () => {
    expect(
      await errorResponse(
        { message: "arbitrary", query: "arbitrary", parameters: ["arbitrary"] },
        "synthetic-request",
      ).json(),
    ).toEqual({ code: "STUDIO_UNAVAILABLE", requestId: "synthetic-request" });
  });
});
