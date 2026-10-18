import { createRoot } from "react-dom/client";
import { ConsumerSessionExperienceV1 } from "@/app/(consumer)/play/[sessionId]/experience";
import { ConsumerAccessV1 } from "@/features/theme/consumer-v1/access";
import type { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
const fixture = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as { sessionId: string; font: typeof PREVIEW_FONT_ASSET };
createRoot(document.getElementById("root")!).render(
  location.pathname === "/access" ? (
    <ConsumerAccessV1 />
  ) : (
    <ConsumerSessionExperienceV1 sessionId={fixture.sessionId} />
  ),
);
