import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FOUNDATION_JSON_MAX_BYTES } from "./foundation-json";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = "src/features/quizpack/fixtures/historical.foundation.json";
const productId = "historical-synthetic";
const fixtureText = () => readFileSync(join(root, fixture), "utf8");
const run = (
  args: string[],
  input?: string | Buffer,
  script = "foundation-check",
) =>
  spawnSync(
    process.execPath,
    ["--import", "tsx", `scripts/${script}.ts`, ...args],
    {
      cwd: root,
      input,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * FOUNDATION_JSON_MAX_BYTES,
    },
  );

// CI installs pnpm directly; use the test runner's actual entrypoint without requiring corepack.
const pnpmEntrypoint = process.env.npm_execpath;
const pnpmExecutable =
  pnpmEntrypoint && /^pnpm(?:\.[cm]?js)?$/.test(basename(pnpmEntrypoint))
    ? pnpmEntrypoint
    : "pnpm";
const runPnpm = (
  script: "foundation:check" | "foundation:schema",
  args: string[] = [],
  input?: string,
) => {
  const commandArgs = ["--silent", script, ...args];
  const nodeEntrypoint = /\.[cm]?js$/.test(pnpmExecutable);
  return spawnSync(
    nodeEntrypoint ? process.execPath : pnpmExecutable,
    nodeEntrypoint ? [pnpmExecutable, ...commandArgs] : commandArgs,
    {
      cwd: root,
      input,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 2 * FOUNDATION_JSON_MAX_BYTES,
    },
  );
};

function strictPackageJson(result: ReturnType<typeof runPnpm>) {
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain(root);
  expect(result.stdout).not.toMatch(
    /ELIFECYCLE|quiz-forge@|\/Users\/|[A-Z]:[\\/]/,
  );
  // Parsing the complete stdout rejects any banner or extra lifecycle log line.
  return JSON.parse(result.stdout);
}

function rejected(result: ReturnType<typeof run>, code?: string) {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toBe("");
  const output = JSON.parse(result.stdout);
  expect(output.publishable).toBe(false);
  expect(output.structurallyValid && output.referenceValid).toBe(false);
  expect(output.issues.length).toBeGreaterThan(0);
  expect(output.unverified.length).toBeGreaterThan(0);
  if (code) expect(output.issues[0].code).toBe(code);
  expect(result.stdout).not.toContain(root);
  expect(result.stdout).not.toContain("SYNTHETIC_PRIVATE_SENTINEL");
  return output;
}

describe("real foundation CLI subprocesses", () => {
  it("returns pure JSON through the documented pnpm --silent check entrypoint", () => {
    const result = runPnpm("foundation:check", [
      fixture,
      "--product",
      productId,
    ]);
    expect(result.status).toBe(0);
    expect(strictPackageJson(result)).toMatchObject({
      structurallyValid: true,
      referenceValid: true,
      publishable: false,
      issues: [],
    });
  });

  it("retains pure JSON and a nonzero exit through pnpm --silent on bad input", () => {
    const result = runPnpm(
      "foundation:check",
      ["-", "--product", productId],
      '{"SYNTHETIC_PRIVATE_SENTINEL":',
    );
    expect(strictPackageJson(result).publishable).toBe(false);
    rejected(result, "JSON_SYNTAX");
  });

  it("returns pure JSON Schema through the documented pnpm --silent entrypoint", () => {
    const result = runPnpm("foundation:schema");
    expect(result.status).toBe(0);
    const schema = strictPackageJson(result);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.properties.schemaVersion.const).toBe("foundation.v1");
  });

  it("accepts file and stdin while retaining F1 limits on publishability", () => {
    for (const result of [
      run([fixture, "--product", productId]),
      run(["-", "--product", productId], fixtureText()),
    ]) {
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        structurallyValid: true,
        referenceValid: true,
        publishable: false,
        issues: [],
      });
      expect(JSON.parse(result.stdout).unverified.length).toBeGreaterThan(0);
    }
  });

  it("rejects a valid product B bundle when the trusted target is product A", () => {
    const output = rejected(
      run(["-", "--product", "synthetic-other-product"], fixtureText()),
    );
    expect(output.structurallyValid).toBe(true);
    expect(output.referenceValid).toBe(false);
  });

  it("delegates domain structure and references to the actual validator", () => {
    const wrongVersion = JSON.parse(fixtureText());
    wrongVersion.schemaVersion = "synthetic-unsupported";
    rejected(run(["-", "--product", productId], JSON.stringify(wrongVersion)));
    const wrongIdentity = JSON.parse(fixtureText());
    wrongIdentity.product.productId = "synthetic-other-product";
    rejected(run(["-", "--product", productId], JSON.stringify(wrongIdentity)));
    const unknownField = JSON.parse(fixtureText());
    unknownField.unsafe = "SYNTHETIC_PRIVATE_SENTINEL";
    rejected(run(["-", "--product", productId], JSON.stringify(unknownField)));
  });

  it.each(
    [
      [],
      ["-"],
      ["-", "--product"],
      ["-", "--unknown", productId],
      ["-", "--product", " "],
      ["-", "--product", productId, "extra"],
      ["--unexpected", "--product", productId],
    ].map((args) => [args] as const),
  )("rejects invalid arguments %j without waiting for stdin", (args) => {
    rejected(run(args), "CLI_INVALID_ARGUMENTS");
  });

  it.each([
    ['{"SYNTHETIC_PRIVATE_SENTINEL":', "JSON_SYNTAX"],
    ['{"id":1,"\\u0069d":2}', "JSON_DUPLICATE_KEY"],
    ['{"nested":{"__proto__":1}}', "JSON_FORBIDDEN_KEY"],
    ["[".repeat(33) + "0" + "]".repeat(33), "JSON_DEPTH_LIMIT"],
    ["1e999", "JSON_INVALID_VALUE"],
  ])("rejects bounded parser failure with code %s", (input, code) => {
    rejected(run(["-", "--product", productId], input), code);
  });

  it("rejects invalid UTF-8 bytes and UTF-8 BOM consistently", () => {
    rejected(
      run(["-", "--product", productId], Buffer.from([0xff])),
      "JSON_ENCODING",
    );
    rejected(
      run(["-", "--product", productId], Buffer.from("\uFEFF{}")),
      "JSON_SYNTAX",
    );
  });

  it("accepts exact parser size/depth limits before domain rejection", () => {
    for (const input of [
      JSON.stringify("a".repeat(FOUNDATION_JSON_MAX_BYTES - 2)),
      "[".repeat(32) + "0" + "]".repeat(32),
    ]) {
      rejected(run(["-", "--product", productId], input), "invalid_structure");
    }
  });

  it("rejects file IO without exposing an absolute local path", () => {
    const missing = join(
      tmpdir(),
      "foundation-SYNTHETIC_PRIVATE_SENTINEL-unavailable.json",
    );
    const result = run([missing, "--product", productId]);
    rejected(result, "CLI_INPUT_READ_FAILED");
    expect(result.stdout).not.toContain(missing);
  });

  it("rejects oversized files incrementally", () => {
    const directory = mkdtempSync(join(tmpdir(), "foundation-json-test-"));
    try {
      const path = join(directory, "oversized.json");
      writeFileSync(path, " ".repeat(FOUNDATION_JSON_MAX_BYTES + 1));
      rejected(run([path, "--product", productId]), "JSON_SIZE_LIMIT");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exits on excess stdin bytes even while the writer leaves stdin open", async () => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/foundation-check.ts",
        "-",
        "--product",
        productId,
      ],
      { cwd: root, stdio: "pipe" },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    // A rejected reader can close its pipe before the write callback; EPIPE is expected.
    child.stdin.on("error", () => {});
    const timeout = setTimeout(() => child.kill(), 4_000);
    try {
      const done = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      child.stdin.write(Buffer.alloc(FOUNDATION_JSON_MAX_BYTES + 1, 32));
      expect(await done).toBe(1);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).issues[0].code).toBe("JSON_SIZE_LIMIT");
      expect(JSON.parse(stdout).publishable).toBe(false);
    } finally {
      clearTimeout(timeout);
      child.stdin.destroy();
      child.kill();
    }
  });

  it("outputs the actual JSON Schema and rejects unsupported schema arguments", () => {
    const result = run([], undefined, "foundation-schema");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const schema = JSON.parse(result.stdout);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.schemaVersion.const).toBe("foundation.v1");
    rejected(
      run(["extra"], undefined, "foundation-schema"),
      "CLI_INVALID_ARGUMENTS",
    );
  });
});
