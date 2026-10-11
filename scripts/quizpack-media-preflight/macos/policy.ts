import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { MEDIA_LIMITS } from "../shared/contracts";
export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
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
export const SANDBOX = "/usr/bin/sandbox-exec";
export type Policy = {
  profile: string;
  profileId: string;
  node: string;
  identity: Record<string, unknown>;
};
export class PolicyError extends Error {
  constructor(readonly code: "UNSUPPORTED_PLATFORM" | "ISOLATION_UNAVAILABLE") {
    super(code);
  }
}
const sha = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
function fileHash(path: string): string {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 128 * 1024 * 1024)
      throw new PolicyError("ISOLATION_UNAVAILABLE");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      total += n;
      if (total > before.size) throw new PolicyError("ISOLATION_UNAVAILABLE");
      hash.update(chunk.subarray(0, n));
    }
    const after = fstatSync(fd);
    if (
      total !== before.size ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.size !== after.size
    )
      throw new PolicyError("ISOLATION_UNAVAILABLE");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
function treeHash(root: string): string {
  const entries: { path: string; hash: string }[] = [];
  let count = 0;
  let bytes = 0;
  function walk(path: string, relative: string) {
    for (const name of readdirSync(path).sort()) {
      if (++count > 2048) throw new PolicyError("ISOLATION_UNAVAILABLE");
      const full = join(path, name),
        st = lstatSync(full);
      if (st.isSymbolicLink()) throw new PolicyError("ISOLATION_UNAVAILABLE");
      if (st.isDirectory()) walk(full, `${relative}${name}/`);
      else if (st.isFile()) {
        bytes += st.size;
        if (bytes > 128 * 1024 * 1024)
          throw new PolicyError("ISOLATION_UNAVAILABLE");
        entries.push({ path: `${relative}${name}`, hash: fileHash(full) });
      } else throw new PolicyError("ISOLATION_UNAVAILABLE");
    }
  }
  walk(root, "");
  return sha(JSON.stringify(entries));
}
/** Same permission template for normal and probes. Only the initial executable/code
 * read literals differ for the closed harness, and are included in identity. No per-run paths. */
export function supportedOSInfo(text: string): boolean {
  return (
    /^ProductVersion:\s*26\.6\.2$/m.test(text) &&
    /^BuildVersion:\s*25G83$/m.test(text)
  );
}
export function loadPolicy(
  kind: "worker" | "fault" | "posix" | "mac" = "worker",
): Policy {
  try {
    if (
      process.platform !== "darwin" ||
      process.arch !== "arm64" ||
      process.version !== "v20.20.1"
    )
      throw new PolicyError("UNSUPPORTED_PLATFORM");
    const version = spawnSync("/usr/bin/sw_vers", [], {
      env: { NODE_ENV: "production" },
      timeout: 1000,
      maxBuffer: 1024,
      cwd: REPO_ROOT,
    });
    const os = version.stdout?.toString();
    if (version.status !== 0 || !os || !supportedOSInfo(os))
      throw new PolicyError("UNSUPPORTED_PLATFORM");
    if (sharp.versions.sharp !== "0.35.5" || sharp.versions.vips !== "8.18.7")
      throw new PolicyError("UNSUPPORTED_PLATFORM");
    const helperDirectory = lstatSync(dirname(MAC_PROBE));
    const helper = lstatSync(MAC_PROBE);
    if (
      helperDirectory.isSymbolicLink() ||
      !helperDirectory.isDirectory() ||
      helperDirectory.uid !== process.getuid?.() ||
      (helperDirectory.mode & 0o777) !== 0o700 ||
      helper.isSymbolicLink() ||
      !helper.isFile() ||
      helper.uid !== process.getuid?.() ||
      helper.nlink !== 1 ||
      (helper.mode & 0o777) !== 0o700
    )
      throw new PolicyError("ISOLATION_UNAVAILABLE");
    const node = realpathSync(process.execPath),
      sharpRoot = realpathSync(join(REPO_ROOT, "node_modules/sharp"));
    const dependencies = [
      sharpRoot,
      ...[
        "@img/colour",
        "detect-libc",
        "semver",
        "@img/sharp-darwin-arm64",
        "@img/sharp-libvips-darwin-arm64",
      ].map((p) => realpathSync(join(dirname(sharpRoot), p))),
    ].sort();
    const executable =
      kind === "posix" ? POSIX_PROBE : kind === "mac" ? MAC_PROBE : node;
    const script = kind === "fault" ? FAULT_WORKER : WORKER;
    const literals = [
      "/",
      "/dev/null",
      "/dev/urandom",
      node,
      executable,
      script,
    ]
      .filter((p, i, a) => a.indexOf(p) === i)
      .sort();
    const ancestors = new Set<string>();
    for (const p of [
      node,
      script,
      executable,
      join(REPO_ROOT, "node_modules"),
    ]) {
      let d = dirname(p);
      for (;;) {
        ancestors.add(d);
        if (d === "/") break;
        d = dirname(d);
      }
    }
    const quote = (p: string) => JSON.stringify(p);
    const profile = `(version 1)\n(deny default)\n(allow process-exec (literal ${quote(executable)}))\n(allow file-read* ${literals.map((p) => `(literal ${quote(p)})`).join(" ")} (subpath "/usr/lib") (subpath "/System/Library") ${dependencies.map((p) => `(subpath ${quote(p)})`).join(" ")})\n(allow file-read-metadata ${[
      ...ancestors,
    ]
      .sort()
      .map((p) => `(literal ${quote(p)})`)
      .join(
        " ",
      )} (subpath ${quote(join(REPO_ROOT, "node_modules"))}))\n(allow sysctl-read (sysctl-name-regex #"^hw\\.") (sysctl-name "kern.ostype") (sysctl-name "kern.osrelease") (sysctl-name "kern.version") (sysctl-name "kern.hostname"))\n`;
    const identity = {
      schema: "mac-media-policy.v1",
      kind,
      platform: "darwin",
      architecture: process.arch,
      os: { product: "26.6.2", build: "25G83" },
      nodeVersion: process.version,
      nodeSha256: fileHash(node),
      sandboxSha256: fileHash(SANDBOX),
      workerSha256: fileHash(WORKER),
      controlHelperSha256: fileHash(MAC_PROBE),
      sharedSourceHashes: ["contracts.ts", "precheck.ts", "output.ts"].map(
        (name) => ({
          name,
          sha256: fileHash(
            fileURLToPath(new URL(`../shared/${name}`, import.meta.url)),
          ),
        }),
      ),
      manifestSourceSha256: fileHash(
        resolve(REPO_ROOT, "src/features/quizpack/v1/manifest.ts"),
      ),
      limitsSourceSha256: fileHash(
        resolve(REPO_ROOT, "src/features/quizpack/v1/limits.ts"),
      ),
      zodSha256: treeHash(realpathSync(join(REPO_ROOT, "node_modules/zod"))),
      policySourceSha256: POLICY_SOURCE_HASH,
      protocolSourceSha256: fileHash(
        fileURLToPath(new URL("./protocol.ts", import.meta.url)),
      ),
      launcherSourceSha256: fileHash(
        fileURLToPath(new URL("./launcher.ts", import.meta.url)),
      ),
      controlSourceSha256: fileHash(
        fileURLToPath(new URL("./control.ts", import.meta.url)),
      ),
      executableSha256: fileHash(executable),
      scriptSha256: fileHash(script),
      dependencies: dependencies.map((p) => ({ path: p, sha256: treeHash(p) })),
      sharpVersions: sharp.versions,
      limits: MEDIA_LIMITS,
      profileSha256: sha(profile),
    };
    return {
      node,
      profile,
      profileId: sha(JSON.stringify(identity)),
      identity,
    };
  } catch (error) {
    if (error instanceof PolicyError) throw error;
    throw new PolicyError("ISOLATION_UNAVAILABLE");
  }
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
  const { profileSha256: _rendered, dependencies, ...rest } = policy.identity;
  void _rendered;
  return sha(
    JSON.stringify({
      ...rest,
      dependencies: (dependencies as { sha256: string }[]).map((d) => d.sha256),
    }),
  );
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
