import { realpath } from "node:fs/promises";
import path from "node:path";
import { buildMediaDeployment } from "../src/lib/build/media-deployment";

process.stdout.on("error", () => {
  process.exitCode = 1;
});
// Fixture selection is intentionally unavailable until Root supplies a fixed
// fixture layout. No arbitrary path argument or runtime environment override.
if (process.argv.length !== 3 || process.argv[2] !== "--main") {
  process.stdout.write(
    `${JSON.stringify({ ok: false, committed: false, code: "BUILD_ARGUMENT_INVALID" })}\n`,
  );
  process.exitCode = 1;
} else {
  let result;
  try {
    const checkoutRoot = await realpath(process.cwd());
    result = await buildMediaDeployment(
      { checkoutRoot, deploymentRoot: path.join(checkoutRoot, ".next") },
      { deadlineMonotonicMs: performance.now() + 60000 },
    );
  } catch {
    result = { ok: false, committed: false, code: "BUILD_ROOT_INVALID" };
  }
  // A failed stdout delivery does not undo an already committed manifest.
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
