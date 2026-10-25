"use client";

import { useEffect, useRef, useState } from "react";
import { acceptsStudioEpoch, captureStudioEpoch } from "../authority-events";
import { StudioClientError, studioFetch, studioMessage } from "../client";

/** Cancel obsolete reads; writes are explicit and are never replayed by this hook. */
export function useWorkspaceRead<T>(
  path: string | null,
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
    if (!path) return;
    const current = ++sequence.current;
    const epoch = captureStudioEpoch();
    const controller = new AbortController();
    const stale = () => {
      if (current !== sequence.current || controller.signal.aborted) return;
      // Finish this read without accepting old data or notifying a new authority.
      setResult((previous) => ({
        ...(previous.path === path ? previous : { path }),
        error: "本次读取已中断，请重新读取。",
      }));
    };
    studioFetch<T>(path, { signal: controller.signal }).then(
      (value) => {
        if (!acceptsStudioEpoch(epoch)) {
          stale();
          return;
        }
        if (current === sequence.current && !controller.signal.aborted)
          setResult({ path, value });
      },
      (error) => {
        if (
          error instanceof StudioClientError &&
          error.code === "STUDIO_REQUEST_STALE"
        ) {
          stale();
          return;
        }
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
    value: path && result.path === path ? result.value : undefined,
    error: path && result.path === path ? result.error : undefined,
    loading: Boolean(path && result.path !== path),
    refresh: () => {
      if (!path) return;
      setResult({ path: "" });
      setVersion((value) => value + 1);
    },
  };
}
