import type { ContentReference } from "../v1/content";
import type { PackIssue } from "../v1/api";
import { P1_STATE_COMPONENT_CONTRACTS } from "../v1/compatibility";
import { validateContentGraph } from "./reference-graph";
import {
  boundedContentIssues,
  freezeContent,
  parseSupportedContent,
  type SupportedContent,
} from "./supported";
import { V2_STATE_COMPONENT_CONTRACTS } from "./v2";

const key = (ref: ContentReference) =>
  JSON.stringify([ref.productId, ref.id, ref.version]);
/** For an already snapshotted, strictly parsed content value; no manifest claims. */
export function validateParsedContentReferences(
  content: SupportedContent,
  targetProductId: string,
): PackIssue[] {
  const issues = validateContentGraph(
    content,
    targetProductId,
    content.schemaVersion === "quizpack-content.v1"
      ? P1_STATE_COMPONENT_CONTRACTS
      : V2_STATE_COMPONENT_CONTRACTS,
  );
  if (content.schemaVersion === "quizpack-content.v1")
    return boundedContentIssues(issues);
  const add = (code: string, path: (string | number)[]) =>
    issues.push({
      code,
      path,
      message:
        "Content must use the exact declared presentation reference graph.",
    });
  const resources = new Map(
    content.resources.map((resource) => [key(resource), resource]),
  );
  const checkScene = (
    ref: ContentReference,
    purpose: "cover" | "decoration",
    path: (string | number)[],
  ) => {
    const resource = resources.get(key(ref));
    if (!resource) add("PRESENTATION_REFERENCE_MISMATCH", path);
    else if (resource.purpose !== purpose)
      add("RESOURCE_PURPOSE_MISMATCH", path);
  };
  const { coverSceneRef, sections, questionFrames, resourceDescriptions } =
    content.visualPresentation;
  checkScene(coverSceneRef, "cover", ["visualPresentation", "coverSceneRef"]);
  const sectionIndices = new Map<string, number>();
  sections.forEach((section, i) => {
    if (sectionIndices.has(section.id))
      add("DUPLICATE_SECTION_ID", ["visualPresentation", "sections", i, "id"]);
    else sectionIndices.set(section.id, i);
    checkScene(section.sceneRef, "decoration", [
      "visualPresentation",
      "sections",
      i,
      "sceneRef",
    ]);
  });
  const usedSections = new Set<number>();
  let previous = -1;
  if (questionFrames.length !== content.questions.length)
    add("QUESTION_FRAME_COVERAGE", ["visualPresentation", "questionFrames"]);
  questionFrames.forEach((frame, i) => {
    const path = ["visualPresentation", "questionFrames", i];
    const question = content.questions[i];
    if (!question || key(frame.questionRef) !== key(question))
      add("QUESTION_FRAME_ORDER_OR_REFERENCE", [...path, "questionRef"]);
    const sectionIndex = sectionIndices.get(frame.sectionId);
    if (sectionIndex === undefined)
      add("UNKNOWN_SECTION_REFERENCE", [...path, "sectionId"]);
    else {
      if (sectionIndex !== previous && sectionIndex !== previous + 1)
        add("NONCONTIGUOUS_SECTION_ORDER", [...path, "sectionId"]);
      usedSections.add(sectionIndex);
      previous = sectionIndex;
    }
    if (frame.sceneOverrideRef)
      checkScene(frame.sceneOverrideRef, "decoration", [
        ...path,
        "sceneOverrideRef",
      ]);
  });
  if (usedSections.size !== sections.length)
    add("UNUSED_SECTION", ["visualPresentation", "sections"]);
  const exactSet = (
    refs: readonly ContentReference[],
    expected: readonly ContentReference[],
    path: (string | number)[],
  ) => {
    const required = new Set(expected.map(key)),
      seen = new Set<string>();
    refs.forEach((ref, i) => {
      const identity = key(ref);
      if (seen.has(identity))
        add("DUPLICATE_PRESENTATION_REFERENCE", [...path, i]);
      seen.add(identity);
      if (!required.has(identity))
        add("PRESENTATION_REFERENCE_MISMATCH", [...path, i]);
    });
    if (
      seen.size !== required.size ||
      [...required].some((identity) => !seen.has(identity))
    )
      add("PRESENTATION_REFERENCE_COVERAGE", path);
  };
  exactSet(
    resourceDescriptions.map((item) => item.resourceRef),
    content.resources,
    ["visualPresentation", "resourceDescriptions"],
  );
  exactSet(
    content.reportPresentation.resultCards.map((card) => card.resultRef),
    content.results,
    ["reportPresentation", "resultCards"],
  );
  const scenes = [
    ...sections.map((section) => section.sceneRef),
    ...questionFrames.flatMap((frame) =>
      frame.sceneOverrideRef ? [frame.sceneOverrideRef] : [],
    ),
  ];
  const portraits = content.results.map((result) => result.portraitRef);
  const graphs = {
    cover: [coverSceneRef],
    question: scenes,
    resume: [coverSceneRef, ...scenes],
    result: portraits,
    report: portraits,
    poster: portraits,
  };
  for (const state of Object.keys(graphs) as (keyof typeof graphs)[])
    exactSet(content.layouts[state].resourceRefs, graphs[state], [
      "layouts",
      state,
      "resourceRefs",
    ]);
  return boundedContentIssues(issues);
}
/** Internal identities, rules and declarations only; no manifest/file/media qualification. */
export function validateSupportedContentReferences(
  content: unknown,
  targetProductId: string,
): PackIssue[] {
  const parsed = parseSupportedContent(content);
  return freezeContent(
    parsed.ok
      ? validateParsedContentReferences(parsed.value, targetProductId)
      : parsed.issues,
  );
}
