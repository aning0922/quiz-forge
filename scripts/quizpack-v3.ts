import { open, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { convertEditorialV05 } from "../src/features/quizpack/content/v3-editorial-import";
import { contentBuildInputV3Schema } from "../src/features/quizpack/content/v3";
import {
  inspectBuildInputV3,
  validateCoreV3,
} from "../src/features/quizpack/content/v3-references";
import {
  prepareScoringV2,
  scoreCompleteAnswersV2,
} from "../src/features/quiz/scoring/v2";
import {
  canonicalV2,
  digestV2,
  parseBounded,
} from "../src/features/quiz/scoring/v2/boundary";

async function readText(file: string) {
  const handle = await open(file, "r");
  try {
    const maximum = 2 * 1024 * 1024;
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw Error("CLI_INPUT_LIMIT");
    const bytes = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length < bytes.length) {
      const next = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!next.bytesRead) break;
      length += next.bytesRead;
    }
    if (length > maximum) throw Error("CLI_INPUT_LIMIT");
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(0, length),
    );
  } finally {
    await handle.close();
  }
}
async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readText(file));
}
const sha = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
async function writeJson(file: string, value: unknown) {
  const bytes = canonicalV2(value);
  await mkdir(dirname(resolve(file)), { recursive: true });
  await writeFile(file, `${bytes}\n`, { flag: "wx", mode: 0o600 });
}
function args(values: string[], allowed: string[], required: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i]!,
      value = values[i + 1];
    if (
      !key.startsWith("--") ||
      !allowed.includes(key.slice(2)) ||
      result[key.slice(2)] !== undefined ||
      !value ||
      value.startsWith("--")
    )
      throw Error("CLI_ARGUMENTS");
    result[key.slice(2)] = value;
  }
  if (required.some((k) => !result[k])) throw Error("CLI_ARGUMENTS");
  return result;
}
async function build(file: string) {
  const raw = await readText(file);
  const parsed = parseBounded(
    contentBuildInputV3Schema,
    JSON.parse(raw),
    "INVALID_CONTENT",
  );
  if (!parsed.ok) throw Error("CLI_INVALID_BUILD_INPUT");
  const core = validateCoreV3(parsed.value.core);
  if (!core.ok) throw Error("CLI_INVALID_CORE");
  return { ...parsed.value, rawSha256: sha(raw) };
}
function good<T>(
  result:
    { ok: true; value: T } | { ok: false; issues: readonly { code: string }[] },
): T {
  if (!result.ok)
    throw Error(result.issues[0]?.code ?? "CLI_VALIDATION_FAILED");
  return result.value;
}
const auditSchema = z.object({
  cases: z
    .array(
      z.object({
        id: z.string().regex(/^S\d{2}$/),
        answers: z.record(z.string(), z.enum(["A", "B", "C", "D"])),
        scores: z.record(z.string(), z.number().int().min(0).max(100)),
        matching_5: z.object({
          top5: z
            .array(
              z.object({
                role_id: z.string(),
                distance_sum: z.number().int(),
                narrative_index: z.number().int(),
              }),
            )
            .length(5),
          near_tie: z.boolean(),
        }),
      }),
    )
    .length(12),
});

export async function runQuizPackV3Cli(argv: string[]) {
  const [command, ...rest] = argv;
  if (command === "convert") {
    const a = args(
      rest,
      [
        "questions",
        "personas",
        "families",
        "product-id",
        "version",
        "title",
        "bindings",
        "out",
      ],
      [
        "questions",
        "personas",
        "families",
        "product-id",
        "version",
        "title",
        "out",
      ],
    );
    const [questionsJson, personasJson, familiesJson] = await Promise.all([
      readText(a.questions!),
      readText(a.personas!),
      readText(a.families!),
    ]);
    const core = good(
      convertEditorialV05({
        questionsJson,
        personasJson,
        familiesJson,
        productId: a["product-id"],
        version: a.version,
        title: a.title,
      }),
    );
    const bindings = a.bindings ? await readJson(a.bindings) : null;
    const candidate = {
      schemaVersion: "quizpack-build-input.v3",
      core,
      bindings,
    };
    const inspected = inspectBuildInputV3(core, bindings);
    if (bindings !== null && !inspected.contentValid)
      throw Error("CLI_INVALID_BINDINGS");
    await writeJson(a.out!, candidate);
    return {
      ok: true,
      command,
      ...inspected,
      sourceHashes: core.provenance,
      coreSha256: digestV2("quiz-core.v3", core),
      questions: core.questions.length,
      dimensions: core.dimensions.length,
      results: core.results.length,
    };
  }
  if (command === "validate") {
    const a = args(rest, ["input", "out"], ["input"]);
    const b = await build(a.input!);
    const inspected = inspectBuildInputV3(b.core, b.bindings);
    const result = {
      ok:
        inspected.coreValid && (b.bindings === null || inspected.contentValid),
      command,
      ...inspected,
      inputSha256: b.rawSha256,
      coreSha256: digestV2("quiz-core.v3", b.core),
    };
    if (a.out) await writeJson(a.out, result);
    return result;
  }
  if (command === "score") {
    const a = args(
      rest,
      ["input", "answers", "preference", "out"],
      ["input", "answers", "preference"],
    );
    const b = await build(a.input!);
    const handle = good(prepareScoringV2(b.core.scoringDefinition));
    const score = good(
      scoreCompleteAnswersV2(handle, {
        schemaVersion: "quiz-scoring-input.v2",
        answers: await readJson(a.answers!),
        matchingContext: {
          schemaVersion: "quiz-matching-context.v1",
          preference: a.preference,
          policyRef: b.core.scoringDefinition.matchingPolicy.ref,
        },
      }),
    );
    const result = {
      ok: true,
      command,
      ...inspectBuildInputV3(b.core, b.bindings),
      inputSha256: b.rawSha256,
      score,
    };
    if (a.out) await writeJson(a.out, result);
    return a.out
      ? {
          ok: true,
          command,
          importable: false,
          scoreWritten: true,
          inputHash: score.inputHash,
        }
      : result;
  }
  if (command === "verify-paths") {
    const a = args(rest, ["input", "paths", "out"], ["input", "paths", "out"]);
    const b = await build(a.input!),
      paths = await readText(a.paths!);
    const audit = good(
      parseBounded(auditSchema, JSON.parse(paths), "SOURCE_MISMATCH"),
    );
    if (new Set(audit.cases.map((c) => c.id)).size !== 12)
      throw Error("CLI_INVALID_PATHS");
    const definition = b.core.scoringDefinition,
      handle = good(prepareScoringV2(definition));
    const executions = audit.cases.flatMap((c) =>
      (["any", "male", "female"] as const).map((preference) => {
        const score = good(
          scoreCompleteAnswersV2(handle, {
            schemaVersion: "quiz-scoring-input.v2",
            answers: Object.entries(c.answers).map(([qid, key]) => ({
              questionId: qid.toLowerCase(),
              optionId: `${qid.toLowerCase()}-${key.toLowerCase()}`,
            })),
            matchingContext: {
              schemaVersion: "quiz-matching-context.v1",
              preference,
              policyRef: definition.matchingPolicy.ref,
            },
          }),
        );
        const expected = c.matching_5.top5.filter((r) =>
          definition.profiles.some(
            (p) =>
              p.stableRankKey === r.role_id &&
              (preference === "any" || p.sex === preference),
          ),
        );
        const expectedScores = b.core.dimensions.map((d) => c.scores[d.label]);
        const scores = score.dimensions.map((d) => d.score);
        const ranks = score.decision.rankings.map((r) => ({
          id: r.resultRef.id,
          total: r.totalAbsoluteDistance,
          index: r.narrativeIndex,
        }));
        const expectedRanks = expected.map((r) => ({
          id: r.role_id.replaceAll("_", "-"),
          total: r.distance_sum,
          index: r.narrative_index,
        }));
        const expectedGap = expected[1]
          ? expected[1].distance_sum - expected[0]!.distance_sum
          : null;
        const expectedStatus =
          expectedGap === null
            ? "single-candidate"
            : expectedGap <= 4 * scores.length
              ? "near-tie"
              : "distinct";
        const passed =
          JSON.stringify(scores) === JSON.stringify(expectedScores) &&
          JSON.stringify(ranks) === JSON.stringify(expectedRanks) &&
          score.decision.gapTotal === expectedGap &&
          score.decision.status === expectedStatus &&
          (preference !== "any" ||
            (score.decision.status === "near-tie") === c.matching_5.near_tie);
        return {
          caseId: c.id,
          preference,
          passed,
          scores,
          ranks,
          status: score.decision.status,
          gapTotal: score.decision.gapTotal,
          inputHash: score.inputHash,
        };
      }),
    );
    const result = {
      ok: executions.every((e) => e.passed),
      command,
      ...inspectBuildInputV3(b.core, b.bindings),
      inputSha256: b.rawSha256,
      pathsSha256: sha(paths),
      coreSha256: digestV2("quiz-core.v3", b.core),
      executions,
    };
    await writeJson(a.out!, result);
    return {
      ok: result.ok,
      command,
      cases: 12,
      executions: executions.length,
      passed: executions.filter((e) => e.passed).length,
      importable: false,
      inputSha256: result.inputSha256,
      pathsSha256: result.pathsSha256,
    };
  }
  throw Error("CLI_ARGUMENTS");
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  runQuizPackV3Cli(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const code =
        error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "CLI_OPERATION_FAILED";
      process.stdout.write(
        `${JSON.stringify({ ok: false, importable: false, code })}\n`,
      );
      process.exitCode = 1;
    });
