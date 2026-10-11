import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sourceRoot = process.argv[2];

if (!sourceRoot) {
  throw new Error(
    "Usage: node docs/oss-r/quizcraft-logic-audit.mjs /absolute/path/to/quizcraft/source",
  );
}

const logicPath = path.join(sourceRoot, "server", "logic.js");
const runnerPath = path.join(
  sourceRoot,
  "client",
  "src",
  "components",
  "Runner.jsx",
);
const { computeScore, pickResult, resolveNext } = await import(
  pathToFileURL(logicPath).href
);

const questions = [
  {
    id: 1,
    order: 0,
    type: "multiple",
    options_json: JSON.stringify([{ id: "known", points: 7 }]),
  },
  { id: 2, order: 1, type: "rating", options_json: JSON.stringify({ max: 5 }) },
];

assert.equal(
  computeScore(questions, {}),
  0,
  "missing answers are silently skipped",
);
assert.equal(
  computeScore(questions, { 1: "unknown-option" }),
  0,
  "unknown multiple-choice values score zero",
);
assert.equal(
  computeScore(questions, { 2: -1 }),
  -1,
  "negative rating is accepted without a lower bound",
);
assert.equal(
  computeScore(questions, { 2: 99.5 }),
  99.5,
  "over-max fractional rating is accepted without a max or integer check",
);
assert.equal(
  computeScore(questions, { 2: "not-a-number" }),
  0,
  "non-numeric rating is silently ignored rather than rejected",
);

const resultA = {
  id: "A",
  criteria_json: JSON.stringify({ type: "answer_map", option_ids: ["same"] }),
};
const resultB = {
  id: "B",
  criteria_json: JSON.stringify({ type: "answer_map", option_ids: ["same"] }),
};
assert.equal(
  pickResult([resultA, resultB], { 1: "same", 2: "same" }, 0).id,
  "A",
  "answer_map collapses duplicate answers into a Set and takes first result on a tie",
);
assert.equal(
  pickResult([resultB, resultA], { 1: "same", 2: "same" }, 0).id,
  "B",
  "tie outcome changes when result storage order changes",
);
assert.equal(
  pickResult([resultA], { 1: "same" }, 0).id,
  "A",
  "answer_map accepts a matching value without proving it belongs to question 1",
);

assert.equal(
  resolveNext(
    [
      { id: 1, order: 0 },
      { id: 2, order: 1 },
    ],
    [
      {
        question_id: 1,
        condition_json: JSON.stringify({ op: "equals", value: "loop" }),
        next_question_id: 1,
      },
    ],
    1,
    "loop",
  ),
  1,
  "self-loop resolves without a cycle guard",
);
assert.equal(
  resolveNext([{ id: 1, order: 0 }], [], 999, "x"),
  null,
  "unknown current id ends",
);

const runner = readFileSync(runnerPath, "utf8");
assert.match(
  runner,
  /next_question_id != null && questions\.some\(\(x\) => x\.id === next_question_id\)/,
  "Runner only checks that a server next id exists in its downloaded question list",
);
assert.match(
  runner,
  /await finish\(nextAnswers\)/,
  "Runner submits its local answer map when next id is unusable",
);

console.log(
  JSON.stringify({
    source: path.resolve(logicPath),
    missingAnswer: "accepted",
    invalidRatings: [-1, 99.5, "not-a-number"],
    tieDependsOnResultOrder: true,
    answerMapDoesNotBindValuesToQuestionOptions: true,
    selfLoopReturned: 1,
    runnerHasNoLocalCycleBound: true,
  }),
);
