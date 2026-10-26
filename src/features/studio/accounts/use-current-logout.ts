"use client";

import { useRef, useState } from "react";
import type { StudioSessionDto } from "../contracts";
import { studioFetch, studioMessage } from "../client";
import { useStudioLogoutNavigation } from "../navigation-boundary";
import {
  invalidateCurrentStudioAuthority,
  invalidateStudioAuthority,
} from "../authority-events";
import { useOwnedStudioSession, useStudioAccountOwner } from "./session-owner";

/** Shared by self/security and the sidebar; a request never crosses identity epochs. */
export function useCurrentStudioLogout(initialSession: StudioSessionDto) {
  const session = useOwnedStudioSession(initialSession);
  const owner = useStudioAccountOwner();
  const navigate = useStudioLogoutNavigation();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(onLeaving: () => void) {
    if (locked.current || owner?.revoked) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    // Only local revocation before fetch. Broadcasting here would invalidate
    // our own response epoch through the account owner's separate channel.
    invalidateCurrentStudioAuthority();
    try {
      await studioFetch<void>("/api/studio/auth/logout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        },
        body: "{}",
      });
      onLeaving();
      invalidateStudioAuthority();
      navigate();
    } catch (error) {
      // Settle first, then broadcast. Keep the error and revoked owner; no retry.
      invalidateStudioAuthority();
      setMessage(studioMessage(error));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return { busy, message, submit, clearMessage: () => setMessage("") };
}
