import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { MEDIA_LIMITS } from "../../contracts";
import {
  hashBytes,
  hashFile,
  hashTree,
  mediaSourceIdentity,
  MediaPolicyError,
} from "../runtime-files";
export type MacPolicy = {
  profile: string;
  profileId: string;
  componentId: string;
  node: string;
  identity: Record<string, unknown>;
};
/** A trusted offline adapter can construct its closed probe/fault plan. Normal code uses only the fixed P1 worker. */
export type MacPermissionPlan = {
  kind: string;
  executable: string;
  script: string;
  offlineIdentity?: readonly { role: string; sha256: string }[];
};
export type MacPolicyLocation = {
  checkoutRoot: string;
  identityHelper: string;
};
export function supportedOSInfo(text: string): boolean {
  return (
    /^ProductVersion:\s*26\.6\.2$/m.test(text) &&
    /^BuildVersion:\s*25G83$/m.test(text)
  );
}
export function renderMacPermissionProfile(
  root: string,
  node: string,
  dependencies: readonly string[],
  plan: MacPermissionPlan,
): string {
  const literals = [
    "/",
    "/dev/null",
    "/dev/urandom",
    node,
    plan.executable,
    plan.script,
  ]
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const ancestors = new Set<string>();
  for (const path of [
    node,
    plan.script,
    plan.executable,
    join(root, "node_modules"),
  ]) {
    for (let parent = dirname(path); ; parent = dirname(parent)) {
      ancestors.add(parent);
      if (parent === "/") break;
    }
  }
  const quote = (path: string) => JSON.stringify(path);
  return `(version 1)\n(deny default)\n(allow process-exec (literal ${quote(plan.executable)}))\n(allow file-read* ${literals.map((path) => `(literal ${quote(path)})`).join(" ")} (subpath "/usr/lib") (subpath "/System/Library") ${dependencies.map((path) => `(subpath ${quote(path)})`).join(" ")})\n(allow file-read-metadata ${[
    ...ancestors,
  ]
    .sort()
    .map((path) => `(literal ${quote(path)})`)
    .join(
      " ",
    )} (subpath ${quote(join(root, "node_modules"))}))\n(allow sysctl-read (sysctl-name-regex #"^hw\\.") (sysctl-name "kern.ostype") (sysctl-name "kern.osrelease") (sysctl-name "kern.version") (sysctl-name "kern.hostname"))\n`;
}
export function macPolicyComponentId(
  policy: Pick<MacPolicy, "identity">,
): string {
  const {
    schema: _schema,
    componentId: _id,
    profileSha256: _rendered,
    dependencies,
    ...rest
  } = policy.identity;
  void _schema;
  void _id;
  void _rendered;
  return hashBytes(
    JSON.stringify({
      schema: "mac-media-component.v2",
      ...rest,
      dependencies: (dependencies as { sha256: string }[]).map(
        (dependency) => ({ sha256: dependency.sha256 }),
      ),
    }),
  );
}
export function loadMacPolicy(
  location: MacPolicyLocation,
  checkpoint: () => void,
  offlinePlan?: MacPermissionPlan,
): MacPolicy {
  try {
    checkpoint();
    if (
      process.platform !== "darwin" ||
      process.arch !== "arm64" ||
      process.version !== "v20.20.1"
    )
      throw new MediaPolicyError("UNSUPPORTED_PLATFORM");
    const version = spawnSync("/usr/bin/sw_vers", [], {
      env: { NODE_ENV: "production" },
      cwd: location.checkoutRoot,
      timeout: 1000,
      maxBuffer: 1024,
    });
    checkpoint();
    const os = version.stdout?.toString();
    if (
      version.status !== 0 ||
      !os ||
      !supportedOSInfo(os) ||
      sharp.versions.sharp !== "0.35.5" ||
      sharp.versions.vips !== "8.18.7"
    )
      throw new MediaPolicyError("UNSUPPORTED_PLATFORM");
    const directory = lstatSync(dirname(location.identityHelper)),
      helper = lstatSync(location.identityHelper);
    if (
      directory.isSymbolicLink() ||
      !directory.isDirectory() ||
      directory.uid !== process.getuid?.() ||
      (directory.mode & 0o777) !== 0o700 ||
      helper.isSymbolicLink() ||
      !helper.isFile() ||
      helper.uid !== process.getuid?.() ||
      helper.nlink !== 1 ||
      (helper.mode & 0o777) !== 0o700
    )
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    const node = realpathSync(process.execPath),
      root = location.checkoutRoot;
    const sharpRoot = realpathSync(join(root, "node_modules/sharp"));
    const dependencies = [
      sharpRoot,
      ...[
        "@img/colour",
        "detect-libc",
        "semver",
        "@img/sharp-darwin-arm64",
        "@img/sharp-libvips-darwin-arm64",
      ].map((name) => realpathSync(join(dirname(sharpRoot), name))),
    ].sort();
    const worker = join(root, "src/features/quizpack/v1/media-worker.mjs");
    const plan = offlinePlan ?? {
      kind: "worker",
      executable: node,
      script: worker,
    };
    const profile = renderMacPermissionProfile(root, node, dependencies, plan);
    const component = {
      schema: "mac-media-component.v2",
      kind: plan.kind,
      platform: "darwin",
      architecture: process.arch,
      os: { product: "26.6.2", build: "25G83" },
      nodeVersion: process.version,
      nodeSha256: hashFile(node, checkpoint),
      sandboxSha256: hashFile("/usr/bin/sandbox-exec", checkpoint),
      workerSha256: hashFile(worker, checkpoint),
      controlHelperSha256: hashFile(location.identityHelper, checkpoint),
      productionSources: mediaSourceIdentity(root, checkpoint),
      manifestSourceSha256: hashFile(
        join(root, "src/features/quizpack/v1/manifest.ts"),
        checkpoint,
      ),
      limitsSourceSha256: hashFile(
        join(root, "src/features/quizpack/v1/limits.ts"),
        checkpoint,
      ),
      zodSha256: hashTree(
        realpathSync(join(root, "node_modules/zod")),
        checkpoint,
      ),
      executableSha256: hashFile(plan.executable, checkpoint),
      scriptSha256: hashFile(plan.script, checkpoint),
      dependencies: dependencies.map((path) => ({
        sha256: hashTree(path, checkpoint),
      })),
      sharpVersions: sharp.versions,
      limits: MEDIA_LIMITS,
      ...(plan.offlineIdentity
        ? { offlineIdentity: plan.offlineIdentity }
        : {}),
    };
    const componentId = macPolicyComponentId({ identity: component });
    const identity = {
      ...component,
      schema: "mac-media-policy.v2",
      componentId,
      dependencies: dependencies.map((path, index) => ({
        path,
        ...component.dependencies[index],
      })),
      profileSha256: hashBytes(profile),
    };
    checkpoint();
    return {
      node,
      profile,
      profileId: hashBytes(JSON.stringify(identity)),
      componentId,
      identity,
    };
  } catch (error) {
    if (error instanceof MediaPolicyError) throw error;
    // Preserve the caller's stop authority instead of replacing interruption with platform denial.
    checkpoint();
    throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
  }
}
