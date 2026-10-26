import { beforeAll, describe, expect, it } from "vitest";
import type { PackageValidationReport } from "./api";
import type { P1CoreExecution } from "../v1/validate-core";
import { validateQuizPackCore, hashBytes } from "../v1/validate-core";
import { validateSupportedQuizPackCore } from "./validate-core";
import { createSyntheticFixture } from "../v1/fixtures/synthetic";
import { PACK_LIMITS, type PackLimits } from "../v1/limits";
import { PackToolError, packIssue } from "../v1/zip";
import type { Result, ImageFacts, ImageDeclaration } from "../v1/api";
import type { RestrictedZip } from "../v1/zip";

type Hooks = Omit<P1CoreExecution, "parsed" | "propagate"> & {
  parsed?: (...args: unknown[]) => void;
  propagate: (
    error: unknown,
    report: PackageValidationReport,
    active: keyof PackageValidationReport["checks"],
  ) => boolean;
};
const bytes = Buffer.from("synthetic execution-hook source");
const source = async function* () {
  yield bytes;
};
const zipFailure = (): Result<RestrictedZip> => ({
  ok: false,
  issues: [packIssue("ZIP_INVALID_STRUCTURE")],
});
let fixture: Awaited<ReturnType<typeof createSyntheticFixture>>;
let files: ReadonlyMap<string, Buffer>;
beforeAll(async () => {
  fixture = await createSyntheticFixture();
  files = new Map([
    ["manifest.json", Buffer.from(JSON.stringify(fixture.manifest))],
    ["content.json", Buffer.from(fixture.contentBytes)],
    ...fixture.assets.map(
      (asset) => [asset.path, Buffer.from(asset.bytes)] as [string, Buffer],
    ),
  ]);
});

describe.each(["legacy", "supported"] as const)(
  "%s core preserves original hook object semantics",
  (mode) => {
    const validate = (hooks: Hooks) => {
      const context = { targetProductId: "synthetic-archetype" };
      return mode === "legacy"
        ? validateQuizPackCore(source(), context, hooks)
        : validateSupportedQuizPackCore(source(), context, hooks, {
            kind: "backend-matrix",
          });
    };
    it("calls class prototype hooks and returns a bounded ZIP failure report", async () => {
      class PrototypeHooks implements Hooks {
        events: string[] = [];
        execute<T>(
          work: (
            signal: AbortSignal,
            limits: Readonly<PackLimits>,
          ) => Promise<T>,
        ) {
          this.events.push("execute");
          return work(new AbortController().signal, PACK_LIMITS);
        }
        checkpoint() {
          this.events.push("checkpoint");
        }
        async readZip() {
          this.events.push("readZip");
          return zipFailure();
        }
        async inspect(): Promise<Result<ImageFacts>> {
          throw new Error("unreached inspect");
        }
        beforeStructure() {
          throw new Error("unreached structure");
        }
        parsed() {
          throw new Error("unreached parsed");
        }
        propagate() {
          this.events.push("propagate");
          return false;
        }
      }
      const hooks = new PrototypeHooks();
      expect(Object.hasOwn(hooks, "execute")).toBe(false);
      expect(Object.hasOwn(hooks, "propagate")).toBe(false);
      const report = await validate(hooks);
      expect(report).toMatchObject({
        candidateValid: false,
        issues: [packIssue("ZIP_INVALID_STRUCTURE")],
        issuesTruncated: false,
        checks: { container: "failed", structure: "not-run", media: "not-run" },
      });
      expect(hooks.events).toEqual([
        "execute",
        "checkpoint",
        "checkpoint",
        "readZip",
      ]);
    });
    it("keeps the original receiver for every hook on success and propagated failure", async () => {
      for (const failZip of [false, true]) {
        const events: string[] = [];
        const hooks: Hooks = {
          execute(work) {
            expect(this === hooks).toBe(true);
            events.push("execute");
            return work(new AbortController().signal, PACK_LIMITS);
          },
          checkpoint() {
            expect(this === hooks).toBe(true);
            events.push("checkpoint");
          },
          async readZip() {
            expect(this === hooks).toBe(true);
            events.push("readZip");
            if (failZip) throw new PackToolError("ZIP_INVALID_STRUCTURE");
            return {
              ok: true,
              value: { files, archiveSha256: hashBytes(bytes) },
            };
          },
          async inspect(_bytes: Uint8Array, declaration: ImageDeclaration) {
            expect(this === hooks).toBe(true);
            events.push("inspect");
            return {
              ok: true,
              value: {
                mediaType: declaration.mediaType,
                width: declaration.width,
                height: declaration.height,
                frames: 1,
                mediaDecoded: true,
              },
            };
          },
          beforeStructure(manifest, content) {
            expect(this === hooks).toBe(true);
            events.push("beforeStructure");
            expect(manifest).toEqual(fixture.manifest);
            expect(content).toEqual(fixture.content);
          },
          parsed(...args) {
            expect(this === hooks).toBe(true);
            events.push("parsed");
            expect(args).toEqual(
              mode === "legacy"
                ? [fixture.manifest, fixture.content, files]
                : [
                    {
                      contentSchemaVersion: "quizpack-content.v1",
                      manifest: fixture.manifest,
                      content: fixture.content,
                    },
                    files,
                  ],
            );
          },
          propagate(error, report, active) {
            expect(this === hooks).toBe(true);
            events.push("propagate");
            expect(error).toBeInstanceOf(PackToolError);
            expect(report.schemaVersion).toBe(
              mode === "legacy"
                ? "quizpack-validation.v1"
                : "quizpack-validation.v3",
            );
            expect(active).toBe("container");
            return false;
          },
        };
        const report = await validate(hooks);
        expect(report.candidateValid).toBe(!failZip);
        expect(events.filter((event) => event !== "checkpoint")).toEqual(
          failZip
            ? ["execute", "readZip", "propagate"]
            : [
                "execute",
                "readZip",
                "beforeStructure",
                ...fixture.assets.map(() => "inspect"),
                "parsed",
              ],
        );
        expect(report.issues).toEqual(
          failZip ? [packIssue("ZIP_INVALID_STRUCTURE")] : [],
        );
      }
    });
    it("does not access optional hook getters before their original stage", async () => {
      const reads: string[] = [];
      const hooks: Hooks = {
        execute: (work) => work(new AbortController().signal, PACK_LIMITS),
        checkpoint: () => {},
        readZip: async () => zipFailure(),
        get inspect(): NonNullable<Hooks["inspect"]> {
          reads.push("inspect");
          throw new Error("unreached inspect getter");
        },
        get beforeStructure(): NonNullable<Hooks["beforeStructure"]> {
          reads.push("beforeStructure");
          throw new Error("unreached structure getter");
        },
        get parsed(): NonNullable<Hooks["parsed"]> {
          reads.push("parsed");
          throw new Error("unreached parsed getter");
        },
        get propagate(): NonNullable<Hooks["propagate"]> {
          reads.push("propagate");
          throw new Error("unreached propagate getter");
        },
      };
      const report = await validate(hooks);
      expect(report.issues).toEqual([packIssue("ZIP_INVALID_STRUCTURE")]);
      expect(report.checks.container).toBe("failed");
      expect(reads).toEqual([]);
    });
  },
);
