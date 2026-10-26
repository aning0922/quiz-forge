import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { collectQztxImplementationClosure } from "../../../../scripts/qztx-implementation-closure";
import { verifyTrustedImplementationEntries } from "../../../../scripts/verify-internal-implementations";
import { engineImplementationEntryV2Schema } from "./implementation-schema-v2";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";

const hash = (v: unknown) =>
  createHash("sha256").update(consumerCanonicalText(v, 262_144)).digest("hex");
const entries = [
  {
    path: "src/features/product/internal-versions/implementations/engine-v2.ts",
    exports: ["bindEngineV2"],
    runtime: "server" as const,
  },
];
describe("local v2 implementation closure registration inputs", () => {
  it("collects executable dependencies and independently verifies their real bytes", async () => {
    const closure = await collectQztxImplementationClosure(
      process.cwd(),
      entries,
    );
    expect(
      closure.files.some(
        (f) => f.path === "src/features/quiz/scoring/v2/score.ts",
      ),
    ).toBe(true);
    expect(
      closure.files.some((f) => /\.test(?:-support)?\./.test(f.path)),
    ).toBe(false);
    const descriptor = {
      schemaVersion: "quizforge.implementation-entry.v2",
      kind: "engine",
      id: "archetype-l1",
      version: "1.0.0",
      algorithm: { id: "archetype-l1", version: "1.0.0" },
      contentSchemaVersion: "quizpack-content.v3",
      closure,
      implementationSha256: hash(closure),
    };
    const entry = engineImplementationEntryV2Schema.parse({
      descriptor,
      entrySha256: hash(descriptor),
    });
    const proof = await verifyTrustedImplementationEntries(
      process.cwd(),
      [entry],
      () => true,
    );
    expect(proof.available).toBe(1);
    await expect(
      verifyTrustedImplementationEntries(
        process.cwd(),
        [entry],
        () => true,
        async (file) => {
          const actual = await readFile(file);
          return file === entries[0]!.path
            ? Buffer.concat([
                actual,
                Buffer.from("\n// changed after recording\n"),
              ])
            : actual;
        },
      ),
    ).rejects.toThrow("IMPLEMENTATION_FILE_CHANGED");
  });
  it("does not treat a type-only export as an executable entrypoint", async () => {
    await expect(
      collectQztxImplementationClosure(process.cwd(), [
        {
          path: "src/features/quiz/scoring/v2/index.ts",
          exports: ["PreparedScoringV2"],
          runtime: "server",
        },
      ]),
    ).rejects.toThrow("IMPLEMENTATION_EXPORT_MISSING");
  });
  it("rejects entrypoints outside the controlled source scope", async () => {
    await expect(
      collectQztxImplementationClosure(process.cwd(), [
        {
          path: "package.json",
          exports: ["arbitrary"],
          runtime: "server",
        },
      ]),
    ).rejects.toThrow("IMPLEMENTATION_SOURCE_SCOPE");
  });
});
