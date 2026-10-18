"use client";

import { useRef, useState } from "react";
import { StudioClientError, studioFetch, studioMessage } from "../client";

export type MutationState = {
  phase: "idle" | "submitting" | "success" | "error" | "conflict" | "unknown";
  message: string;
  currentRevision?: number;
};

/** A submission is never replayed. An uncertain write requires an explicit read first. */
export function useWorkspaceMutation<T>(
  csrfToken: string,
  onError?: (error: unknown) => void,
) {
  const locked = useRef(false);
  const [state, setState] = useState<MutationState>({
    phase: "idle",
    message: "",
  });

  async function submit(
    path: string,
    method: "POST" | "PATCH",
    body: unknown,
    successMessage: string,
  ): Promise<T | undefined> {
    if (locked.current) return;
    locked.current = true;
    setState({ phase: "submitting", message: "正在提交，请等待服务器确认…" });
    try {
      const result = await studioFetch<T>(
        path,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify(body),
        },
        true,
      );
      setState({ phase: "success", message: successMessage });
      locked.current = false;
      return result;
    } catch (error) {
      onError?.(error);
      const code =
        error instanceof StudioClientError
          ? error.code
          : "WRITE_OUTCOME_UNKNOWN";
      const phase =
        code === "WRITE_OUTCOME_UNKNOWN"
          ? "unknown"
          : code === "METADATA_REVISION_CONFLICT" ||
              code === "TAXONOMY_REVISION_CONFLICT"
            ? "conflict"
            : "error";
      const revision =
        error instanceof StudioClientError ? error.currentRevision : undefined;
      setState({
        phase,
        message: studioMessage(error),
        ...(revision === undefined ? {} : { currentRevision: revision }),
      });
      // CAS conflicts also need explicit reconciliation before a fresh submission.
      locked.current = phase === "unknown" || phase === "conflict";
      return;
    }
  }

  function reconciled() {
    if (state.phase === "submitting") return;
    locked.current = false;
    setState({
      phase: "idle",
      message:
        state.phase === "conflict"
          ? "服务器当前值已确认，请检查保留的输入后按最新修订明确提交。"
          : "服务器当前值已确认。原请求结果不能仅凭当前值推断；请检查后再提交。",
    });
  }

  return {
    state,
    submit,
    reconciled,
    blocked:
      state.phase === "submitting" ||
      state.phase === "unknown" ||
      state.phase === "conflict",
  };
}
