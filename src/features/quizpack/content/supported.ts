import {
  getQuizPackContentJsonSchema,
  quizPackContentSchema,
  type QuizPackContent,
} from "../v1/content";
import { canonicalP1Json } from "../v1/canonical";
import type { PackIssue, Result } from "../v1/api";
import {
  quizPackContentV2Schema,
  getQuizPackContentV2JsonSchema,
  type QuizPackContentV2,
} from "./v2";

export type SupportedContent = QuizPackContent | QuizPackContentV2;
export type SupportedContentVersion = SupportedContent["schemaVersion"];
export function freezeContent<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeContent(child);
    Object.freeze(value);
  }
  return value;
}
export function boundedContentIssues(issues: PackIssue[]): PackIssue[] {
  return issues.length <= 32
    ? issues
    : [
        ...issues.slice(0, 31),
        {
          code: "ISSUES_TRUNCATED",
          path: [],
          message: "Additional content issues were omitted.",
        },
      ];
}
/** Offline content structure only. This does not inspect ZIPs, files, media or renderers. */
function parseSnapshot(input: unknown): Result<SupportedContent> {
  let value: unknown;
  try {
    // This is the one ordinary-JSON snapshot, before accessing any caller property.
    value = JSON.parse(canonicalP1Json(input, "content"));
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
  const version =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).schemaVersion
      : undefined;
  const schema =
    version === "quizpack-content.v1"
      ? quizPackContentSchema
      : version === "quizpack-content.v2"
        ? quizPackContentV2Schema
        : undefined;
  if (!schema)
    return {
      ok: false,
      issues: [
        {
          code: "UNSUPPORTED_CONTENT_SCHEMA",
          path: ["schemaVersion"],
          message: "Only explicitly supported content versions are accepted.",
        },
      ],
    };
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, value: freezeContent(parsed.data) };
  return {
    ok: false,
    issues: boundedContentIssues(
      parsed.error.issues.map((issue) => ({
        code: "CONTENT_STRUCTURE",
        path: issue.path.filter(
          (part): part is string | number =>
            typeof part === "string" || typeof part === "number",
        ),
        message: "Value does not satisfy its declared content contract.",
      })),
    ),
  };
}
export function parseSupportedContent(
  input: unknown,
): Result<SupportedContent> {
  return freezeContent(parseSnapshot(input));
}
export function getContentJsonSchema(version: SupportedContentVersion) {
  if (version === "quizpack-content.v1") return getQuizPackContentJsonSchema();
  if (version === "quizpack-content.v2")
    return getQuizPackContentV2JsonSchema();
  throw new Error("UNSUPPORTED_CONTENT_SCHEMA");
}
