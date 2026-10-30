import type { Result, PackIssue } from "../v1/api";
import type { DeepReadonly } from "@/lib/assessment-contract/scoring-api-v1";
import {
  parseSupportedContent,
  getContentJsonSchema,
  type SupportedContent,
} from "./supported";
import { canonicalV2 } from "@/features/quiz/scoring/v2/boundary";
import { validateContentV3 } from "./v3-references";
import { quizPackContentV3Schema, type QuizPackContentV3 } from "./v3";
import { z } from "zod";
import type { PackLimits } from "../v1/limits";
import { packIssue } from "../v1/zip";

export type CurrentContent = SupportedContent | QuizPackContentV3;
export function parseCurrentContent(input: unknown): Result<CurrentContent> {
  let value: unknown;
  try {
    value = JSON.parse(canonicalV2(input));
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "CONTENT_INPUT_REJECTED",
          path: [],
          message: "Content must be bounded ordinary JSON.",
        },
      ],
    };
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).schemaVersion === "quizpack-content.v3"
  ) {
    const checked = validateContentV3(value);
    return checked.ok
      ? checked
      : {
          ok: false,
          issues: checked.issues.map((i) => ({
            code: i.code,
            path: [],
            message: "Value does not satisfy the declared v3 content contract.",
          })),
        };
  }
  return parseSupportedContent(value);
}
/** Metadata projection only. It never substitutes for or reserializes the original content. */
export function readContentMetadata(content: DeepReadonly<CurrentContent>) {
  if (content.schemaVersion !== "quizpack-content.v3")
    return {
      schemaVersion: content.schemaVersion,
      kind: content.kind,
      productId: content.product.productId,
      title: content.product.title,
      contentVersion: content.contentVersion,
      visualVersion: content.visualVersion,
      reportVersion: content.reportVersion,
      resourceVersion: content.resourceVersion,
      componentVersion: content.componentVersion,
      engine: content.engine,
      resources: content.resources,
      components: Object.values(content.layouts).map((l) => l.component),
      questions: content.questions,
      dimensionCount: content.dimensions.length,
      resultCount: content.results.length,
    };
  const { core, bindings: b } = content;
  return {
    schemaVersion: content.schemaVersion,
    kind: b.kind,
    productId: core.scoringDefinition.productId,
    title: core.title,
    contentVersion: core.scoringDefinition.contentVersion,
    visualVersion: b.visualVersion,
    reportVersion: b.reportVersion,
    resourceVersion: b.resourceVersion,
    componentVersion: b.componentVersion,
    engine: core.scoringDefinition.engine,
    resources: b.resources,
    components: Object.values(b.layouts).map((l) => l.component),
    questions: core.questions.map((q) => ({
      ...q.ref,
      prompt: q.prompt,
      options: q.options.map((o) => ({ ...o.ref, label: o.label })),
    })),
    dimensionCount: core.dimensions.length,
    resultCount: core.results.length,
  };
}
export function getCurrentContentJsonSchema(
  version: CurrentContent["schemaVersion"],
) {
  return version === "quizpack-content.v3"
    ? z.toJSONSchema(quizPackContentV3Schema, {
        target: "draft-2020-12",
        io: "input",
        unrepresentable: "throw",
      })
    : getContentJsonSchema(version);
}
export function loweredCurrentContentIssues(
  content: CurrentContent,
  limits: Readonly<PackLimits>,
): PackIssue[] {
  const c = readContentMetadata(content),
    issues: PackIssue[] = [];
  const check = (n: number, max: number, path: (string | number)[]) => {
    if (n > max) issues.push({ ...packIssue("CONTENT_LIMIT"), path });
  };
  check(c.questions.length, limits.questions, ["questions"]);
  check(c.dimensionCount, limits.dimensions, ["dimensions"]);
  check(c.resultCount, limits.results, ["results"]);
  check(c.resources.length, limits.resources, ["resources"]);
  c.questions.forEach((q, i) =>
    check(q.options.length, limits.optionsPerQuestion, [
      "questions",
      i,
      "options",
    ]),
  );
  c.resources.forEach((r, i) => {
    check(r.bytes, limits.resourceBytes, ["resources", i, "bytes"]);
    check(r.width, limits.imageDimension, ["resources", i, "width"]);
    check(r.height, limits.imageDimension, ["resources", i, "height"]);
    check(r.width * r.height, limits.imagePixels, ["resources", i]);
  });
  return issues;
}
