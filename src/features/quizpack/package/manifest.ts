import { z } from "zod";
import type { Result } from "../v1/api";
import { canonicalP1Json } from "../v1/canonical";
import {
  quizPackManifestSchema,
  getQuizPackManifestJsonSchema,
} from "../v1/manifest";
import { freezeContent } from "../content/supported";
import { parseCurrentContent } from "../content/current";
import { engineDeclarationV2Schema } from "@/lib/assessment-contract/scoring-v2";
import type {
  ContentSchemaVersion,
  SupportedManifest,
  SupportedParsedPack,
  SupportedCoreSelection,
} from "./api";

const legacySupportedManifestSchema = quizPackManifestSchema.extend({
  contentSchemaVersion: z.enum(["quizpack-content.v1", "quizpack-content.v2"]),
});
export const supportedManifestV3Schema = quizPackManifestSchema.extend({
  contentSchemaVersion: z.literal("quizpack-content.v3"),
  engine: engineDeclarationV2Schema,
});
export const supportedManifestSchema = z.union([
  legacySupportedManifestSchema,
  supportedManifestV3Schema,
]);
/** One bounded ordinary snapshot, including rejection of accessors and proxies. */
export function parseSupportedManifest(
  input: unknown,
): Result<SupportedManifest> {
  let value: unknown;
  try {
    value = JSON.parse(canonicalP1Json(input, "manifest"));
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: "MANIFEST_STRUCTURE",
          path: [],
          message: "Value does not satisfy the quizpack.v1 manifest contract.",
        },
      ],
    };
  }
  const parsed = supportedManifestSchema.safeParse(value);
  return freezeContent(
    parsed.success
      ? { ok: true, value: parsed.data }
      : {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            code: "MANIFEST_STRUCTURE",
            path: issue.path.filter(
              (p): p is string | number =>
                typeof p === "string" || typeof p === "number",
            ),
            message:
              "Value does not satisfy the quizpack.v1 manifest contract.",
          })),
        },
  );
}
export function getSupportedManifestJsonSchema(version: ContentSchemaVersion) {
  if (version === "quizpack-content.v1") return getQuizPackManifestJsonSchema();
  if (version === "quizpack-content.v3")
    return z.toJSONSchema(supportedManifestV3Schema, {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "throw",
    });
  if (version !== "quizpack-content.v2")
    throw new Error("UNSUPPORTED_CONTENT_SCHEMA");
  return z.toJSONSchema(
    quizPackManifestSchema.extend({
      contentSchemaVersion: z.literal("quizpack-content.v2"),
    }),
    {
      target: "draft-2020-12",
      io: "input",
      unrepresentable: "throw",
    },
  );
}
export const declarationMismatch = () => ({
  code: "CONTENT_DECLARATION_MISMATCH",
  path: ["contentSchemaVersion"],
  message:
    "Manifest and content must match the expected content schema version.",
});
export function isContentSchemaVersion(
  value: unknown,
): value is ContentSchemaVersion {
  return (
    value === "quizpack-content.v1" ||
    value === "quizpack-content.v2" ||
    value === "quizpack-content.v3"
  );
}
export function assertSelection(selection: SupportedCoreSelection): void {
  if (
    !selection ||
    (selection.kind !== "backend-matrix" &&
      (selection.kind !== "expected-version" ||
        !isContentSchemaVersion(selection.expectedContentVersion)))
  )
    throw new Error("Unsupported trusted selection");
}
/** Correlation is established by both discriminants, never by a v2-to-v1 cast. */
export function parseSupportedPack(
  manifestInput: unknown,
  contentInput: unknown,
  selection: SupportedCoreSelection,
): Result<SupportedParsedPack> {
  const manifest = parseSupportedManifest(manifestInput),
    content = parseCurrentContent(contentInput);
  if (!manifest.ok || !content.ok)
    return {
      ok: false,
      issues: [
        ...(!manifest.ok ? manifest.issues : []),
        ...(!content.ok ? content.issues : []),
      ],
    };
  if (
    selection.kind === "expected-version" &&
    (manifest.value.contentSchemaVersion !== selection.expectedContentVersion ||
      content.value.schemaVersion !== selection.expectedContentVersion)
  )
    return { ok: false, issues: [declarationMismatch()] };
  if (
    manifest.value.contentSchemaVersion === "quizpack-content.v1" &&
    content.value.schemaVersion === "quizpack-content.v1"
  )
    return {
      ok: true,
      value: {
        contentSchemaVersion: "quizpack-content.v1",
        manifest: manifest.value,
        content: content.value,
      },
    };
  if (
    manifest.value.contentSchemaVersion === "quizpack-content.v3" &&
    content.value.schemaVersion === "quizpack-content.v3"
  )
    return {
      ok: true,
      value: {
        contentSchemaVersion: "quizpack-content.v3",
        manifest: manifest.value,
        content: content.value,
      },
    };
  if (
    manifest.value.contentSchemaVersion === "quizpack-content.v2" &&
    content.value.schemaVersion === "quizpack-content.v2"
  )
    return {
      ok: true,
      value: {
        contentSchemaVersion: "quizpack-content.v2",
        manifest: manifest.value,
        content: content.value,
      },
    };
  return { ok: false, issues: [declarationMismatch()] };
}
