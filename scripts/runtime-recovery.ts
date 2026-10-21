import {
  withQuiescentRecoverySnapshot,
  restoreManagedRecoveryData,
} from "../src/features/runtime-recovery/database";
import { createRecoveryService } from "../src/features/runtime-recovery/service";
import { runRecoveryCli } from "../src/features/runtime-recovery/cli";
import { RECOVERY_LIMITS } from "../src/features/runtime-recovery/contracts";
import { safeRecoveryError } from "../src/features/runtime-recovery/errors";

// A failed terminal/pipe delivery never undoes a completed maintenance operation.
process.stdout.on("error", () => {
  process.exitCode = 1;
});
process.stderr.on("error", () => {
  process.exitCode = 1;
});
async function main() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, RECOVERY_LIMITS.operationMs);
  timer.unref();
  process.on("SIGINT", abort);
  process.on("SIGTERM", abort);
  try {
    const budget = {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + RECOVERY_LIMITS.operationMs,
    };
    const service = createRecoveryService({
      withQuiescentRecoverySnapshot,
      restoreManagedRecoveryData,
    });
    const result = await runRecoveryCli(process.argv.slice(2), service, budget);
    process.exitCode = result.exitCode;
    await new Promise<void>((resolve) =>
      process.stdout.write(JSON.stringify(result.output) + "\n", (error) => {
        if (error) process.exitCode = 1;
        resolve();
      }),
    );
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
  }
}
main().catch((error: unknown) => {
  process.exitCode = 1;
  process.stderr.write(JSON.stringify(safeRecoveryError(error)) + "\n");
});
