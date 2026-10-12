import { realpathSync } from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { MEDIA_LIMITS } from "../../contracts";
import {
  readRuntimeMetadata,
  hashBytes,
  hashFile,
  mediaSourceIdentity,
  MediaPolicyError,
} from "../runtime-files";
import { createLinuxFiles } from "./files.mjs";
import { command, type CommandOptions, type CommandResult } from "./command";
import {
  createLinuxExecutionCore,
  type LinuxDiagnostic,
  type LinuxExecutionEnvironment,
  type LinuxPolicy,
} from "./execute.mjs";
import { LIMITS } from "./container-policy.mjs";
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const version = z.string().regex(/^[A-Za-z0-9._+-]{1,80}$/);
const runtimeSchema = z.strictObject({
  engine: version,
  containerd: version,
  runc: version,
  init: version,
});
const inputsSchema = z.strictObject({
  Dockerfile: hash,
  "package.json": hash,
  "package-lock.json": hash,
  "identity.mjs": hash,
  "fault-worker.mjs": hash,
  "media-worker.mjs": hash,
  "native-probe.c": hash,
  "native-probe": hash,
  "posix-probe.c": hash,
  "posix-probe": hash,
  compiler: hash,
});
const imageSchema = z.strictObject({
  schema: z.literal("qf-linux-image.v1"),
  runtimeVersions: runtimeSchema,
  base: z.string().max(256),
  baseIndex: imageId,
  platform: z.literal("linux/amd64"),
  imageId,
  inputs: inputsSchema,
  buildInputsHash: hash,
  workerSha256: hash,
  nativeProbePath: z.string().min(1).max(4096),
});
const dependenciesSchema = z.strictObject({
  node: z.literal("20.20.1"),
  sharp: z.literal("0.35.5"),
  vips: version,
  workerSha256: hash,
});
const daemonSchema = z.strictObject({
  id: z.string().min(1).max(256),
  version,
  os: z.literal("linux"),
  arch: z.enum(["x86_64", "amd64"]),
  security: z.array(z.string().max(512)).max(32),
  memory: z.literal(true),
  swap: z.literal(true),
  pids: z.literal(true),
  cpu: z.literal(true),
});
export type LinuxNormalPolicy = LinuxPolicy & { componentId: string };
export type LinuxPolicyLocation = {
  checkoutRoot: string;
  stateRoot: string;
  controlRoot: string;
  seccomp: string;
  base: string;
};
export function parseLinuxControlJson(bytes: Uint8Array): unknown {
  if (bytes.byteLength > 16 * 1024)
    throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
  ) as unknown;
}
const INFO =
  '{"id":{{json .ID}},"version":{{json .ServerVersion}},"os":{{json .OSType}},"arch":{{json .Architecture}},"security":{{json .SecurityOptions}},"memory":{{json .MemoryLimit}},"swap":{{json .SwapLimit}},"pids":{{json .PidsLimit}},"cpu":{{json .CPUCfsQuota}}}';
export function createLinuxNormalRuntime(
  location: LinuxPolicyLocation,
  checkpoint: () => void,
) {
  const files = createLinuxFiles(location);
  const docker = (
    args: readonly string[],
    options?: CommandOptions,
  ): Promise<CommandResult> =>
    command(
      "/usr/bin/docker",
      [
        "--config",
        join(location.stateRoot, "docker-config"),
        "--host",
        "unix:///var/run/docker.sock",
        ...args,
      ],
      options,
    );
  const loadPolicy: LinuxExecutionEnvironment["loadPolicy"] = async (
    options,
  ): Promise<LinuxNormalPolicy> => {
    try {
      checkpoint();
      if (process.platform !== "linux" || process.arch !== "x64")
        throw new MediaPolicyError("UNSUPPORTED_PLATFORM");
      if (
        [
          "DOCKER_HOST",
          "DOCKER_CONTEXT",
          "DOCKER_TLS_VERIFY",
          "DOCKER_CERT_PATH",
        ].some((key) => process.env[key])
      )
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      if (!options.controlCommand)
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const invoke = async (
        args: readonly string[],
        phase: LinuxDiagnostic["phase"],
      ) => {
        checkpoint();
        const result = await options.controlCommand!(args, {
          deadline: options.deadline - 100,
          settleDeadline: options.deadline,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.scope ? { scope: options.scope } : {}),
        });
        options.onDiagnostic?.({
          phase,
          exitCode: result.code,
          settled: result.settled,
          reason: result.reason ?? null,
        });
        if (!result.settled) throw new MediaPolicyError("STOP_UNCONFIRMED");
        checkpoint();
        if (result.code !== 0 || result.reason)
          throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
        return parseLinuxControlJson(result.stdout);
      };
      const imageBytes = await files.readPrivate(
        join(location.stateRoot, "image.json"),
      );
      checkpoint();
      const image = imageSchema.parse(parseLinuxControlJson(imageBytes));
      const base = parseLinuxControlJson(
        readRuntimeMetadata(location.base, checkpoint),
      ) as {
        base?: unknown;
        indexDigest?: unknown;
      };
      checkpoint();
      if (
        image.base !== base.base ||
        image.baseIndex !== base.indexDigest ||
        image.buildInputsHash !== hashBytes(JSON.stringify(image.inputs)) ||
        image.inputs["media-worker.mjs"] !== image.workerSha256 ||
        hashFile(
          join(
            location.checkoutRoot,
            "src/features/quizpack/v1/media-worker.mjs",
          ),
          checkpoint,
        ) !== image.workerSha256
      )
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const dependencyBytes = await files.readPrivate(
        join(location.stateRoot, "dependencies.json"),
      );
      checkpoint();
      const dependencies = dependenciesSchema.parse(
        parseLinuxControlJson(dependencyBytes),
      );
      if (dependencies.workerSha256 !== image.workerSha256)
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      if (
        (await invoke(
          ["image", "inspect", "--format", "{{json .Id}}", image.imageId],
          "policy-image-inspect",
        )) !== image.imageId
      )
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const daemon = daemonSchema.parse(
        await invoke(["info", "--format", INFO], "policy-daemon-info"),
      );
      if (!daemon.security.some((value) => value.startsWith("name=seccomp")))
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const components = z
        .array(z.looseObject({ Name: z.string().max(80), Version: version }))
        .max(32)
        .parse(
          await invoke(
            ["version", "--format", "{{json .Server.Components}}"],
            "policy-runtime-versions",
          ),
        );
      const names = {
        Engine: "engine",
        containerd: "containerd",
        runc: "runc",
        "docker-init": "init",
      } as const;
      const versions: Partial<
        Record<keyof z.infer<typeof runtimeSchema>, string>
      > = {};
      for (const component of components)
        if (Object.hasOwn(names, component.Name)) {
          const key = names[component.Name as keyof typeof names];
          if (versions[key])
            throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
          versions[key] = component.Version;
        }
      const runtimeVersions = runtimeSchema.parse(versions);
      if (
        JSON.stringify(runtimeVersions) !==
        JSON.stringify(image.runtimeVersions)
      )
        throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
      const seccomp = parseLinuxControlJson(
        readRuntimeMetadata(location.seccomp, checkpoint),
      );
      checkpoint();
      const seccompSha256 = hashBytes(JSON.stringify(seccomp));
      const binding = {
        schema: "qf-linux-policy.v2",
        kernel: release(),
        arch: process.arch,
        imageId: image.imageId,
        base: image.base,
        buildInputsHash: image.buildInputsHash,
        workerSha256: image.workerSha256,
        seccompSha256,
        daemon,
        runtimeVersions,
        dependencies,
        limits: LIMITS,
      };
      const component = {
        schema: "qf-linux-component.v2",
        binding,
        imageRecordSha256: hashBytes(imageBytes),
        dependencyRecordSha256: hashBytes(dependencyBytes),
        hostNodeSha256: hashFile(realpathSync(process.execPath), checkpoint),
        hostNodeVersion: process.version,
        dockerSha256: hashFile("/usr/bin/docker", checkpoint),
        productionSources: mediaSourceIdentity(
          location.checkoutRoot,
          checkpoint,
        ),
        mediaLimits: MEDIA_LIMITS,
      };
      checkpoint();
      return {
        image,
        binding,
        componentId: hashBytes(JSON.stringify(component)),
        profileId: hashBytes(JSON.stringify(binding)),
      };
    } catch (error) {
      if (error instanceof MediaPolicyError) throw error;
      checkpoint();
      throw new MediaPolicyError("ISOLATION_UNAVAILABLE");
    }
  };
  const core = createLinuxExecutionCore({
    ...files,
    controlRoot: location.controlRoot,
    seccompPath: location.seccomp,
    docker,
    json: parseLinuxControlJson,
    loadPolicy,
  });
  return { core };
}
