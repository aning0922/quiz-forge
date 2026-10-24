"use client";

import { createContext, useContext } from "react";

export const ContentAuthorityContext = createContext<{
  canWrite: () => boolean;
  observe: (error: unknown) => void;
}>({ canWrite: () => true, observe: () => {} });

/** Embedded tasks inherit the same revocation epoch as the Product workspace. */
export function useContentAuthority() {
  return useContext(ContentAuthorityContext);
}
