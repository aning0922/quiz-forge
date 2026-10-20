"use client";
import { ConsumerExperienceV1 } from "@/features/theme/consumer-v1/host";
import { resolveConsumerExperienceRuntime } from "@/features/product/internal-play/implementation-client";
/** Keep the catalog outside the renderer closure; project exactly the resolver's three fields. */
export function ConsumerSessionExperienceV1({
  sessionId,
  initialScreen,
}: {
  sessionId: string;
  initialScreen?: "report";
}) {
  return (
    <ConsumerExperienceV1
      sessionId={sessionId}
      {...(initialScreen ? { initialScreen } : {})}
      resolveRuntime={({ renderer, mapping, font }) =>
        resolveConsumerExperienceRuntime({ renderer, mapping, font })
      }
    />
  );
}
