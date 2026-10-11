import { spawn } from "node:child_process";
import {
  mkdtemp,
  writeFile,
  readFile,
  mkdir,
  rm,
  symlink,
  readdir,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSyntheticFixture } from "./fixtures/synthetic";
let root: string;
let productId: string;
let input: string;
async function command(
  name: string,
  args: string[],
  tz = "UTC",
  stdin?: Uint8Array,
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  json: Record<string, unknown>;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["--silent", `quizpack:${name}`, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: tz },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", reject);
    const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(output).toString();
      try {
        resolve({
          code,
          stdout,
          stderr: Buffer.concat(errors).toString(),
          json: JSON.parse(stdout) as Record<string, unknown>,
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(stdin);
  });
}
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "quizpack-cli-")));
  const fixture = await createSyntheticFixture("dimensions");
  productId = fixture.content.product.productId;
  await mkdir(join(root, "images"));
  await writeFile(join(root, "content.json"), JSON.stringify(fixture.content));
  const assets = [];
  for (const [i, asset] of fixture.assets.entries()) {
    const source = `images/${i}.bin`;
    await writeFile(join(root, source), asset.bytes);
    assets.push({ path: asset.path, source });
  }
  input = join(root, "input.json");
  await writeFile(
    input,
    JSON.stringify({
      packId: "cli-synthetic",
      packVersion: "1.0.0",
      contentFile: "content.json",
      assets,
    }),
  );
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("real pnpm QuizPack entrypoints", () => {
  it("emits schema JSON only and rejects arguments", async () => {
    const result = await command("schema", []);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.json).toMatchObject({
      schemaVersion: "quizpack-schemas.v1",
      manifest: { type: "object" },
      content: { type: "object" },
    });
    const bad = await command("schema", ["--unknown"]);
    expect(bad.code).toBe(1);
    expect(bad.json).toMatchObject({
      ok: false,
      importable: false,
      publishable: false,
    });
  });
  it("builds deterministic archives across timezones, checks file/stdin and refuses overwrite", async () => {
    const utc = join(root, "utc.quizpack");
    const other = join(root, "other.quizpack");
    const buildArgs = (out: string) => [
      input,
      "--product",
      productId,
      "--out",
      out,
    ];
    const first = await command("build", buildArgs(utc), "UTC");
    const second = await command("build", buildArgs(other), "Pacific/Honolulu");
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.json).toMatchObject({
      ok: true,
      report: { candidateValid: true, importable: false, publishable: false },
    });
    const bytes = await readFile(utc);
    expect(bytes).toEqual(await readFile(other));
    expect(first.json).toEqual(second.json);
    const checked = await command("check", [utc, "--product", productId]);
    expect(checked.code).toBe(0);
    expect(checked.json).toEqual(first.json.report);
    const piped = await command(
      "check",
      ["-", "--product", productId],
      "UTC",
      bytes,
    );
    expect(piped.code).toBe(0);
    expect(piped.json).toEqual(checked.json);
    const duplicate = await command("build", buildArgs(utc));
    expect(duplicate.code).toBe(1);
    expect(duplicate.json).toMatchObject({
      ok: false,
      issues: [{ code: "IO_OUTPUT_EXISTS" }],
    });
    expect(await readFile(utc)).toEqual(bytes);
    expect(
      (await readdir(root)).some((name) => name.startsWith(".quizpack-")),
    ).toBe(false);
  }, 30000);
  it("redacts IO errors and refuses traversal, links and malformed input", async () => {
    const missing = join(root, "private-secret");
    const result = await command("check", [missing, "--product", productId]);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain(root);
    expect(result.stdout).not.toContain("private-secret");
    expect(result.stderr).toBe("");
    const spec = JSON.parse(await readFile(input, "utf8"));
    await symlink(join(root, "content.json"), join(root, "alias.json"));
    for (const source of ["../content.json", "alias.json"]) {
      const malicious = join(root, "bad-input.json");
      await writeFile(
        malicious,
        JSON.stringify({ ...spec, contentFile: source }),
      );
      const rejected = await command("build", [
        malicious,
        "--product",
        productId,
        "--out",
        join(root, "never.quizpack"),
      ]);
      expect(rejected.code).toBe(1);
      expect(rejected.stdout).not.toContain(root);
      expect(rejected.json).toMatchObject({
        candidateValid: false,
        importable: false,
        publishable: false,
      });
    }
    const wrong = await command("build", [
      input,
      "--product",
      "foreign-product",
      "--out",
      join(root, "never.quizpack"),
    ]);
    expect(wrong.code).toBe(1);
    expect(wrong.json).toMatchObject({ ok: false });
    const garbage = join(root, "garbage.quizpack");
    await writeFile(garbage, "malicious-secret-content");
    const checked = await command("check", [garbage, "--product", productId]);
    expect(checked.code).toBe(1);
    expect(checked.stdout).not.toContain("malicious-secret-content");
    const args = await command("check", [
      garbage,
      "--product",
      productId,
      "--extra",
    ]);
    expect(args.code).toBe(1);
    expect(args.json).toMatchObject({
      issues: [{ code: "CLI_INVALID_ARGUMENTS" }],
    });
  }, 30000);
});
