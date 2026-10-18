import { createRoot } from "react-dom/client";
import { ConsumerExperienceV1 } from "@/features/theme/consumer-v1/host";
import { ConsumerAccessV1 } from "@/features/theme/consumer-v1/access";
import { bindConsumerRendererClientV1 } from "@/features/theme/consumer-v1/renderer-client-v1";
import type { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as { sessionId: string; font: typeof PREVIEW_FONT_ASSET };
createRoot(document.getElementById("root")!).render(
  location.pathname === "/access" ? (
    <ConsumerAccessV1 />
  ) : (
    <ConsumerExperienceV1
      sessionId={fixture.sessionId}
      resolveRuntime={(facts) =>
        bindConsumerRendererClientV1(facts.mapping, fixture.font)
      }
    />
  ),
);
