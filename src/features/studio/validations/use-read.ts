"use client";
import { useEffect, useRef, useState } from "react";
import { checkedValidationFetch } from "./client";
import { validationMessage } from "./messages";
import { useContentAuthority } from "../product-workspace/content-authority";
export function useValidationRead<T>(
  path: string,
  check: (value: unknown) => T,
  onValue?: (value: T) => void,
) {
  const authority = useContentAuthority();
  const decoder = useRef(check);
  const receive = useRef(onValue);
  useEffect(() => {
    decoder.current = check;
    receive.current = onValue;
  });
  const [result, setResult] = useState<{
    path: string;
    value?: T;
    error?: string;
  }>({ path: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const onSuccess = receive.current;
    checkedValidationFetch(
      path,
      { signal: controller.signal },
      decoder.current,
    ).then(
      (value) => {
        if (!controller.signal.aborted) {
          onSuccess?.(value);
          setResult({ path, value });
        }
      },
      (error) => {
        if (!controller.signal.aborted) {
          authority.observe(error);
          setResult({ path, error: validationMessage(error) });
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
