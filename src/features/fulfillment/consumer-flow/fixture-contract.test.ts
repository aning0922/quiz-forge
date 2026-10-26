import { expect, it } from "vitest";
import {
  consumerFixtureSchema,
  consumerFixtureObservationsSchema,
  consumerFixtureGrantObservationSchema,
  consumerFixtureSuiteCompletionSchema,
  CONSUMER_E2E_CASES,
} from "../../../../tests/db/p4-consumer-fixture-contract";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const base = {
  version: 1,
  qualification: "synthetic-db-private-pixels-real-reads-no-native-validation",
  instanceId: "a".repeat(32),
  runId: uuid(1),
  writerPid: 12345,
  productId: "consumer-flow-fixture",
  prepared: false,
  finished: false,
  completed: false,
  operator: { identifier: uuid(2), secret: "a".repeat(43) },
  readOnly: { identifier: uuid(3), secret: "b".repeat(43) },
  initial: null,
  target: null,
  source: null,
  baseline: null,
  review: null,
  parent: null,
  consumerRenderer: null,
  blobs: [],
  observations: null,
  rows: [],
};
const observations = {
  schemaVersion: "quizforge.consumer-fixture-observations.v1",
  instanceId: base.instanceId,
  runId: base.runId,
  productId: base.productId,
  mode: "operator-services",
  suiteCompletion: null,
  plays: [],
  keys: [],
  states: [],
  reports: [],
  grants: [],
};
const grant = {
  source: "verified-bootstrap-and-cookie-digest",
  grantId: uuid(4),
  session: {
    productId: base.productId,
    playVersionId: uuid(5),
    playSnapshotSha256: "b".repeat(64),
    keyId: uuid(6),
    sessionId: uuid(7),
  },
  credentialDigest: "c".repeat(64),
  issuedAt: "2026-10-19T00:00:00.000Z",
  expiresAt: "2026-10-19T08:00:00.000Z",
  logoutObserved: false,
};
it("distinguishes a preparing manifest and operator-only observations from full consumer completion", () => {
  expect(consumerFixtureSchema.safeParse(base).success).toBe(true);
  expect(
    consumerFixtureObservationsSchema.safeParse(observations).success,
  ).toBe(true);
  expect(
    consumerFixtureObservationsSchema.safeParse({
      ...observations,
      mode: "consumer-e2e",
    }).success,
  ).toBe(false);
  expect(
    consumerFixtureSchema.safeParse({ ...base, prepared: true }).success,
  ).toBe(false);
  expect(
    consumerFixtureSchema.safeParse({ ...base, finished: true, observations })
      .success,
  ).toBe(false);
});
it("rejects raw cookie/Key/CSRF, DB-scan provenance, wrong duration and unbound or foreign grants", () => {
  expect(consumerFixtureGrantObservationSchema.safeParse(grant).success).toBe(
    true,
  );
  for (const field of ["rawKey", "cookie", "csrf", "grantToken"])
    expect(
      consumerFixtureGrantObservationSchema.safeParse({
        ...grant,
        [field]: "synthetic-forbidden",
      }).success,
    ).toBe(false);
  expect(
    consumerFixtureGrantObservationSchema.safeParse({
      ...grant,
      source: "database-product-scan",
    }).success,
  ).toBe(false);
  expect(
    consumerFixtureGrantObservationSchema.safeParse({
      ...grant,
      expiresAt: grant.issuedAt,
    }).success,
  ).toBe(false);
  expect(
    consumerFixtureObservationsSchema.safeParse({
      ...observations,
      grants: [grant],
    }).success,
  ).toBe(false);
  expect(
    consumerFixtureObservationsSchema.safeParse({
      ...observations,
      grants: [
        {
          ...grant,
          session: { ...grant.session, productId: "another-product" },
        },
      ],
    }).success,
  ).toBe(false);
});
it("rejects cross-run adoption, duplicate row keys, foreign actors and unknown authority fields", () => {
  const row = { table: "operator", key: uuid(2), sha256: "d".repeat(64) };
  expect(
    consumerFixtureSchema.safeParse({ ...base, rows: [row, row] }).success,
  ).toBe(false);
  expect(
    consumerFixtureSchema.safeParse({
      ...base,
      observations: { ...observations, runId: uuid(9) },
    }).success,
  ).toBe(false);
  expect(
    consumerFixtureSchema.safeParse({ ...base, readOnly: base.operator })
      .success,
  ).toBe(false);
  expect(
    consumerFixtureSchema.safeParse({ ...base, serverExited: true }).success,
  ).toBe(false);
  expect(
    consumerFixtureObservationsSchema.safeParse({
      ...observations,
      adoptAllProductRows: true,
    }).success,
  ).toBe(false);
});
it("requires every finite case exactly once with actual first-attempt passed status", () => {
  const summary = {
    schemaVersion: "quizforge.consumer-fixture-suite-completion.v1",
    runId: base.runId,
    cases: CONSUMER_E2E_CASES.map((caseId) => ({
      caseId,
      status: "passed",
      expectedStatus: "passed",
      retry: 0,
      repeatEachIndex: 0,
    })),
  };
  expect(consumerFixtureSuiteCompletionSchema.safeParse(summary).success).toBe(
    true,
  );
  expect(
    consumerFixtureSuiteCompletionSchema.safeParse({
      ...summary,
      cases: summary.cases.slice(1),
    }).success,
  ).toBe(false);
  for (const patch of [
    { caseId: "unknown-case" },
    { caseId: summary.cases[1]!.caseId },
    { status: "skipped" },
    { status: "failed" },
    { expectedStatus: "failed" },
    { retry: 1 },
    { repeatEachIndex: 1 },
  ]) {
    const value = structuredClone(summary);
    Object.assign(value.cases[0]!, patch);
    expect(consumerFixtureSuiteCompletionSchema.safeParse(value).success).toBe(
      false,
    );
  }
  expect(
    consumerFixtureSchema.safeParse({ ...base, completed: true }).success,
  ).toBe(false);
});
