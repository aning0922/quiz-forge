import { describe, expect, it } from "vitest";
import previousKnownTen from "../internal-versions/implementation-data/d3-runtime-bindings-known-ten.json";
import { findConsumerImplementationDescriptorV2 } from "./implementation-catalog-v2";
import {
  resolveConsumerExperienceRuntimeV2,
  resolveConsumerRendererClientV2,
} from "./implementation-client-v2";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "./implementation-catalog-v2";

describe("registered Qianzai presentation runtime", () => {
  it("keeps the mounted component identity across equivalent verified facts", () => {
    const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
    const first = resolveConsumerRendererClientV2(identity)!;
    const reread = resolveConsumerRendererClientV2({ ...identity })!;
    expect(first.identity).toEqual(identity);
    expect(reread.Experience).toBe(first.Experience);
  });
  it("does not bind a new profile to an old or unknown renderer entry", () => {
    const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
    expect(
      resolveConsumerRendererClientV2({ ...identity, version: "1.1.0" }),
    ).toBeNull();
    expect(
      resolveConsumerRendererClientV2({
        ...identity,
        entrySha256: "0".repeat(64),
      }),
    ).toBeNull();
  });
});

it("requires the exact candidate renderer, font and mapping and denies previous tuples", () => {
  const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
  const runtime = resolveConsumerRendererClientV2(identity)!;
  expect(identity.version).toBe("1.5.3");
  expect(
    resolveConsumerRendererClientV2({
      ...identity,
      version: "1.3.0",
      entrySha256:
        "9732bdfd555a05ceb412ee8c8918fa9a8b076b6acff38a6035a08dd4bb4aadbe",
    }),
  ).toBeNull();
  expect(
    resolveConsumerRendererClientV2({ ...identity, version: "1.4.0" }),
  ).toBeNull();
  const font = runtime.descriptor.font;
  const facts = {
    renderer: identity,
    mapping: runtime.descriptor.mapping,
    font:
      "kind" in font
        ? font
        : {
            id: font.id,
            version: font.version,
            weight: font.weight,
            fileSha256: font.fileSha256,
            coverageSha256: font.coverageSha256,
            licenseSha256: font.licenseSha256,
          },
  };
  expect(resolveConsumerExperienceRuntimeV2(facts)).not.toBeNull();
  expect(
    resolveConsumerExperienceRuntimeV2({
      ...facts,
      font: { ...facts.font, version: "99.0.0" },
    }),
  ).toBeNull();
  expect(
    resolveConsumerExperienceRuntimeV2({
      ...facts,
      mapping: { ...facts.mapping, states: {} },
    }),
  ).toBeNull();
  expect(
    resolveConsumerRendererClientV2({
      ...identity,
      version: "1.2.0",
      entrySha256:
        "f30d39011bd930f1fa9a94f77ecf229591b50d8abd116b398bb2224dc0a9a51e",
    }),
  ).toBeNull();
  expect(
    resolveConsumerRendererClientV2({
      ...identity,
      entrySha256:
        "f30d39011bd930f1fa9a94f77ecf229591b50d8abd116b398bb2224dc0a9a51e",
    }),
  ).toBeNull();
});

it("does not reinterpret the preserved failed image trial with the corrected entry", () => {
  const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
  expect(
    resolveConsumerRendererClientV2({
      ...identity,
      entrySha256:
        "240d8ba89280eb551eeed58b0e3f89415dde6b29be0a969078b061963a218a25",
    }),
  ).toBeNull();
});

it("keeps b3 metadata while withdrawing its executable current binding", () => {
  const { kind, id, version } = previousKnownTen.qianzaiConsumer.descriptor;
  const identity = {
    kind,
    id,
    version,
    entrySha256: previousKnownTen.qianzaiConsumer.entrySha256,
  };
  expect(findConsumerImplementationDescriptorV2(identity)).not.toBeNull();
  expect(resolveConsumerRendererClientV2(identity)).toBeNull();
});
