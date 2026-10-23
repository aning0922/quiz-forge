"use client";

// Only an invalidation signal crosses tabs. No identity, credential or operation payload.
const eventName = "quizforge:studio-authority-invalidated:v1";
const channelName = "quizforge.studio-authority.v1";

/** Leaving this page invalidates local work without revoking other tabs. */
export function invalidateCurrentStudioAuthority() {
  window.dispatchEvent(new Event(eventName));
}

export function invalidateStudioAuthority() {
  invalidateCurrentStudioAuthority();
  try {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage("invalidate");
    channel.close();
  } catch {
    // Server-side fresh authorization remains mandatory when broadcast is unavailable.
  }
}

export function subscribeStudioAuthorityInvalidation(revoke: () => void) {
  window.addEventListener(eventName, revoke);
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(channelName);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === "invalidate") revoke();
    };
  } catch {
    // Same-tab invalidation and each action's fresh authorization still apply.
  }
  return () => {
    window.removeEventListener(eventName, revoke);
    channel?.close();
  };
}
