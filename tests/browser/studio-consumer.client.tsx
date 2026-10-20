import { createRoot } from "react-dom/client";
import { StudioConsumerAccessPageV1 } from "@/features/studio/consumer-access/page";
import type { StudioConsumerScopeV1 } from "@/features/studio/consumer-access/pending";
import type { ConsumerRendererIdentity } from "@/lib/consumer-contract/v1/identities";
import { invalidateStudioAuthority } from "@/features/studio/authority-events";
(
  window as Window & { invalidateStudioAuthority?: () => void }
).invalidateStudioAuthority = invalidateStudioAuthority;
const input = JSON.parse(document.getElementById("fixture")!.textContent!) as {
  scope: StudioConsumerScopeV1;
  renderer: ConsumerRendererIdentity;
};
createRoot(document.getElementById("root")!).render(
  <StudioConsumerAccessPageV1 {...input} />,
);
