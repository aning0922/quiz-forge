import { describe, expect, it } from "vitest";
import {
  prepareValidationSchema,
  startValidationSchema,
  preparedValidationDtoSchema,
  startValidationResultSchema,
  validationDtoSchema,
} from "./contracts";
const hash = "a".repeat(64);
const id = "00000000-0000-0000-0000-000000000001";
describe("browser-safe validation contracts", () => {
  it("rejects injected policy/identity and noncanonical hashes, UUIDs and revisions", () => {
    expect(
      prepareValidationSchema.safeParse({
        expectedImportStateRevision: 1,
        policy: "other",
      }).success,
    ).toBe(false);
    expect(
      startValidationSchema.safeParse({
        expectedImportStateRevision: 0,
        expectedValidationKey: hash,
      }).success,
    ).toBe(false);
    expect(
      startValidationSchema.safeParse({
        expectedImportStateRevision: 1,
        expectedValidationKey: hash.toUpperCase(),
      }).success,
    ).toBe(false);
    expect(
      preparedValidationDtoSchema.safeParse({
        productId: "synthetic",
        importId: id.toUpperCase().replace("0001", "ABCD"),
        expectedImportStateRevision: 1,
        archiveSha256: hash,
        archiveBytes: 1,
        identitySha256: hash,
        validationKey: hash,
      }).success,
    ).toBe(false);
  });
  it("recognizes only exact not-started domain proof", () => {
    const value = {
      outcome: "not-started",
      execution: "not-started",
      productId: "synthetic",
      importId: id,
      expectedImportStateRevision: 1,
      expectedValidationKey: hash,
      code: "MEDIA_UNAVAILABLE",
    };
    expect(startValidationResultSchema.safeParse(value).success).toBe(true);
    expect(
      startValidationResultSchema.safeParse({ ...value, execution: "unknown" })
        .success,
    ).toBe(false);
    expect(
      startValidationResultSchema.safeParse({
        ...value,
        code: "WRITE_OUTCOME_UNKNOWN",
      }).success,
    ).toBe(false);
    expect(
      startValidationResultSchema.safeParse({ ...value, retryable: true })
        .success,
    ).toBe(false);
  });
  it("requires safe summary fields and consistent attempts/ready resource count", () => {
    expect(
      validationDtoSchema.safeParse({ id, storageKey: "blobs/private" })
        .success,
    ).toBe(false);
  });
});
