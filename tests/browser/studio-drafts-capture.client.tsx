import { createRoot } from "react-dom/client";
import { DraftWorkspacePage } from "@/features/studio/drafts/read-page";
import { StudioShell } from "@/features/studio/shell";
import { ValidationDetailPage } from "@/features/studio/validations/detail-page";

createRoot(document.getElementById("root")!).render(
  <StudioShell>
    {location.pathname === "/read-only-empty" ? (
      <ValidationDetailPage
        productId="capture-fixture"
        importId="00000000-0000-4000-8000-000000000004"
        validationId="00000000-0000-4000-8000-000000000006"
        session={{
          operator: {
            id: "00000000-0000-4000-8000-000000000001",
            label: "Synthetic capture",
            role: "read-only",
          },
          csrfToken: "A".repeat(43),
          idleExpiresAt: "2026-10-19T08:00:00.000Z",
          absoluteExpiresAt: "2026-10-19T08:00:00.000Z",
        }}
      />
    ) : (
      <DraftWorkspacePage
        productId="capture-fixture"
        session={{
          operator: {
            id: "00000000-0000-4000-8000-000000000001",
            label: "Synthetic capture",
            role:
              new URLSearchParams(location.search).get("role") === "read-only"
                ? "read-only"
                : "operator",
          },
          csrfToken: "A".repeat(43),
          idleExpiresAt: "2026-10-19T08:00:00.000Z",
          absoluteExpiresAt: "2026-10-19T08:00:00.000Z",
        }}
      />
    )}
  </StudioShell>,
);
