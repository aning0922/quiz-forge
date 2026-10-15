import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import { createContentV2Fixture } from "../content/fixtures.test-support";
const execute = promisify(execFile);
let root: string, productId: string;
async function command(script: string, args: string[]) {
  const options = {
    cwd: process.cwd(),
    env: { ...process.env, TSX_TSCONFIG_PATH: resolve("tsconfig.json") },
    encoding: "utf8" as const,
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30000,
  };
  try {
    const out = await execute(
      process.execPath,
      ["--import", "tsx", `scripts/quizpack-${script}.ts`, ...args],
      options,
    );
    return { code: 0, stdout: out.stdout, json: JSON.parse(out.stdout) };
  } catch (e) {
    const err = e as { code?: unknown; stdout?: unknown };
    if (typeof err.code !== "number" || typeof err.stdout !== "string")
      throw Error("CLI_PROCESS_FAILED");
    return { code: err.code, stdout: err.stdout, json: JSON.parse(err.stdout) };
  }
}
beforeAll(async () => {
  root = await realpath(
    await mkdtemp(join(tmpdir(), "quizpack-supported-cli-")),
  );
  await mkdir(join(root, "images"));
  const fixture = await createSyntheticFixture("archetype");
  productId = fixture.content.product.productId;
  const v2 = await createContentV2Fixture("archetype");
  const assets = [
    ...fixture.assets,
    { path: "assets/neutral-scene.png", bytes: fixture.assets[0]!.bytes },
  ];
  for (const [i, a] of assets.entries())
    await writeFile(join(root, "images", `${i}.bin`), a.bytes);
  for (const version of ["v1", "v2"] as const)
    for (const kind of ["synthetic", "authored"] as const) {
      const content = { ...(version === "v1" ? fixture.content : v2), kind };
      const id = version + "-" + kind;
      await writeFile(join(root, id + ".json"), JSON.stringify(content));
      await writeFile(
        join(root, id + "-input.json"),
        JSON.stringify({
          packId: "synthetic-cli-pack",
          packVersion: "1.0.0",
          contentFile: id + ".json",
          assets: assets
            .slice(0, version === "v1" ? fixture.assets.length : assets.length)
            .map((a, i) => ({ path: a.path, source: `images/${i}.bin` })),
        }),
      );
    }
});
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
describe("explicit supported CLI selection", () => {
  it.each(["v1", "v2"] as const)(
    "%s builds and checks both kinds with synthetic test pixels",
    async (version) => {
      for (const kind of ["synthetic", "authored"]) {
        const id = version + "-" + kind,
          input = join(root, id + "-input.json"),
          out = join(root, id + ".quizpack");
        const built = await command("build", [
          input,
          "--product",
          productId,
          "--out",
          out,
          "--content-version",
          version,
        ]);
        expect(built.code).toBe(0);
        expect(built.json.committed).toBe(true);
        expect(built.json.report.schemaVersion).toBe("quizpack-validation.v2");
        expect(built.json.report.publishable).toBe(false);
        const checked = await command("check", [
          out,
          "--product",
          productId,
          "--content-version",
          version,
        ]);
        expect(checked.code).toBe(0);
        expect(checked.json.candidateValid).toBe(true);
        expect(checked.json.unverified).toHaveLength(5);
        const mismatch = await command("check", [
          out,
          "--product",
          productId,
          "--content-version",
          version === "v1" ? "v2" : "v1",
        ]);
        expect(mismatch.code).toBe(1);
        expect(mismatch.json.candidateValid).toBe(false);
      }
    },
  );
  it("preserves legacy default bytes and refuses implicit v2 or output overwrite", async () => {
    const input = join(root, "v1-synthetic-input.json"),
      out = join(root, "legacy.quizpack"),
      explicit = join(root, "explicit.quizpack");
    const old = await command("build", [
      input,
      "--product",
      productId,
      "--out",
      out,
    ]);
    const newer = await command("build", [
      input,
      "--product",
      productId,
      "--out",
      explicit,
      "--content-version",
      "v1",
    ]);
    expect(old.code).toBe(0);
    expect(old.json.report.schemaVersion).toBe("quizpack-validation.v1");
    expect(newer.code).toBe(0);
    expect(await readFile(explicit)).toEqual(await readFile(out));
    const before = await readFile(out);
    const duplicate = await command("build", [
      input,
      "--product",
      productId,
      "--out",
      out,
      "--content-version",
      "v1",
    ]);
    expect(duplicate.code).toBe(1);
    expect(duplicate.json.committed).toBe(false);
    expect(await readFile(out)).toEqual(before);
    const implicit = join(root, "implicit.quizpack");
    expect(
      (
        await command("build", [
          join(root, "v2-synthetic-input.json"),
          "--product",
          productId,
          "--out",
          implicit,
        ])
      ).code,
    ).toBe(1);
    await expect(access(implicit)).rejects.toThrow();
  });
  it("rejects invalid/duplicate/missing version selectors before file IO", async () => {
    for (const suffix of [
      ["--content-version"],
      ["--content-version", "v3"],
      ["--content-version", "v2", "--content-version", "v1"],
      ["--other", "v1"],
    ]) {
      const result = await command("check", [
        "missing.quizpack",
        "--product",
        productId,
        ...suffix,
      ]);
      expect(result.code).toBe(1);
      expect(result.json.issues[0].code).toBe("CLI_INVALID_ARGUMENTS");
    }
    const out = join(root, "mismatch-build.quizpack");
    const wrong = await command("build", [
      join(root, "v2-synthetic-input.json"),
      "--product",
      productId,
      "--out",
      out,
      "--content-version",
      "v1",
    ]);
    expect(wrong.code).toBe(1);
    expect(wrong.json.committed).toBe(false);
    await expect(access(out)).rejects.toThrow();
  });
  it("exports version-specific manifest schemas separately and preserves default stdout", async () => {
    const old = await command("schema", []);
    expect(createHash("sha256").update(old.stdout).digest("hex")).toBe(
      "1142db3b63f7ec5ea5ed90b8b630f324ae948c626e82e93f7c7c6f909d61f38d",
    );
    for (const version of ["v1", "v2"]) {
      const schema = await command("schema", [
        "--manifest-content-version",
        version,
      ]);
      expect(schema.code).toBe(0);
      expect(schema.json.schemaVersion).toBe(
        "quizpack-supported-manifest-schema.v1",
      );
      expect(schema.json.contentSchemaVersion).toBe(
        "quizpack-content." + version,
      );
      expect(schema.json.manifest.properties.contentSchemaVersion.const).toBe(
        "quizpack-content." + version,
      );
      expect(schema.json).not.toHaveProperty("content");
    }
    const content = await command("schema", ["--content-version", "v2"]);
    expect(content.code).toBe(0);
    expect(content.json.schemaVersion).toBe("quizpack-content-schema.v2");
    expect(content.json).not.toHaveProperty("manifest");
    expect(
      (
        await command("schema", [
          "--manifest-content-version",
          "v2",
          "--content-version",
          "v2",
        ])
      ).code,
    ).toBe(1);
  });
});
