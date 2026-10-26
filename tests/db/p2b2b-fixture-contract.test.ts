import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ownerAbsent, p2b2bFixtureSchema } from "./p2b2b-fixture-contract";
afterEach(() => vi.restoreAllMocks());
function value() {
  const runId = randomUUID();
  return {
    version: 1,
    runId,
    operator: { identifier: randomUUID(), secret: "A".repeat(43) },
    readOnly: { identifier: randomUUID(), secret: "B".repeat(43) },
    productId: `e2e-validations-${runId.slice(0, 8)}`,
    imports: Array.from({ length: 3 }, () => ({
      importId: randomUUID(),
      expectedImportStateRevision: 3,
      archiveSha256: "a".repeat(64),
      archiveBytes: 2048,
    })),
  };
}
it("the private fixture binds its Product, three exact received tuples and distinct operators to one run", () => {
  expect(p2b2bFixtureSchema.safeParse(value()).success).toBe(true);
});
it.each([
  "product",
  "duplicate-import",
  "extra",
  "credential",
  "missing-import",
  "same-operator",
])(
  "%s fixture data cannot select or authorize an unrelated cleanup",
  (kind) => {
    const fixture = value();
    if (kind === "product") fixture.productId = "e2e-validations-aaaaaaaa";
    if (kind === "duplicate-import") fixture.imports[1] = fixture.imports[0]!;
    if (kind === "credential") fixture.operator.secret = "invalid";
    if (kind === "missing-import") fixture.imports.pop();
    if (kind === "same-operator")
      fixture.readOnly.identifier = fixture.operator.identifier;
    const input =
      kind === "extra" ? { ...fixture, root: "untrusted" } : fixture;
    expect(p2b2bFixtureSchema.safeParse(input).success).toBe(false);
  },
);
it.each(["ESRCH", "EPERM", "EIO", "present"])(
  "owner query %s is accepted only for strict absence",
  (kind) => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      if (kind !== "present")
        throw Object.assign(new Error("SYNTHETIC_OWNER_QUERY"), { code: kind });
      return true;
    });
    expect(ownerAbsent(12345)).toBe(kind === "ESRCH");
  },
);
it.each([0, -1, 1.5, 2147483648, NaN])(
  "invalid owner %s cannot reach a kernel query",
  (pid) => {
    const query = vi.spyOn(process, "kill");
    expect(ownerAbsent(pid)).toBe(false);
    expect(query).not.toHaveBeenCalled();
  },
);
