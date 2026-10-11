"use client";
import { useEffect, useState } from "react";
import { studioFetch } from "../client";
import { importMessage } from "./messages";

export function useImportRead<T>(path: string) {
  const [result, setResult] = useState<{
    path: string;
    value?: T;
    error?: string;
  }>({ path: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    studioFetch<T>(path, { signal: controller.signal }).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ path, value });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({ path, error: importMessage(error) });
      },
    );
    return () => controller.abort();
  }, [path, revision]);
  return {
    value: result.path === path ? result.value : undefined,
    error: result.path === path ? result.error : undefined,
    loading: result.path !== path,
    refresh: () => {
      setResult({ path: "" });
      setRevision((value) => value + 1);
    },
  };
}
