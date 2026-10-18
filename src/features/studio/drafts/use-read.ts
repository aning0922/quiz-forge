"use client";
import { useEffect, useRef, useState } from "react";
import { checkedDraftFetch } from "./client";
import { draftMessage } from "./message";
export function useDraftRead<T>(
  path: string,
  check: (value: unknown) => T | Promise<T>,
  revision = false,
) {
  const [generation, setGeneration] = useState(0),
    [state, setState] = useState<{
      path: string;
      generation: number;
      loading: boolean;
      value?: T;
      lastValue?: T;
      error?: string;
    }>({ path, generation: 0, loading: true });
  const checker = useRef(check);
  useEffect(() => {
    checker.current = check;
  });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void checkedDraftFetch(
      path,
      { signal: controller.signal },
      (value) => checker.current(value),
      { revision },
    ).then(
      (value) => {
        if (current)
          setState({
            path,
            generation,
            loading: false,
            value,
            lastValue: value,
          });
      },
      (error) => {
        if (current)
          setState((previous) => ({
            path,
            generation,
            loading: false,
            error: draftMessage(error),
            ...(previous.path === path && previous.lastValue !== undefined
              ? { lastValue: previous.lastValue }
              : {}),
          }));
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, generation, revision]);
  const active = state.path === path && state.generation === generation;
  return {
    loading: !active || state.loading,
    value: active && !state.loading ? state.value : undefined,
    // Immutable navigation scope may survive a current-pointer refresh or failure.
    // It is never presented as a newly confirmed current value.
    lastValue: state.path === path ? state.lastValue : undefined,
    error: active ? state.error : undefined,
    refresh: () => setGeneration((n) => n + 1),
  };
}
