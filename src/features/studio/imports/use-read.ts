"use client";
import { useEffect, useRef, useState } from "react";
import { studioFetch } from "../client";
import { checkedImportFetch } from "./client";
import { importMessage } from "./messages";
import { useContentAuthority } from "../product-workspace/content-authority";

export function useImportRead<T>(path: string, check?: (value: unknown) => T) {
  const authority = useContentAuthority();
  const decoder = useRef(check);
  useEffect(() => {
    decoder.current = check;
  });
  const [result, setResult] = useState<{
    path: string;
    value?: T;
    error?: string;
  }>({ path: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const read = decoder.current
      ? checkedImportFetch<T>(
          path,
          { signal: controller.signal },
          decoder.current,
        )
      : studioFetch<T>(path, { signal: controller.signal });
    read.then(
      (value) => {
        if (!controller.signal.aborted) setResult({ path, value });
      },
      (error) => {
        if (!controller.signal.aborted) {
          authority.observe(error);
          setResult({ path, error: importMessage(error) });
        }
      },
    );
    return () => controller.abort();
  }, [path, revision, authority]);
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
