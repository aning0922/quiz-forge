import {
  mkdtemp,
  readFile,
  writeFile,
  realpath,
  rm,
  unlink,
  readdir,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ArchiveOutputError, writeArchiveNoClobber } from "./io";
import { PackToolError, withPackDeadline } from "./zip";
import { hashBytes } from "./validate";
import {
  createSyntheticFixture,
  type SyntheticFixture,
} from "./fixtures/synthetic";
import { buildQuizPackFile } from "../../../../scripts/quizpack-build-operation";
import { failCli } from "../../../../scripts/quizpack-cli";

// Trusted test-only syscall injection. No package field, CLI flag or environment
// variable can choose these hooks; all uninjected operations use the real disk.
const faults = vi.hoisted(() => ({
  beforeLink: undefined as (() => void | Promise<void>) | undefined,
  afterLink: undefined as (() => void | Promise<void>) | undefined,
  cleanup: undefined as (() => void | Promise<void>) | undefined,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      await faults.beforeLink?.();
      await actual.link(...args);
      await faults.afterLink?.();
    },
    unlink: async (...args: Parameters<typeof actual.unlink>) => {
      if (String(args[0]).includes(".quizpack-")) await faults.cleanup?.();
      await actual.unlink(...args);
    },
  };
});
const roots: string[] = [];
async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "quizpack-commit-")),
  );
  roots.push(root);
  return root;
}
const signal = () => new AbortController().signal;
afterEach(async () => {
  faults.beforeLink = undefined;
  faults.afterLink = undefined;
  faults.cleanup = undefined;
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe("archive output commit point", () => {
  it("returns an explicit hash-bound receipt after a normal commit", async () => {
    const root = await setup();
    const bytes = Buffer.from("synthetic archive");
    const receipt = await writeArchiveNoClobber(
      join(root, "out.quizpack"),
      bytes,
      signal(),
    );
    expect(receipt).toEqual({
      schemaVersion: "quizpack-output-commit.v1",
      committed: true,
      archiveSha256: hashBytes(bytes),
      bytes: bytes.length,
      postCommit: { status: "complete", warnings: [] },
    });
    expect(await readdir(root)).toEqual(["out.quizpack"]);
  });
  it("keeps committed output and reports cancellation during cleanup", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    const controller = new AbortController();
    faults.cleanup = () => {
      controller.abort();
    };
    const receipt = await writeArchiveNoClobber(
      target,
      Buffer.from("complete"),
      controller.signal,
    );
    expect(receipt).toMatchObject({
      committed: true,
      postCommit: {
        status: "warning",
        warnings: [{ code: "OUTPUT_COMMITTED_CANCELLED" }],
      },
    });
    expect(await readFile(target, "utf8")).toBe("complete");
    expect(await readdir(root)).toEqual(["out.quizpack"]);
  });
  it("records deadline expiry even when cleanup blocks the timer", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    faults.cleanup = () => {
      const until = performance.now() + 220;
      while (performance.now() < until) {}
    };
    let receipt: Awaited<ReturnType<typeof writeArchiveNoClobber>> | undefined;
    await expect(
      withPackDeadline(
        { targetProductId: "synthetic", limits: { operationMs: 200 } },
        async (inner) => {
          receipt = await writeArchiveNoClobber(
            target,
            Buffer.from("complete"),
            inner,
          );
        },
      ),
    ).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    expect(receipt).toMatchObject({
      committed: true,
      postCommit: {
        status: "warning",
        warnings: [{ code: "OUTPUT_COMMITTED_TIMEOUT" }],
      },
    });
    expect(await readFile(target, "utf8")).toBe("complete");
  });
  it("reports cleanup failure after commit without leaking its error text", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    faults.cleanup = () => {
      throw new Error("/private/secret-cleanup");
    };
    const receipt = await writeArchiveNoClobber(
      target,
      Buffer.from("complete"),
      signal(),
    );
    expect(receipt).toMatchObject({
      committed: true,
      postCommit: {
        status: "warning",
        warnings: [{ code: "OUTPUT_TEMP_CLEANUP_FAILED" }],
      },
    });
    expect(JSON.stringify(receipt)).not.toContain(root);
    expect(JSON.stringify(receipt)).not.toContain("secret-cleanup");
    expect(await readFile(target, "utf8")).toBe("complete");
    expect(
      (await readdir(root)).filter((name) => name.startsWith(".quizpack-")),
    ).toHaveLength(1);
  });
  it("never removes a target replaced after the commit point", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    const controller = new AbortController();
    faults.afterLink = async () => {
      await unlink(target);
      await writeFile(target, "replacement");
      controller.abort();
    };
    const receipt = await writeArchiveNoClobber(
      target,
      Buffer.from("original"),
      controller.signal,
    );
    expect(receipt.committed).toBe(true);
    expect(receipt.archiveSha256).toBe(hashBytes("original"));
    expect(await readFile(target, "utf8")).toBe("replacement");
  });
  it("precommit rejection cleans temporary files and preserves existing targets", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    faults.beforeLink = () => {
      throw new PackToolError("OPERATION_CANCELLED");
    };
    await expect(
      writeArchiveNoClobber(target, Buffer.from("x"), signal()),
    ).rejects.toMatchObject({ code: "OPERATION_CANCELLED", warnings: [] });
    expect(await readdir(root)).toEqual([]);
    faults.beforeLink = undefined;
    await writeFile(target, "existing");
    await expect(
      writeArchiveNoClobber(target, Buffer.from("x"), signal()),
    ).rejects.toMatchObject({ code: "IO_OUTPUT_EXISTS", warnings: [] });
    expect(await readFile(target, "utf8")).toBe("existing");
    expect(await readdir(root)).toEqual(["out.quizpack"]);
  });
  it("precommit failure retains a redacted cleanup warning", async () => {
    const root = await setup();
    const target = join(root, "out.quizpack");
    faults.beforeLink = () => {
      throw new Error("/private/write-error");
    };
    faults.cleanup = () => {
      throw new Error("/private/cleanup-error");
    };
    const error = await writeArchiveNoClobber(
      target,
      Buffer.from("x"),
      signal(),
    ).catch((error) => error as ArchiveOutputError);
    expect(error).toBeInstanceOf(ArchiveOutputError);
    expect(error).toMatchObject({
      code: "IO_OUTPUT_FAILED",
      warnings: [{ code: "OUTPUT_TEMP_CLEANUP_FAILED" }],
    });
    expect(JSON.stringify(error)).not.toContain("/private");
    expect(await readdir(root)).not.toContain("out.quizpack");
  });
  it("CLI failure JSON explicitly preserves precommit cleanup warnings", () => {
    const previous = process.exitCode;
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      failCli(
        new ArchiveOutputError("IO_OUTPUT_FAILED", [
          {
            code: "OUTPUT_TEMP_CLEANUP_FAILED",
            path: [],
            message: "Temporary cleanup requires attention.",
          },
        ]),
      );
      expect(stdout).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(stdout.mock.calls[0]![0]))).toMatchObject({
        ok: false,
        committed: false,
        issues: [
          { code: "IO_OUTPUT_FAILED" },
          { code: "OUTPUT_TEMP_CLEANUP_FAILED" },
        ],
      });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previous;
    }
  });
});
describe("CLI build orchestration with real IO and injected commit edges", () => {
  let fixture: SyntheticFixture;
  beforeAll(async () => {
    fixture = await createSyntheticFixture("dimensions");
  });
  async function input(root: string) {
    await mkdir(join(root, "assets"));
    await writeFile(
      join(root, "content.json"),
      JSON.stringify(fixture.content),
    );
    for (const asset of fixture.assets)
      await writeFile(join(root, asset.path), asset.bytes);
    const path = join(root, "input.json");
    await writeFile(
      path,
      JSON.stringify({
        packId: "commit-synthetic",
        packVersion: "1.0.0",
        contentFile: "content.json",
        assets: fixture.assets.map((asset) => ({
          path: asset.path,
          source: asset.path,
        })),
      }),
    );
    return path;
  }
  it.each(["cancel", "timeout", "cleanup"] as const)(
    "preserves validated evidence and committed outcome for late %s",
    async (kind) => {
      const root = await setup();
      const spec = await input(root);
      const target = join(root, "out.quizpack");
      const controller = new AbortController();
      const realNow = performance.now.bind(performance);
      let advance = 0;
      if (kind === "timeout")
        vi.spyOn(performance, "now").mockImplementation(
          () => realNow() + advance,
        );
      faults.cleanup = () => {
        if (kind === "cancel") controller.abort();
        else if (kind === "timeout") advance = 60001;
        else throw new Error("/private/cleanup");
      };
      const output = await buildQuizPackFile(spec, target, {
        targetProductId: fixture.content.product.productId,
        signal: controller.signal,
      });
      expect(output).toMatchObject({
        ok: true,
        committed: true,
        report: { candidateValid: true, importable: false, publishable: false },
        output: { committed: true, postCommit: { status: "warning" } },
      });
      if (!output.ok || !("output" in output))
        throw new Error("missing committed output");
      expect(output.output.archiveSha256).toBe(output.report.archiveSha256);
      expect(hashBytes(await readFile(target))).toBe(
        output.report.archiveSha256,
      );
      const expected =
        kind === "cancel"
          ? "OUTPUT_COMMITTED_CANCELLED"
          : kind === "timeout"
            ? "OUTPUT_COMMITTED_TIMEOUT"
            : "OUTPUT_TEMP_CLEANUP_FAILED";
      expect(
        output.output.postCommit.warnings.map((issue) => issue.code),
      ).toEqual([expected]);
      expect(JSON.stringify(output)).not.toContain(root);
    },
    15000,
  );
  it("precommit IO refusal cannot become committed success", async () => {
    const root = await setup();
    const spec = await input(root);
    const target = join(root, "out.quizpack");
    await writeFile(target, "existing");
    await expect(
      buildQuizPackFile(spec, target, {
        targetProductId: fixture.content.product.productId,
      }),
    ).rejects.toMatchObject({ code: "IO_OUTPUT_EXISTS" });
    expect(await readFile(target, "utf8")).toBe("existing");
  }, 15000);
});
