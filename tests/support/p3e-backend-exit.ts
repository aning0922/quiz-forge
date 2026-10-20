import { setTimeout as delay } from "node:timers/promises";
import {
  assertServerExitProof,
  type PreviewServerIdentity,
  type ServerExitProof,
} from "./p3c-server-owner";

type BackendState = { connections: number; guards: number };

/** Test-only observation; child exit does not certify PostgreSQL backend exit. */
export async function observeP3eBackendExit(
  proof: ServerExitProof,
  identity: PreviewServerIdentity,
  read: () => Promise<BackendState | undefined>,
): Promise<BackendState> {
  assertServerExitProof(proof, identity);
  // Match the existing P4 backend-exit observation bound, not a resource TTL.
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    const state = await read(); // Query failures propagate; never retry an unknown read.
    if (!state) throw Error("CLOSE_FAULT_BACKEND_STATE_MISSING_PRESERVED");
    if (
      performance.now() < deadline &&
      state.connections === 0 &&
      state.guards === 0
    )
      return state;
    await delay(Math.min(10, Math.max(0, deadline - performance.now())));
  }
  throw Error("CLOSE_FAULT_BACKENDS_EXIT_UNPROVEN_PRESERVED");
}
