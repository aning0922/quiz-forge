import { createRoot } from "react-dom/client";
import { DraftWorkspacePage } from "@/features/studio/drafts/read-page";
import { StudioShell } from "@/features/studio/shell";

createRoot(document.getElementById("root")!).render(
  <StudioShell>
    <DraftWorkspacePage
      productId="capture-fixture"
      session={{
        operator: {
          id: "00000000-0000-4000-8000-000000000001",
          label: "Synthetic capture",
          role: "operator",
        },
        csrfToken: "A".repeat(43),
        idleExpiresAt: "2026-10-19T08:00:00.000Z",
        absoluteExpiresAt: "2026-10-19T08:00:00.000Z",
      }}
    />
  </StudioShell>,
);
