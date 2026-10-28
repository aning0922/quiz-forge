import { beforeAll, expect, it } from "vitest";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import { internalPlayFixture } from "@/features/product/internal-play/contracts.test-support";
import { IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-versions/implementation-catalog-v2";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";
import { resolveConsumerImplementationV2 } from "@/features/product/internal-play/implementation-server-v2";
import { accessKeyPlayImplementationAvailable } from "./implementation-availability";
import type { InternalPlaySnapshot } from "@/features/product/internal-play/contracts";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
} from "@/features/product/internal-versions/implementation-catalog";
import { engineIdentityV1Schema } from "@/features/product/internal-versions/identity-contracts";

let play: Extract<
  InternalPlaySnapshot,
  { schemaVersion: "quizforge.internal-play-snapshot.v2" }
>;
beforeAll(async () => {
  const fixture = await persistedReportFixtureV2();
  if (
    fixture.snapshot.play.snapshot.schemaVersion !==
    "quizforge.internal-play-snapshot.v2"
  )
    throw Error("V2_FIXTURE_REQUIRED");
  const runtime = resolveConsumerImplementationV2(
    CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured,
  )!;
  // Only registry availability is exercised; no sealed review, native IO or Key authority is claimed.
  play = {
    ...fixture.snapshot.play.snapshot,
    renderer: runtime.identity,
    mapping: runtime.descriptor.mapping,
    parentSnapshot: {
      ...fixture.snapshot.play.snapshot.parentSnapshot,
      engine: IMPLEMENTATION_AVAILABILITY_V2.engine,
    },
  };
});
it("admits an exact registered v2 binding and preserves historical v1 availability", async () => {
  expect(accessKeyPlayImplementationAvailable(play)).toBe(true);
  const old = (await internalPlayFixture()).play.snapshot;
  expect(accessKeyPlayImplementationAvailable(old)).toBe(false);
  expect(
    accessKeyPlayImplementationAvailable({
      ...old,
      renderer: CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
      parentSnapshot: {
        ...old.parentSnapshot,
        engine: engineIdentityV1Schema.parse(
          implementationIdentity(IMPLEMENTATION_DESCRIPTORS.engines[0]!),
        ),
      },
    }),
  ).toBe(true);
});
it("fails closed for changed engine/renderer identities and mismatched v2 mapping or capabilities", () => {
  for (const changed of [
    { ...play, renderer: { ...play.renderer, entrySha256: "0".repeat(64) } },
    {
      ...play,
      parentSnapshot: {
        ...play.parentSnapshot,
        engine: { ...play.parentSnapshot.engine, entrySha256: "0".repeat(64) },
      },
    },
    {
      ...play,
      presentation: {
        ...play.presentation,
        exports: { posterPng: true, fullReportPng: false },
      },
    },
    {
      ...play,
      mapping: {
        ...play.mapping,
        states: {
          ...play.mapping.states,
          cover: {
            ...play.mapping.states.cover,
            runtime: {
              ...play.mapping.states.cover.runtime,
              id: "consumer-unregistered-cover",
            },
          },
        },
      },
    },
  ])
    expect(accessKeyPlayImplementationAvailable(changed)).toBe(false);
});

it("admits the exact fixed-font identity without requiring descriptor-only file metadata", () => {
  const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai;
  if (!identity) throw Error("QIANZAI_BINDING_REQUIRED");
  const runtime = resolveConsumerImplementationV2(identity);
  if (!runtime || "kind" in runtime.descriptor.font)
    throw Error("FIXED_FONT_REQUIRED");
  const descriptor = runtime.descriptor,
    font = runtime.descriptor.font;
  const fixedFont = {
    id: font.id,
    version: font.version,
    weight: font.weight,
    fileSha256: font.fileSha256,
    coverageSha256: font.coverageSha256,
    licenseSha256: font.licenseSha256,
  };
  const authored: typeof play = {
    ...play,
    renderer: identity,
    mapping: descriptor.mapping,
    presentation: {
      presentationMode: descriptor.presentationMode,
      exports: descriptor.exports,
    },
    parentSnapshot: { ...play.parentSnapshot, font: fixedFont },
  };
  expect(accessKeyPlayImplementationAvailable(authored)).toBe(true);
  for (const key of ["fileSha256", "coverageSha256", "licenseSha256"] as const)
    expect(
      accessKeyPlayImplementationAvailable({
        ...authored,
        parentSnapshot: {
          ...authored.parentSnapshot,
          font: { ...fixedFont, [key]: "0".repeat(64) },
        },
      }),
    ).toBe(false);
  expect(
    accessKeyPlayImplementationAvailable({
      ...authored,
      parentSnapshot: {
        ...authored.parentSnapshot,
        font: play.parentSnapshot.font,
      },
    }),
  ).toBe(false);
});
