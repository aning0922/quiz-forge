import type { OperationsQuery } from "../operations/contracts";
import { catalogPageHref } from "./list-query";
const eventName = "quizforge:catalog-query";

/** Only this read-only list's query is pushed; no global routing is intercepted. */
export function pushCatalogQuery(query: OperationsQuery | null) {
  window.history.pushState(
    null,
    "",
    query ? catalogPageHref(query) : "/studio/products",
  );
  window.dispatchEvent(new Event(eventName));
}
export function subscribeCatalogQuery(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(eventName, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(eventName, listener);
  };
}
export const catalogQuerySnapshot = () => window.location.search;
export const catalogServerSnapshot = () => null;
