import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runQuizPackV3Cli } from "../../../../scripts/quizpack-v3";
import { syntheticEditorialV05 } from "./v3-fixtures.test-support";

const owned: string[] = [];
afterEach(async () => {
  await Promise.all(
    owned.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function inputFiles() {
  const dir = await mkdtemp(join(tmpdir(), "qf-v3-cli-"));
  owned.push(dir);
  const source = syntheticEditorialV05();
  await Promise.all([
    writeFile(join(dir, "questions.json"), source.questionsJson),
    writeFile(join(dir, "personas.json"), source.personasJson),
    writeFile(join(dir, "families.json"), source.familiesJson),
  ]);
  const converted = await runQuizPackV3Cli([
    "convert",
    "--questions",
    join(dir, "questions.json"),
    "--personas",
    join(dir, "personas.json"),
    "--families",
    join(dir, "families.json"),
    "--product-id",
    source.productId,
    "--version",
    source.version,
    "--title",
    source.title,
    "--out",
    join(dir, "build.json"),
  ]);
  return { dir, source, converted };
}
describe("bounded v3 CLI", () => {
  it("converts, validates, scores and checks twelve synthetic paths with explicit incomplete admission", async () => {
    const { dir, source, converted } = await inputFiles();
    expect(converted).toMatchObject({
      ok: true,
      coreValid: true,
      contentValid: false,
      importable: false,
      questions: 24,
    });
    expect(
      await runQuizPackV3Cli(["validate", "--input", join(dir, "build.json")]),
    ).toMatchObject({
      ok: true,
      coreValid: true,
      contentValid: false,
      importable: false,
    });
    const answers = source.questions.questions.map((q) => ({
      questionId: q.id.toLowerCase(),
      optionId: `${q.id.toLowerCase()}-d`,
    }));
    await writeFile(join(dir, "answers.json"), JSON.stringify(answers));
    const scored = await runQuizPackV3Cli([
      "score",
      "--input",
      join(dir, "build.json"),
      "--answers",
      join(dir, "answers.json"),
      "--preference",
      "female",
    ]);
    expect(scored).toMatchObject({
      ok: true,
      importable: false,
      score: {
        dimensions: Array(5).fill({ score: 100 }),
        decision: { candidateCount: 3, selectedResultRef: { id: "role-1" } },
      },
    });
    const top5 = source.personas.characters.map((p, i) => ({
      role_id: p.id,
      distance_sum: i * 100,
      narrative_index: [100, 70, 40, 10, 0][i],
    }));
    const cases = Array.from({ length: 12 }, (_, i) => ({
      id: `S${String(i + 1).padStart(2, "0")}`,
      answers: Object.fromEntries(
        source.questions.questions.map((q) => [q.id, "D"]),
      ),
      scores: Object.fromEntries(
        source.questions.assumed_scoring.axes.map((a) => [a, 100]),
      ),
      matching_5: { top5, near_tie: false },
    }));
    await writeFile(join(dir, "paths.json"), JSON.stringify({ cases }));
    const flags = [
      "verify-paths",
      "--input",
      join(dir, "build.json"),
      "--paths",
      join(dir, "paths.json"),
      "--out",
      join(dir, "verification.json"),
    ];
    expect(await runQuizPackV3Cli(flags)).toMatchObject({
      ok: true,
      cases: 12,
      executions: 36,
      passed: 36,
      importable: false,
    });
    const saved = JSON.parse(
      await readFile(join(dir, "verification.json"), "utf8"),
    );
    expect(saved.executions).toHaveLength(36);
    await expect(runQuizPackV3Cli(flags)).rejects.toThrow();
    cases[0]!.scores[source.questions.assumed_scoring.axes[0]!] = 99;
    await writeFile(join(dir, "paths.json"), JSON.stringify({ cases }));
    expect(
      await runQuizPackV3Cli([...flags.slice(0, -1), join(dir, "failed.json")]),
    ).toMatchObject({ ok: false, passed: 33 });
  });
  it("rejects duplicate/unknown flags, malformed input and foreign answer IDs", async () => {
    await expect(
      runQuizPackV3Cli(["validate", "--input", "a", "--input", "b"]),
    ).rejects.toThrow("CLI_ARGUMENTS");
    await expect(
      runQuizPackV3Cli(["validate", "--unsafe", "a"]),
    ).rejects.toThrow("CLI_ARGUMENTS");
    const { dir } = await inputFiles();
    await writeFile(
      join(dir, "oversize.json"),
      Buffer.alloc(2 * 1024 * 1024 + 1, 32),
    );
    await expect(
      runQuizPackV3Cli(["validate", "--input", join(dir, "oversize.json")]),
    ).rejects.toThrow("CLI_INPUT_LIMIT");
    await writeFile(join(dir, "bad.json"), "{}");
    await expect(
      runQuizPackV3Cli(["validate", "--input", join(dir, "bad.json")]),
    ).rejects.toThrow("CLI_INVALID_BUILD_INPUT");
    await expect(
      runQuizPackV3Cli([
        "score",
        "--input",
        join(dir, "build.json"),
        "--answers",
        join(dir, "bad.json"),
        "--preference",
        "any",
      ]),
    ).rejects.toThrow("INVALID_INPUT");
  });
});
