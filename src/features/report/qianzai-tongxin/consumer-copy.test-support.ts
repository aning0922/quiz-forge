import { qianzaiPresentationFixture } from "./result-presentation.test-support";
/** Isolated invented answers/support, never persisted or read from an author. */
export const qianzaiCopyRef = (id: string) => ({
  productId: "qianzai-tongxin",
  id,
  version: "1.0.0",
});
const ref = qianzaiCopyRef;
export async function qianzaiConsumerCopyFixture(role = "li-qingzhao") {
  const f = await qianzaiPresentationFixture();
  f.body.matching.selected.ref = f.view.display.selectedResultRef = ref(role);
  f.body.matching.selected.label = "RAW_SELECTED_LABEL";
  if (role === "mulan-ballad")
    f.body.matching.selected.kind = "literary-legendary";
  f.body.answers = [];
  f.body.volumes.forEach((v, i) => {
    v.paragraphs = [
      {
        claimRef: null,
        kind: "fallback",
        status: "fallback",
        text: `RAW_INTERNAL_PARAGRAPH_${i}`,
        evidence: [],
        counterevidence: [],
      },
    ];
  });
  const evidence = (option: string) => {
    const question = option.split("-")[0]!;
    let answer = f.body.answers.find((a) => a.questionRef.id === question);
    if (!answer) {
      answer = {
        questionRef: ref(question),
        optionRef: ref(option),
        prompt: `RAW_QUESTION_${question}`,
        optionText: `RAW_ANSWER_${option}`,
        act: 1,
      };
      f.body.answers.push(answer);
    }
    return {
      questionRef: ref(question),
      optionRef: ref(option),
      prompt: answer.prompt,
      optionText: answer.optionText,
      scope: "RAW_EVIDENCE_SCOPE",
    };
  };
  const paragraph = (
    id: string,
    kind: "summary" | "context",
    positive: readonly string[],
    negative: readonly string[] = [],
  ) => ({
    claimRef: ref(id),
    kind,
    status: "accepted" as const,
    text: `RAW_INTERNAL_${id}`,
    evidence: positive.map(evidence),
    counterevidence: negative.map(evidence),
  });
  f.body.volumes[2]!.paragraphs = [
    paragraph("authored-be6dfe2f8a8e169562e5", "summary", [
      "q02-b",
      "q04-a",
      "q18-b",
    ]),
    paragraph("authored-32874c524c0bcefdb155", "summary", ["q03-c", "q06-c"]),
    paragraph("authored-002ddc7622c049644c55", "summary", ["q07-b", "q10-a"]),
  ];
  f.body.volumes[3]!.paragraphs = [
    paragraph(
      "authored-2327e4fe1d6e8509b490",
      "context",
      ["q09-c", "q18-b"],
      ["q15-a"],
    ),
  ];
  return f;
}
