import type { QuizPackContentV3 } from "./v3";
import { refKey } from "@/features/quiz/scoring/v2/boundary";
type Evidence =
  QuizPackContentV3["bindings"]["reportTemplates"][number]["claims"][number]["evidence"][number];
export function quoteContentEvidenceV3(
  content: QuizPackContentV3,
  e: Evidence,
) {
  const question = content.core.questions.find(
    (q) => refKey(q.ref) === refKey(e.questionRef),
  )!;
  const option = question.options.find(
    (o) => refKey(o.ref) === refKey(e.optionRef),
  )!;
  return {
    questionRef: question.ref,
    optionRef: option.ref,
    prompt: question.prompt,
    optionText: option.label,
    scope: e.scope,
  };
}
export function contentRoleFactV3(
  content: QuizPackContentV3,
  resultRef: QuizPackContentV3["core"]["results"][number]["ref"],
  narrativeIndex: number,
) {
  const result = content.core.results.find(
    (r) => refKey(r.ref) === refKey(resultRef),
  )!;
  const profile = content.core.scoringDefinition.profiles.find(
    (p) => refKey(p.resultRef) === refKey(resultRef),
  )!;
  return {
    ref: result.ref,
    label: result.label,
    kind: profile.kind,
    narrativeIndex,
  };
}
