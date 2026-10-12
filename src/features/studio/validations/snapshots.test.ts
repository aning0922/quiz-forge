import { describe, expect, it } from "vitest";
import { dto } from "./fixtures.test-support";
import { mergeValidationSnapshots } from "./snapshots";
import { StudioClientError } from "../client";
import { validationMessage } from "./messages";
describe("acknowledged validation snapshots", () => {
  it("keeps highest seen revision through refresh, empty/error result, pagination and late lower response", () => {
    const ready = {
      ...dto,
      stateRevision: 4,
      status: "ready" as const,
      storageCondition: "clean" as const,
      resourceCount: 4,
      archivedResourceCount: 4,
      maintenanceRequired: false,
    };
    let known = mergeValidationSnapshots({}, [dto]);
    known = mergeValidationSnapshots(known, [ready]);
    expect(known[dto.id]).toBe(ready);
    known = mergeValidationSnapshots(known, []);
    expect(known[dto.id]).toBe(ready);
    known = mergeValidationSnapshots(known, [
      { ...dto, id: "00000000-0000-0000-0000-000000000003" },
    ]);
    expect(known[dto.id]).toBe(ready);
    known = mergeValidationSnapshots(known, [dto]);
    expect(known[dto.id]).toBe(ready);
  });
  it("ordinary errors make no claim-stage or network-send assertion", () => {
    expect(
      validationMessage(new StudioClientError("VALIDATION_IDENTITY_CHANGED")),
    ).not.toContain("尚未开始");
    expect(
      validationMessage(new Error("PENDING_STORAGE_UNAVAILABLE")),
    ).not.toContain("未发送");
  });
});
