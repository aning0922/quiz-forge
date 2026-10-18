"use client";

import { useEffect, useRef, useState } from "react";
import { studioFetch, studioMessage } from "../client";

/** Cancel obsolete reads; writes are explicit and are never replayed by this hook. */
export function useWorkspaceRead<T>(
  path: string,
  onError?: (error: unknown) => void,
) {
  const errorObserver = useRef(onError);
  useEffect(() => {
    errorObserver.current = onError;
  });
  const [result, setResult] = useState<{
    path: string;
    value?: T;
    error?: string;
  }>({ path: "" });
  const [version, setVersion] = useState(0);
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    const controller = new AbortController();
    studioFetch<T>(path, { signal: controller.signal }).then(
      (value) => {
        if (current === sequence.current) setResult({ path, value });
      },
      (error) => {
        if (current === sequence.current && !controller.signal.aborted) {
          errorObserver.current?.(error);
          setResult({ path, error: studioMessage(error) });
        }
      },
    );
    return () => {
      sequence.current += 1;
      controller.abort();
    };
  }, [path, version]);
  return {
    value: result.path === path ? result.value : undefined,
    error: result.path === path ? result.error : undefined,
    loading: result.path !== path,
    refresh: () => {
      setResult({ path: "" });
      setVersion((value) => value + 1);
    },
  };
}
