import { expect, it } from "vitest";
import {
  bindConsumerComponentsV1,
  CONSUMER_COMPONENT_MAPPING_V1,
  matchesConsumerMappingV1,
} from "./registry";

it("binds only the six exact source/runtime tuples, without legacy/latest fallback", () => {
  const bound = bindConsumerComponentsV1(CONSUMER_COMPONENT_MAPPING_V1);
  expect(bound && Object.keys(bound)).toHaveLength(6);
  for (const mutate of [
    (
      v: ReturnType<
        typeof structuredClone<typeof CONSUMER_COMPONENT_MAPPING_V1>
      >,
    ) => {
      (v.states.cover.runtime as { id: string }).id = "folio-cover";
    },
    (
      v: ReturnType<
        typeof structuredClone<typeof CONSUMER_COMPONENT_MAPPING_V1>
      >,
    ) => {
      (v.states.cover.runtime as { version: string }).version = "9.0.0";
    },
    (
      v: ReturnType<
        typeof structuredClone<typeof CONSUMER_COMPONENT_MAPPING_V1>
      >,
    ) => {
      (v.states.cover.source as { version: string }).version = "1.0.0";
    },
    (
      v: ReturnType<
        typeof structuredClone<typeof CONSUMER_COMPONENT_MAPPING_V1>
      >,
    ) => {
      (v.states.result.runtime as { id: string }).id =
        v.states.cover.runtime.id;
    },
  ]) {
    const changed = structuredClone(CONSUMER_COMPONENT_MAPPING_V1);
    mutate(changed);
    expect(bindConsumerComponentsV1(changed)).toBeNull();
  }
  expect(
    matchesConsumerMappingV1({ ...CONSUMER_COMPONENT_MAPPING_V1, extra: true }),
  ).toBe(false);
});
