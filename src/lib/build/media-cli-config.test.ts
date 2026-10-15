import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  access,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const checkout = process.cwd();
const entries = [
  ["media:build", "scripts/quizpack-media-build.ts"],
  [
    "media:provision",
    "scripts/quizpack-media-preflight/shared/provision-cli.ts",
  ],
  ["media:fixture", "scripts/quizpack-media-next-fixture.ts"],
  ["media:setup:macos", "scripts/quizpack-media-preflight/macos/setup.ts"],
  ["media:setup:linux", "scripts/quizpack-media-preflight/linux/setup.mjs"],
] as const;
async function owned(run: (directory: string) => Promise<void>) {
  const parent = path.join(checkout, ".cache/media-config-tests");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, "selector-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const exists = async (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

it("pins every supported media command before the tsx loader starts", async () => {
  await owned(async (directory) => {
    const observed = path.join(directory, "observed.json");
    const preload = path.join(directory, "preload.cjs");
    const allowed = entries.map(([, file]) => path.join(checkout, file));
    await writeFile(
      preload,
      `
const path=require('node:path'),fs=require('node:fs');
if (${JSON.stringify(allowed)}.includes(path.resolve(process.argv[1]||''))) {
  fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({cwd:process.cwd(),config:process.env.TSX_TSCONFIG_PATH}),{mode:0o600});
  process.exit(0);
}
`,
      { mode: 0o600 },
    );
    for (const [command] of entries) {
      await rm(observed, { force: true });
      const result = spawnSync(
        "corepack",
        ["pnpm", "--silent", command, "--invalid-config-probe"],
        {
          cwd: checkout,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.join(directory, "foreign.json"),
            NODE_OPTIONS: `--require=${preload}`,
          },
          encoding: "utf8",
          timeout: 15000,
          maxBuffer: 8192,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      const record = JSON.parse(await readFile(observed, "utf8")) as {
        cwd: string;
        config: string;
      };
      expect(path.resolve(record.cwd, record.config)).toBe(
        path.join(checkout, "tsconfig.json"),
      );
    }
  });
}, 30000);

it("ignores an inherited alias selector while a direct-node negative control reaches its marker", async () => {
  await owned(async (directory) => {
    const marker = path.join(directory, "marker");
    const redirect = path.join(directory, "redirect.ts");
    const config = path.join(directory, "foreign.json");
    await writeFile(
      redirect,
      `export * from ${JSON.stringify(pathToFileURL(path.join(checkout, "src/lib/assessment-contract/primitives.ts")).href)};\nimport {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'synthetic-marker',{mode:0o600});\n`,
      { mode: 0o600 },
    );
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          baseUrl: checkout,
          paths: {
            "@/lib/assessment-contract/primitives": [redirect],
            "@/*": [path.join(checkout, "src/*")],
          },
        },
      }),
      { mode: 0o600 },
    );
    const env = { ...process.env, TSX_TSCONFIG_PATH: config, NODE_OPTIONS: "" };
    // Invalid action only: module resolution is exercised, but no fixture,
    // native worker, database, or capability is created by either command.
    const direct = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "scripts/quizpack-media-next-fixture.ts",
        "invalid-config-probe",
      ],
      { cwd: checkout, env, encoding: "utf8", timeout: 15000, maxBuffer: 8192 },
    );
    expect(direct.error).toBeUndefined();
    expect(direct.status).toBe(1);
    expect(await exists(marker)).toBe(true);
    await rm(marker);
    const fixed = spawnSync(
      "corepack",
      ["pnpm", "--silent", "media:fixture", "invalid-config-probe"],
      { cwd: checkout, env, encoding: "utf8", timeout: 15000, maxBuffer: 8192 },
    );
    expect(fixed.error).toBeUndefined();
    expect(fixed.status).toBe(1);
    expect(await exists(marker)).toBe(false);
    expect(fixed.stdout).toBe(direct.stdout);
  });
}, 30000);
