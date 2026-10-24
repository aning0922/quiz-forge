"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { studioFetch, studioMessage } from "../client";
import type { OperationsQuery } from "../operations/contracts";
import { operationsListHref, parseOperationsQuery } from "../operations/query";
import {
  parseProductOperations,
  parseProductOperationsPage,
  parseOperationsDashboard,
} from "../operations/response";

export async function readProductOperations(
  productId: string,
  signal?: AbortSignal,
) {
  const input = await studioFetch<unknown>(
    `/api/studio/operations/products/${encodeURIComponent(productId)}`,
    { signal },
  );
  return parseProductOperations(input, productId);
}
export async function readOperationsProducts(
  query: OperationsQuery,
  signal?: AbortSignal,
) {
  const search = operationsListHref(query).split("?")[1];
  const input = await studioFetch<unknown>(
    `/api/studio/operations/products?${search}`,
    { signal },
  );
  return parseProductOperationsPage(input, query);
}
export async function readOperationsDashboard(signal?: AbortSignal) {
  return parseOperationsDashboard(
    await studioFetch<unknown>("/api/studio/operations/dashboard", { signal }),
  );
}

/** Clear old evidence before refresh; late/aborted responses cannot replace the new scope. */
function useOperationsRead<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onError?: (error: unknown) => void,
) {
  const observer = useRef(onError);
  useEffect(() => {
    observer.current = onError;
  });
  const [result, setResult] = useState<{
    loader?: typeof load;
    value?: T;
    error?: string;
  }>({});
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    load(controller.signal).then(
      (value) => {
        if (active) setResult({ loader: load, value });
      },
      (error) => {
        if (active && !controller.signal.aborted) {
          observer.current?.(error);
          setResult({ loader: load, error: studioMessage(error) });
        }
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [load, version]);
  return {
    value: result.loader === load ? result.value : undefined,
    error: result.loader === load ? result.error : undefined,
    loading: result.loader !== load,
    refresh: () => {
      setResult({});
      setVersion((current) => current + 1);
    },
  };
}
export function useProductOperations(
  productId: string,
  onError?: (error: unknown) => void,
) {
  const load = useCallback(
    (signal: AbortSignal) => readProductOperations(productId, signal),
    [productId],
  );
  return useOperationsRead(load, onError);
}
export function useOperationsProducts(query: OperationsQuery) {
  const search = operationsListHref(query).split("?")[1];
  const load = useCallback(
    (signal: AbortSignal) =>
      readOperationsProducts(
        parseOperationsQuery(new URLSearchParams(search)),
        signal,
      ),
    [search],
  );
  return useOperationsRead(load);
}
export function useOperationsDashboard() {
  return useOperationsRead(readOperationsDashboard);
}
