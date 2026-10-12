import "server-only";
import { realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { MediaPolicyError } from "./runtime-files";
declare const __QUIZFORGE_MEDIA_CHECKOUT_ROOT__: string;
declare const __QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__: string;
export type MediaRuntimeRoots = Readonly<{
  checkoutRoot: string;
  deploymentRoot: string;
}>;
/** Next compiler.defineServer supplies these literals. No request, env or cwd fallback. */
export function fixedMediaRuntimeRoots(): MediaRuntimeRoots {
  if (
    typeof __QUIZFORGE_MEDIA_CHECKOUT_ROOT__ !== "string" ||
    typeof __QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__ !== "string"
  )
    throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
  const checkoutRoot = __QUIZFORGE_MEDIA_CHECKOUT_ROOT__,
    deploymentRoot = __QUIZFORGE_MEDIA_DEPLOYMENT_ROOT__;
  if (
    !isAbsolute(checkoutRoot) ||
    !isAbsolute(deploymentRoot) ||
    realpathSync(checkoutRoot) !== checkoutRoot ||
    realpathSync(deploymentRoot) !== deploymentRoot
  )
    throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
  return Object.freeze({ checkoutRoot, deploymentRoot });
}
export function fixedMediaPlatformRoles(
  roots: MediaRuntimeRoots,
  platform: "darwin-arm64" | "linux-x64",
) {
  const stateRoot = join(
    roots.checkoutRoot,
    ".cache/quizpack-media-runtime",
    platform,
  );
  return Object.freeze({
    stateRoot,
    controlRoot: join(stateRoot, "control"),
    capability: join(stateRoot, "capability.json"),
    identityHelper: join(stateRoot, "tools/identity-helper"),
    worker: join(
      roots.checkoutRoot,
      "src/features/quizpack/v1/media-worker.mjs",
    ),
    base: join(
      roots.checkoutRoot,
      "src/features/quizpack/server/media/internal/linux/base.json",
    ),
    seccomp: join(
      roots.checkoutRoot,
      "src/features/quizpack/server/media/internal/linux/seccomp.json",
    ),
  });
}
