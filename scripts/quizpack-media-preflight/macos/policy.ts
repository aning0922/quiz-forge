// Offline role mapping and candidate sealing; the production policy/permissions live in media.
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadMacPolicy,
  supportedOSInfo,
  macPolicyComponentId,
  type MacPolicy,
} from "../../../src/features/quizpack/server/media/internal/macos/policy";
import {
  hashBytes as sha,
  hashFile,
  MediaPolicyError as PolicyError,
} from "../../../src/features/quizpack/server/media/internal/runtime-files";
export { supportedOSInfo, PolicyError };
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const targetArg = process.argv.find((arg) =>
  arg.startsWith("--runtime-target="),
);
export const RUNTIME_TARGET =
  targetArg === undefined
    ? null
    : targetArg === "--runtime-target=main"
      ? "main"
      : targetArg === "--runtime-target=fixture"
        ? "fixture"
        : (() => {
            throw new Error("INVALID_RUNTIME_TARGET");
          })();
if (RUNTIME_TARGET && process.argv.includes("--record-capability"))
  throw new Error("INVALID_RUNTIME_TARGET");
export const RUNTIME_ROOTS = {
  checkoutRoot: resolve(REPO_ROOT),
  deploymentRoot: resolve(
    REPO_ROOT,
    RUNTIME_TARGET === "fixture"
      ? ".cache/quizpack-media-next-fixture/.next"
      : ".next",
  ),
};
export const RUNTIME_STATE = resolve(
  REPO_ROOT,
  ".cache/quizpack-media-runtime/darwin-arm64",
);
export const MAC_ROOT = resolve(
  REPO_ROOT,
  ".cache/quizpack-media-preflight/macos",
);
export const WORKER = resolve(
  REPO_ROOT,
  "src/features/quizpack/v1/media-worker.mjs",
);
export const FAULT_WORKER = fileURLToPath(
  new URL("./fault-worker.mjs", import.meta.url),
);
export const POSIX_PROBE = resolve(MAC_ROOT, "tools/posix-probe");
export const MAC_PROBE = resolve(MAC_ROOT, "tools/mac-probe");
export const MAC_IDENTITY_HELPER = resolve(
  RUNTIME_TARGET ? RUNTIME_STATE : MAC_ROOT,
  "tools/identity-helper",
);
export const SANDBOX = "/usr/bin/sandbox-exec";
export type Policy = MacPolicy;
export function loadPolicy(
  kind: "worker" | "fault" | "posix" | "mac" = "worker",
): Policy {
  const node = realpathSync(process.execPath);
  const executable =
    kind === "posix" ? POSIX_PROBE : kind === "mac" ? MAC_PROBE : node;
  const script = kind === "fault" ? FAULT_WORKER : WORKER;
  const offlineIdentity = [
    "macos/policy.ts",
    "macos/launcher.ts",
    "macos/control.ts",
    "macos/protocol.ts",
    "macos/mac-probe.c",
    "shared/posix-probe.c",
    "macos/fault-worker.mjs",
    "macos/harness.ts",
  ].map((role) => ({
    role,
    sha256: hashFile(
      resolve(REPO_ROOT, "scripts/quizpack-media-preflight", role),
    ),
  }));
  return loadMacPolicy(
    { checkoutRoot: REPO_ROOT, identityHelper: MAC_IDENTITY_HELPER },
    () => {},
    RUNTIME_TARGET && kind === "worker"
      ? undefined
      : { kind, executable, script, offlineIdentity },
  );
}
export function readSyntheticPolicySummary(): Record<string, unknown> {
  const p = loadPolicy();
  return {
    profileId: p.profileId,
    ...p.identity,
    dependencies: (p.identity.dependencies as { sha256: string }[]).map(
      (d) => ({ sha256: d.sha256 }),
    ),
    profileSha256: sha(p.profile),
  };
}
// Read only this source to bind the launcher policy implementation in the harness report.
export const POLICY_SOURCE_HASH = sha(
  readFileSync(fileURLToPath(import.meta.url)),
);

/** Relocation keeps the frozen role-to-code mapping; actual fixed read literals stay
 * bound to profileId. No per-run scope is permitted. */
export function policyComponentId(policy: Policy): string {
  return macPolicyComponentId(policy);
}
export const CAPABILITY_FILE = fileURLToPath(
  new URL("./supported-policy.json", import.meta.url),
);
export function policySupported(policy: Policy): boolean {
  try {
    const fd = openSync(
      CAPABILITY_FILE,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > 1024) return false;
      const b = Buffer.alloc(1025);
      const n = readSync(fd, b, 0, b.length, 0);
      if (n > 1024 || n !== st.size) return false;
      const text = b.subarray(0, n).toString("utf8");
      const value: unknown = JSON.parse(text);
      if (JSON.stringify(value) !== text.replace(/[ \t\r\n]/g, ""))
        return false;
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).join() !== "schema,componentId"
      )
        return false;
      const v = value as { schema: unknown; componentId: unknown };
      return (
        v.schema === "mac-media-capability.v1" &&
        v.componentId === policyComponentId(policy)
      );
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}
