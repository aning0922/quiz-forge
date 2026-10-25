"use client";

import { useEffect } from "react";

/** Only presentation state crosses the retained task boundary; never File or operation tuples. */
export type ContentTaskState = {
  busy: boolean;
  pending: boolean;
  retained: boolean;
  message?: string | undefined;
  blockCloseReason?: string | undefined;
};
export type ContentStateObserver = (state: ContentTaskState) => void;

export function useContentTaskState(
  observer: ContentStateObserver | undefined,
  { busy, pending, retained, message, blockCloseReason }: ContentTaskState,
) {
  useEffect(() => {
    observer?.({ busy, pending, retained, message, blockCloseReason });
  }, [observer, busy, pending, retained, message, blockCloseReason]);
}
