import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  buildMediaDeployment,
  hardenMediaDeploymentArtifacts,
} from "../src/lib/build/media-deployment";

process.stdout.on("error", () => {
  process.exitCode = 1;
});
// Two fixed offline build targets; no arbitrary path or environment override.
if (
  process.argv.length !== 3 ||
  !["--main", "--fixture"].includes(process.argv[2]!)
) {
  process.stdout.write(
    `${JSON.stringify({ ok: false, committed: false, code: "BUILD_ARGUMENT_INVALID" })}\n`,
  );
  process.exitCode = 1;
} else {
  let result;
  try {
    const context = { deadlineMonotonicMs: performance.now() + 60000 };
    const checkoutRoot = await realpath(process.cwd());
    const roots = {
      checkoutRoot,
      deploymentRoot: path.join(
        checkoutRoot,
        process.argv[2] === "--main"
          ? ".next"
          : ".cache/quizpack-media-next-fixture/.next",
      ),
    };
    const hardening = await hardenMediaDeploymentArtifacts(roots, context);
    result = hardening.ok
      ? {
          ...(await buildMediaDeployment(roots, context)),
          hardening: hardening.summary,
        }
      : {
          ok: false,
          committed: false,
          code: hardening.code,
          hardening: hardening.summary,
        };
  } catch {
    result = { ok: false, committed: false, code: "BUILD_ROOT_INVALID" };
  }
  // A failed stdout delivery does not undo an already committed manifest.
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
