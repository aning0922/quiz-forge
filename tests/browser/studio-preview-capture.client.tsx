import { createRoot } from "react-dom/client";
import { FixedRevisionPreviewPage } from "@/features/studio/preview/page";
import { StudioShell } from "@/features/studio/shell";
import type { PreviewScope } from "@/features/product/preview/contracts";
const scope = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as PreviewScope;
createRoot(document.getElementById("root")!).render(
  <StudioShell>
    <FixedRevisionPreviewPage
      scope={scope}
      session={{
        operator: {
          id: "00000000-0000-4000-8000-000000000001",
          label: "Synthetic preview capture",
          role: "operator",
        },
        csrfToken: "A".repeat(43),
        idleExpiresAt: "2026-10-20T08:00:00.000Z",
        absoluteExpiresAt: "2026-10-20T08:00:00.000Z",
      }}
    />
  </StudioShell>,
);
