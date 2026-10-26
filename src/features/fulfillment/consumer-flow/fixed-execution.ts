import "server-only";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { StudioError } from "@/lib/http-security/errors";
import type { ConsumerFixedSource } from "@/features/quizpack/consumer-fixed-source";
import { readPrivateResource } from "@/features/quizpack/resource-read/storage";
import {
  INTERNAL_VERSION_LIMITS,
  type InternalVersionSnapshot,
} from "@/features/product/internal-versions/contracts";
import { resolveEngineImplementation } from "@/features/product/internal-versions/implementation-server";
import { verifyFixedFontFiles } from "@/features/product/internal-versions/verify-font";
import { resolveConsumerImplementation } from "@/features/product/internal-play/implementation-server";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import type { ConsumerIoContext } from "./request-owner";
import type { InternalVersionWork } from "@/features/product/internal-versions/lifecycle";
import type { ResolvedPreviewResource } from "@/features/product/preview/repository";
import { resolveEngineImplementationV2 } from "@/features/product/internal-versions/implementation-server-v2";
import { resolveConsumerImplementationV2 } from "@/features/product/internal-play/implementation-server-v2";
import {
  matchesDisplayCapabilitiesV2,
  type DisplayCapabilitiesV2,
} from "@/lib/assessment-contract/display-v2";

function fontIdentity(
  font: NonNullable<
    ReturnType<typeof resolveConsumerImplementationV2>
  >["descriptor"]["font"],
) {
  return "kind" in font
    ? font
    : {
        id: font.id,
        version: font.version,
        fileSha256: font.fileSha256,
        coverageSha256: font.coverageSha256,
        licenseSha256: font.licenseSha256,
        weight: font.weight,
      };
}

export function fixedConsumerExecution(
  parent: InternalVersionSnapshot,
  renderer: ConsumerRendererIdentity,
  source: ConsumerFixedSource,
  presentation?: DisplayCapabilitiesV2,
) {
  if (parent.schemaVersion === "quizforge.internal-version-snapshot.v2") {
    const engine = resolveEngineImplementationV2(parent.engine),
      display = resolveConsumerImplementationV2(renderer);
    if (
      !engine ||
      !display ||
      source.content.schemaVersion !== "quizpack-content.v3" ||
      !presentation ||
      !matchesDisplayCapabilitiesV2(presentation, display.descriptor) ||
      !sameConsumerFact(
        fontIdentity(display.descriptor.font),
        parent.font,
        L.playRequestBytes,
      ) ||
      !sameConsumerFact(
        engine.descriptor.algorithm,
        source.evidence.versions.engine,
        L.playRequestBytes,
      ) ||
      (
        Object.keys(
          display.descriptor.mapping.states,
        ) as (keyof typeof display.descriptor.mapping.states)[]
      ).some(
        (state) =>
          !sameConsumerFact(
            display.descriptor.mapping.states[state].source,
            parent.components[state],
            L.playRequestBytes,
          ),
      )
    )
      throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
    const prepared = engine.prepare(source.content);
    if (!prepared.ok) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
    return Object.freeze({
      version: 2 as const,
      engine,
      display,
      prepared: prepared.value,
    });
  }
  if (
    source.content.schemaVersion !== "quizpack-content.v2" ||
    presentation !== undefined
  )
    throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
  const engine = resolveEngineImplementation(parent.engine),
    display = resolveConsumerImplementation(renderer);
  const font = display?.descriptor.font;
  if (
    !engine ||
    !display ||
    !font ||
    !sameConsumerFact(
      {
        id: font.id,
        version: font.version,
        fileSha256: font.fileSha256,
        coverageSha256: font.coverageSha256,
        licenseSha256: font.licenseSha256,
        weight: font.weight,
      },
      parent.font,
      L.playRequestBytes,
    ) ||
    (
      Object.keys(
        display.descriptor.mapping.states,
      ) as (keyof typeof display.descriptor.mapping.states)[]
    ).some(
      (state) =>
        !sameConsumerFact(
          display.descriptor.mapping.states[state].source,
          parent.components[state],
          L.playRequestBytes,
        ),
    ) ||
    !sameConsumerFact(
      engine.descriptor.algorithm,
      source.evidence.versions.engine,
      L.playRequestBytes,
    )
  )
    throw new ConsumerError("UNSUPPORTED_IMPLEMENTATION");
  const prepared = engine.prepare(source.content);
  if (!prepared.ok) throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  return Object.freeze({
    version: 1 as const,
    engine,
    display,
    prepared: prepared.value,
  });
}
/** No row/auth write lock is held while reading source images/font. All FDs settle before final TX. */
export async function verifyConsumerExecutionIo(
  io: ConsumerIoContext,
  parent: InternalVersionSnapshot,
  renderer: ConsumerRendererIdentity,
  source: ConsumerFixedSource,
  presentation?: DisplayCapabilitiesV2,
) {
  const fixed = fixedConsumerExecution(parent, renderer, source, presentation);
  io.checkpoint();
  const witnesses =
    fixed.version === 2
      ? fixed.engine.witnesses(fixed.prepared)
      : fixed.engine.witnesses(fixed.prepared);
  if (
    !witnesses.ok ||
    witnesses.value.evidence.status !== "passed" ||
    witnesses.value.evidence.logicHash !== parent.logicHash ||
    witnesses.value.sourceBinding.canonicalContentSha256 !==
      source.evidence.canonicalContentSha256
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  const timeout = () => io.task.stop(new StudioError("PREVIEW_TIMEOUT"));
  const quarantine = (resource: unknown) => {
    io.task.quarantine(resource);
    io.task.quarantine(io.guard);
  };
  // Existing verifier consumes only these read lifecycle methods; writes remain explicitly unavailable.
  const fontContext: InternalVersionWork = {
    checkpoint: io.checkpoint,
    checkGuard: () => io.guard.check(),
    timeout,
    quarantine,
    async write() {
      throw new ConsumerError("INVALID_REQUEST");
    },
  };
  const font = fixed.display.descriptor.font;
  if (!("kind" in font))
    await verifyFixedFontFiles(
      font,
      fixed.display.descriptor.closure.files,
      fontContext,
    );
  const resources = new Map(
    source.evidence.resources.map((r) => [r.sha256, r]),
  );
  if (
    source.evidence.resources.length > INTERNAL_VERSION_LIMITS.resources ||
    resources.size > INTERNAL_VERSION_LIMITS.resources ||
    [...resources.values()].reduce((n, r) => n + r.bytes, 0) >
      INTERNAL_VERSION_LIMITS.resourceBytes
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
  for (const [, resource] of [...resources].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    io.checkpoint();
    await io.guard.check();
    await readPrivateResource(
      io.db.config,
      resource,
      io.checkpoint,
      timeout,
      quarantine,
    );
    io.checkpoint();
    await io.guard.check();
  }
  return fixed;
}
export async function readConsumerResourceIo(
  io: ConsumerIoContext,
  resource: ResolvedPreviewResource,
) {
  io.checkpoint();
  await io.guard.check();
  const bytes = await readPrivateResource(
    io.db.config,
    resource,
    io.checkpoint,
    () => io.task.stop(new StudioError("PREVIEW_TIMEOUT")),
    (handle) => {
      io.task.quarantine(handle);
      io.task.quarantine(io.guard);
    },
  );
  io.checkpoint();
  await io.guard.check();
  return bytes;
}
