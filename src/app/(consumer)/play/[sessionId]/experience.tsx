"use client";
import { CurrentConsumerSession } from "@/features/theme/consumer-current/session";
import { ConsumerSessionRuntimeV2 } from "@/features/theme/consumer-v2/experience";
import { resolveConsumerExperienceRuntimeV2 } from "@/features/product/internal-play/implementation-client-v2";
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

/** Current session protocol comes from a verified authorized observation, never the route. */
export function ConsumerSessionExperience({
  sessionId,
  initialScreen,
}: {
  sessionId: string;
  initialScreen?: "report";
}) {
  return (
    <CurrentConsumerSession
      sessionId={sessionId}
      {...(initialScreen ? { initialScreen } : {})}
      renderV1={(props) => <ConsumerSessionExperienceV1 {...props} />}
      renderV2={(props) => (
        <ConsumerSessionRuntimeV2
          {...props}
          resolveRuntime={resolveConsumerExperienceRuntimeV2}
        />
      )}
    />
  );
}
