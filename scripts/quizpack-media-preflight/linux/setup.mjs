import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { executeSynthetic } from "./controller.mjs";
import { arch, platform } from "node:os";
import {
  CACHE,
  DIR,
  hash,
  privateDir,
  writePrivate,
  command,
  docker,
  json,
  safeMain,
} from "./common.mjs";

let stage = "platform";
safeMain(
  async () => {
    if (platform() !== "linux" || arch() !== "x64")
      throw new Error("UNSUPPORTED_PLATFORM");
    if (
      [
        "DOCKER_HOST",
        "DOCKER_CONTEXT",
        "DOCKER_TLS_VERIFY",
        "DOCKER_CERT_PATH",
      ].some((k) => process.env[k])
    )
      throw new Error("ENDPOINT_OVERRIDE");
    stage = "paths";
    await privateDir(CACHE);
    await privateDir(resolve(CACHE, "docker-config"));
    stage = "base-metadata";
    const base = json(await readFile(resolve(DIR, "base.json")));
    const runId = randomUUID();
    const context = resolve(CACHE, runId, "build");
    await privateDir(context);
    stage = "inputs";
    const files = [
      "Dockerfile",
      "worker/package.json",
      "worker/package-lock.json",
      "worker/identity.mjs",
      "worker/fault-worker.mjs",
    ];
    const inputs = {};
    for (const file of files) {
      const bytes = await readFile(resolve(DIR, file));
      const name = file.split("/").at(-1);
      inputs[name] = hash(bytes);
      await writePrivate(resolve(context, name), bytes);
    }
    const worker = await readFile(
      resolve("src/features/quizpack/v1/media-worker.mjs"),
    );
    inputs["media-worker.mjs"] = hash(worker);
    await writePrivate(resolve(context, "media-worker.mjs"), worker);
    const probeSource = await readFile(resolve(DIR, "native-probe.c"));
    inputs["native-probe.c"] = hash(probeSource);
    // Linux-only static synthetic binary; no compiler or host tree enters worker.
    stage = "native-compile";
    const compiled = await command(
      "/usr/bin/cc",
      [
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-static",
        "-pthread",
        resolve(DIR, "native-probe.c"),
        "-o",
        resolve(context, "native-probe"),
      ],
      { deadline: performance.now() + 30000 },
    );
    if (compiled.code !== 0 || compiled.reason || !compiled.settled)
      throw new Error("PROBE_BUILD");
    inputs["native-probe"] = hash(
      await readFile(resolve(context, "native-probe")),
    );
    // Compiler output is a build input, tied to source and the actual image ID.
    const compiler = await command("/usr/bin/cc", ["--version"]);
    if (compiler.code !== 0) throw new Error("COMPILER_IDENTITY");
    inputs.compiler = hash(compiler.stdout);
    stage = "base-pull";
    const pull = await docker(
      ["pull", "--platform", base.platform, base.base],
      {
        deadline: performance.now() + 180000,
        stdoutLimit: 65536,
      },
    );
    if (pull.code !== 0 || pull.reason || !pull.settled)
      throw new Error("BASE_PULL");
    const tag = `quizpack-media-preflight:${runId}`;
    stage = "image-build";
    const built = await docker(
      [
        "build",
        "--platform",
        base.platform,
        "--pull=false",
        "--network=default",
        "--no-cache",
        "--tag",
        tag,
        context,
      ],
      {
        deadline: performance.now() + 180000,
        stdoutLimit: 65536,
        stderrLimit: 65536,
      },
    );
    if (built.code !== 0 || built.reason || !built.settled)
      throw new Error("IMAGE_BUILD");
    stage = "image-inspect";
    const image = await docker([
      "image",
      "inspect",
      "--format",
      "{{json .Id}}",
      tag,
    ]);
    if (image.code !== 0 || image.reason) throw new Error("IMAGE_IDENTITY");
    const imageId = json(image.stdout);
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId))
      throw new Error("IMAGE_IDENTITY");
    const identity = {
      schema: "qf-linux-image.v1",
      base: base.base,
      baseIndex: base.indexDigest,
      platform: base.platform,
      imageId,
      inputs,
      buildInputsHash: hash(JSON.stringify(inputs)),
      workerSha256: inputs["media-worker.mjs"],
      nativeProbePath: resolve(context, "native-probe"),
    };
    stage = "image-record";
    await writePrivate(resolve(CACHE, "image.json"), JSON.stringify(identity));
    stage = "native-identity";
    const checked = await executeSynthetic({
      scenario: "identity",
      hooks: {
        diagnostic(event) {
          process.stdout.write(
            JSON.stringify({ diagnostic: "native-identity", ...event }) + "\n",
          );
        },
      },
    });
    process.stdout.write(
      JSON.stringify({
        diagnostic: "native-identity-result",
        outcome: checked.outcome,
        code: checked.code ?? null,
        stopped: checked.stopped,
        exitCode: checked.evidence?.exitCode ?? null,
      }) + "\n",
    );
    if (checked.outcome !== "probe" || checked.stopped !== "confirmed")
      throw new Error("NATIVE_IDENTITY_UNCONFIRMED");
    const dependencies = json(checked.stdout);
    if (
      dependencies.node !== "20.20.1" ||
      dependencies.sharp !== "0.35.5" ||
      typeof dependencies.vips !== "string" ||
      dependencies.workerSha256 !== identity.workerSha256
    )
      throw new Error("NATIVE_IDENTITY_INVALID");
    stage = "dependencies-record";
    await writePrivate(
      resolve(CACHE, "dependencies.json"),
      JSON.stringify(dependencies),
    );
    process.stdout.write(
      JSON.stringify({
        outcome: "prepared",
        base: base.base,
        imageId,
        buildInputsHash: identity.buildInputsHash,
        workerSha256: identity.workerSha256,
      }) + "\n",
    );
  },
  () => stage,
);
