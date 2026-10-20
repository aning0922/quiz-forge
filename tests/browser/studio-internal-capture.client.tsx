import { createRoot } from "react-dom/client";
import {
  InternalReviewPage,
  InternalVersionsPage,
  InternalVersionDetailPage,
} from "@/features/studio/internal-versions/pages";
import { StudioShell } from "@/features/studio/shell";
import type { InternalRevisionScope } from "@/features/product/internal-versions/urls";
const f = JSON.parse(document.getElementById("fixture")!.textContent!) as {
  scope: InternalRevisionScope;
  versionId: string;
};
const session = {
  operator: {
    id: "00000000-0000-4000-8000-000000000004",
    label: "Synthetic reader capture",
    role: "operator" as const,
  },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2026-10-20T08:00:00.000Z",
  absoluteExpiresAt: "2026-10-20T08:00:00.000Z",
};
createRoot(document.getElementById("root")!).render(
  <StudioShell>
    {location.pathname === "/list" ? (
      <InternalVersionsPage productId={f.scope.productId} session={session} />
    ) : location.pathname === "/detail" ? (
      <InternalVersionDetailPage
        productId={f.scope.productId}
        versionId={f.versionId}
        session={session}
      />
    ) : (
      <InternalReviewPage scope={f.scope} session={session} />
    )}
  </StudioShell>,
);
