import { expect, it } from "vitest";
import { prepareContentV3 } from "./v3-scoring-adapter";
import { syntheticContentV3 } from "./v3-fixtures.test-support";
import { verifyPreparedContentWitnessesV3 } from "./v3-witnesses";
it("executes a complete fixed witness set and refuses a declared but incorrect result", () => {
  const c = syntheticContentV3(),
    prepared = prepareContentV3(c);
  if (!prepared.ok) throw Error("EXPECTED_PREPARED");
  const verified = verifyPreparedContentWitnessesV3(prepared.value);
  expect(verified).toMatchObject({
    ok: true,
    value: {
      evidence: {
        status: "passed",
        entries: [
          { expectedResultRef: { id: "first" } },
          { expectedResultRef: { id: "second" } },
        ],
      },
    },
  });
  c.bindings.witnesses.entries[0]!.preference = "female";
  const bad = prepareContentV3(c);
  if (!bad.ok) throw Error("EXPECTED_PREPARED");
  expect(verifyPreparedContentWitnessesV3(bad.value).ok).toBe(false);
});
