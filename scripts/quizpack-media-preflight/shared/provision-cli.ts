import { provisionOfflineRuntime } from "./provision";
import type { RuntimeTarget } from "./runtime";

// Offline-exclusive operator entry: root serializes setup/matrix/seal with normal
// services stopped. This is a required caller precondition, not a controller lease.
// This module is never imported by an HTTP route.
const args = process.argv.slice(2);
const target: RuntimeTarget | null =
  args.length === 1 && args[0] === "--runtime-target=main"
    ? "main"
    : args.length === 1 && args[0] === "--runtime-target=fixture"
      ? "fixture"
      : null;
if (!target) {
  process.stdout.write(
    JSON.stringify({
      outcome: "failed",
      code: "INVALID_TARGET",
      capabilityCommitted: false,
      recordCommitted: false,
    }) + "\n",
  );
  process.exitCode = 1;
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  const result = await provisionOfflineRuntime(target, controller.signal);
  process.stdout.write(
    JSON.stringify({ mode: "offline-exclusive", ...result }) + "\n",
  );
  process.exitCode = result.outcome === "sealed" ? 0 : 1;
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
}
