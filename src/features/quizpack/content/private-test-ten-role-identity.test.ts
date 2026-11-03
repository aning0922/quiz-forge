import { expect, it } from "vitest";
import { QIANZAI_HISTORICAL_TEN_TEST_IDENTITY as identity } from "./private-test-ten-role-identity";
import {
  PRIVATE_TEST_REGISTRATIONS,
  privateTestMarkerMatches,
  privateTestUseSchema,
} from "./private-test";

const marker = {
  schemaVersion: "quizforge.private-test-use.v1",
  instanceId: identity.instanceId,
  authorizationId: identity.authorizationId,
  contentStatus: "candidate",
  resourceStatus: "reference-or-candidate",
};

it("allows only the exact new candidate marker to be assembled", () => {
  expect(privateTestUseSchema.parse(marker)).toEqual(marker);
  expect(
    privateTestUseSchema.safeParse({ ...marker, instanceId: "unknown" })
      .success,
  ).toBe(false);
  expect(
    privateTestUseSchema.safeParse({ ...marker, resourceStatus: "approved" })
      .success,
  ).toBe(false);
});

it.each(PRIVATE_TEST_REGISTRATIONS)(
  "keeps the old source and marker separate for $instanceId",
  (registered) => {
    expect(privateTestMarkerMatches(marker, registered)).toBe(false);
    expect(
      privateTestUseSchema.safeParse({
        ...marker,
        instanceId: registered.instanceId,
      }).success,
    ).toBe(false);
    expect(
      privateTestUseSchema.safeParse({
        ...marker,
        authorizationId: registered.authorizationId,
      }).success,
    ).toBe(false);
  },
);

it("does not register a source by adding its candidate marker syntax", () => {
  expect(
    PRIVATE_TEST_REGISTRATIONS.some(
      (registered) => String(registered.instanceId) === identity.instanceId,
    ),
  ).toBe(false);
});
