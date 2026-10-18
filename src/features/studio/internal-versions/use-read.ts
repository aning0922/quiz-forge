"use client";
import { useEffect, useRef, useState } from "react";
import { StudioClientError } from "../client";
import { internalVersionMessage } from "./message";
/** Every refresh immediately removes confirmation authority, including equal subsequent DTOs. */
export function useInternalRead<T>(
  path: string,
  load: (signal: AbortSignal) => Promise<T>,
) {
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  const [generation, setGeneration] = useState(0),
    [result, setResult] = useState<{
      path: string;
      generation: number;
      value?: T;
      error?: string;
      code?: string;
    }>();
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    void loader.current(controller.signal).then(
      (value) => {
        if (current) setResult({ path, generation, value });
      },
      (error) => {
        if (current)
          setResult({
            path,
            generation,
            error: internalVersionMessage(error),
            code:
              error instanceof StudioClientError
                ? error.code
                : "STUDIO_UNAVAILABLE",
          });
      },
    );
    return () => {
      current = false;
      controller.abort();
    };
  }, [path, generation]);
  const active = result?.path === path && result.generation === generation;
  return {
    value: active ? result.value : undefined,
    error: active ? result.error : undefined,
    code: active ? result.code : undefined,
    loading: !active,
    refresh: () => setGeneration((n) => n + 1),
  };
}
