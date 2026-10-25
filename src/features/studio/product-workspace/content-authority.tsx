"use client";

import { createContext, useContext, useMemo } from "react";

import { useStudioAccountOwner } from "../accounts/session-owner";
import { StudioClientError } from "../client";
import { invalidateCurrentStudioAuthority } from "../authority-events";

export const ContentAuthorityContext = createContext<{
  canWrite: () => boolean;
  observe: (error: unknown) => void;
}>({ canWrite: () => true, observe: () => {} });

/** Embedded tasks inherit the same revocation epoch as the Product workspace. */
export function useContentAuthority() {
  const inherited = useContext(ContentAuthorityContext);
  const revoked = useStudioAccountOwner()?.revoked ?? false;
  return useMemo(
    () => ({
      canWrite: () => !revoked && inherited.canWrite(),
      observe(error: unknown) {
        inherited.observe(error);
        if (
          error instanceof StudioClientError &&
          [
            "UNAUTHENTICATED",
            "CAPABILITY_DENIED",
            "CSRF_REJECTED",
            "ORIGIN_REJECTED",
          ].includes(error.code)
        )
          invalidateCurrentStudioAuthority();
      },
    }),
    [inherited, revoked],
  );
}
