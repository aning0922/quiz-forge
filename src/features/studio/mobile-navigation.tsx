"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

function useNavigationController() {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const id = useId(),
    pathname = usePathname();
  const registerDialog = useCallback((element: HTMLDialogElement | null) => {
    dialogRef.current = element;
  }, []);
  const registerTrigger = useCallback((element: HTMLButtonElement | null) => {
    triggerRef.current = element;
  }, []);
  const open = useCallback(() => {
    const element = dialogRef.current;
    if (!element || window.matchMedia("(min-width: 960px)").matches) return;
    if (element.open) element.close();
    element.showModal();
    setExpanded(true);
    element
      .querySelector<HTMLButtonElement>("[data-navigation-close]")
      ?.focus();
  }, []);
  const close = useCallback(() => {
    if (!dialogRef.current?.matches(":modal")) return;
    dialogRef.current.close();
    setExpanded(false);
    if (!window.matchMedia("(min-width: 960px)").matches)
      triggerRef.current?.focus();
  }, []);
  const closed = useCallback(() => {
    setExpanded(false);
  }, []);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 960px)");
    function adapt() {
      const element = dialogRef.current;
      if (!element) return;
      if (element.open) element.close();
      if (desktop.matches) element.setAttribute("open", "");
    }
    adapt();
    desktop.addEventListener("change", adapt);
    return () => desktop.removeEventListener("change", adapt);
  }, []);
  useEffect(() => {
    if (dialogRef.current?.matches(":modal")) dialogRef.current.close();
  }, [pathname]);
  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [expanded]);
  return { registerDialog, registerTrigger, expanded, id, open, close, closed };
}
const NavigationContext = createContext<ReturnType<
  typeof useNavigationController
> | null>(null);
export function StudioMobileNavigation({ children }: { children: ReactNode }) {
  const navigation = useNavigationController();
  return (
    <NavigationContext.Provider value={navigation}>
      {children}
    </NavigationContext.Provider>
  );
}
export function useStudioMobileNavigation() {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw Error("STUDIO_NAVIGATION_PROVIDER_REQUIRED");
  return navigation;
}
