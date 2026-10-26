import "server-only";
import type { InternalPlaySnapshot } from "@/features/product/internal-play/contracts";
import { resolveConsumerImplementation } from "@/features/product/internal-play/implementation-server";
import { resolveEngineImplementation } from "@/features/product/internal-versions/implementation-server";
import { resolveConsumerImplementationV2 } from "@/features/product/internal-play/implementation-server-v2";
import { resolveEngineImplementationV2 } from "@/features/product/internal-versions/implementation-server-v2";
import { matchesDisplayCapabilitiesV2 } from "@/lib/assessment-contract/display-v2";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";

/** The immutable play selects the registry. A request never selects its protocol. */
export function accessKeyPlayImplementationAvailable(
  play: InternalPlaySnapshot,
) {
  if (play.schemaVersion === "quizforge.internal-play-snapshot.v1")
    return Boolean(
      resolveConsumerImplementation(play.renderer) &&
      resolveEngineImplementation(play.parentSnapshot.engine),
    );
  const display = resolveConsumerImplementationV2(play.renderer),
    engine = resolveEngineImplementationV2(play.parentSnapshot.engine);
  return Boolean(
    display &&
    engine &&
    matchesDisplayCapabilitiesV2(play.presentation, display.descriptor) &&
    sameConsumerFact(
      play.mapping,
      display.descriptor.mapping,
      L.playRequestBytes,
    ) &&
    sameConsumerFact(
      play.parentSnapshot.font,
      display.descriptor.font,
      L.playRequestBytes,
    ),
  );
}
