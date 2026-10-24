"use client";

import { createContext, useContext } from "react";
import type { useProductOperations } from "../operations-ui/read";

export type ProductWorkspaceContextValue = {
  productId: string;
  read: ReturnType<typeof useProductOperations>;
};
export const ProductWorkspaceContext =
  createContext<ProductWorkspaceContextValue | null>(null);

/** Read-only evidence. Never use this context as write authority or a fixed operation target. */
export function useProductWorkspaceContext() {
  return useContext(ProductWorkspaceContext);
}
