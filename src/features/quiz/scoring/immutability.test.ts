import { expect, it } from "vitest";
import { compiled } from "./prepare";
import { prepareScoringDefinition, scoreCompleteAnswers } from "./index";
import { syntheticDefinition, syntheticAnswers } from "./fixtures/synthetic";

it("internal accessor cannot expose a mutable index, replace compiled fields or mutate option vectors", () => {
  const prepared = prepareScoringDefinition(syntheticDefinition());
  if (!prepared.ok) throw new Error("TEST_PREPARE_FAILED");
  const c = compiled(prepared.value)!;
  const before = scoreCompleteAnswers(prepared.value, syntheticAnswers(2));
  expect(before.ok).toBe(true);
  expect(Object.isFrozen(c)).toBe(true);
  expect(Object.isFrozen(c.lookupOption)).toBe(true);
  expect(Object.hasOwn(c, "options")).toBe(false);
  expect(Object.values(c).some((v) => v instanceof Map)).toBe(false);
  expect(Reflect.set(c, "definition", syntheticDefinition("dimensions"))).toBe(
    false,
  );
  expect(Reflect.set(c, "identity", { logicHash: "a".repeat(64) })).toBe(false);
  expect(
    Reflect.set(c, "lookupOption", () => ({
      questionIndex: 0,
      values: [100, 100],
    })),
  ).toBe(false);
  expect(Reflect.set(c.minima, 0, -100)).toBe(false);
  expect(Reflect.set(c.maxima, 0, 100)).toBe(false);
  expect(Reflect.set(c.definition.questions[0]!.ref, "id", "changed")).toBe(
    false,
  );
  const option = c.lookupOption("q-0-o-2")!;
  expect(Object.isFrozen(option)).toBe(true);
  expect(Object.isFrozen(option.values)).toBe(true);
  expect(Reflect.set(option, "questionIndex", 1)).toBe(false);
  expect(Reflect.set(option.values, 0, -100)).toBe(false);
  expect(scoreCompleteAnswers(prepared.value, syntheticAnswers(2))).toEqual(
    before,
  );
  expect(c.lookupOption("missing")).toBeUndefined();
});
