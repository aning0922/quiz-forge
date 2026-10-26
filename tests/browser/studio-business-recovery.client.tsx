import { createRoot } from "react-dom/client";
import { StableInternalWorkspace } from "@/features/studio/internal-versions/pages";
import { InternalAuthorityProvider } from "@/features/studio/internal-versions/authority";
import { StudioShell } from "@/features/studio/shell";
const { productId } = JSON.parse(
  document.getElementById("fixture")!.textContent!,
) as { productId: string };
const session = {
  operator: {
    loginName: "synthetic.account",
    accountRevision: 1,
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Synthetic business recovery",
    role: "operator" as const,
  },
  csrfToken: "A".repeat(43),
  idleExpiresAt: "2026-10-24T08:00:00.000Z",
  absoluteExpiresAt: "2026-10-24T08:00:00.000Z",
};
createRoot(document.getElementById("root")!).render(
  <StudioShell>
    <InternalAuthorityProvider productId={productId}>
      <StableInternalWorkspace productId={productId} session={session} />
    </InternalAuthorityProvider>
  </StudioShell>,
);
