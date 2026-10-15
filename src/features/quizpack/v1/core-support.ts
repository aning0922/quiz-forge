import { createHash } from "node:crypto";
import type {
  ValidationContext,
  TrustedCompatibilityPolicy,
  PackIssue,
} from "./api";
import { DEFAULT_COMPATIBILITY_POLICY } from "./compatibility";
import type { QuizPackContent } from "./content";
import { canonicalPackJson } from "./io";
import { resolvePackLimits, type PackLimits } from "./limits";
import { packIdSchema } from "./manifest";
import { PackToolError, packIssue } from "./zip";
export const hashBytes = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");
export function snapshotValidationContext(
  context: ValidationContext,
): ValidationContext & {
  compatibilityPolicy: TrustedCompatibilityPolicy;
  limits: Readonly<PackLimits>;
} {
  if (!packIdSchema.safeParse(context.targetProductId).success)
    throw new PackToolError("INVALID_TARGET_PRODUCT");
  const resolved = resolvePackLimits(context.limits);
  if (!resolved.ok) throw new PackToolError("INVALID_LIMITS");
  const policy = JSON.parse(
    canonicalPackJson(
      context.compatibilityPolicy ?? DEFAULT_COMPATIBILITY_POLICY,
    ),
  ) as TrustedCompatibilityPolicy;
  const strings = (input: unknown) =>
    Array.isArray(input) &&
    input.length <= 128 &&
    input.every((value) => typeof value === "string" && value.length <= 128);
  const declarations = (input: unknown, keys: string[]) =>
    Array.isArray(input) &&
    input.length <= 128 &&
    input.every(
      (value) =>
        value &&
        typeof value === "object" &&
        Object.keys(value).sort().join() === [...keys].sort().join() &&
        Object.values(value).every(
          (field) => typeof field === "string" && field.length <= 128,
        ),
    );
  if (
    !policy ||
    Object.keys(policy).sort().join() !==
      "components,contentSchemaVersions,engines" ||
    !strings(policy.contentSchemaVersions) ||
    !declarations(policy.engines, ["id", "version"]) ||
    !declarations(policy.components, ["id", "version", "propsSchemaVersion"])
  )
    throw new PackToolError("INVALID_COMPATIBILITY_POLICY");
  return {
    targetProductId: context.targetProductId,
    compatibilityPolicy: policy,
    limits: resolved.value,
    ...(context.signal ? { signal: context.signal } : {}),
  };
}
export function loweredContentIssues(
  content: Omit<QuizPackContent, "schemaVersion"> & { schemaVersion: string },
  limits: Readonly<PackLimits>,
): PackIssue[] {
  const issues: PackIssue[] = [];
  const test = (actual: number, max: number, path: (string | number)[]) => {
    if (actual > max) issues.push({ ...packIssue("CONTENT_LIMIT"), path });
  };
  test(content.questions.length, limits.questions, ["questions"]);
  test(content.dimensions.length, limits.dimensions, ["dimensions"]);
  test(content.results.length, limits.results, ["results"]);
  test(content.resources.length, limits.resources, ["resources"]);
  content.questions.forEach((question, i) =>
    test(question.options.length, limits.optionsPerQuestion, [
      "questions",
      i,
      "options",
    ]),
  );
  content.resources.forEach((resource, i) => {
    test(resource.bytes, limits.resourceBytes, ["resources", i, "bytes"]);
    test(resource.width, limits.imageDimension, ["resources", i, "width"]);
    test(resource.height, limits.imageDimension, ["resources", i, "height"]);
    test(resource.width * resource.height, limits.imagePixels, [
      "resources",
      i,
    ]);
  });
  return issues;
}
/** Same restricted archive/manifest integrity closure for validation and trusted restoration. */
export function checkArchiveIntegrity(
  manifest: Readonly<{
    files: readonly Readonly<
      import("./manifest").QuizPackManifest["files"][number]
    >[];
  }>,
  files: ReadonlyMap<string, Uint8Array>,
): PackIssue[] {
  const expected = new Set(["manifest.json"]);
  const integrity: PackIssue[] = [];
  manifest.files.forEach((file, i) => {
    if (expected.has(file.path))
      integrity.push({
        ...packIssue("DUPLICATE_MANIFEST_PATH"),
        path: ["files", i],
      });
    expected.add(file.path);
    const bytes = files.get(file.path);
    if (!bytes)
      integrity.push({
        ...packIssue("MANIFEST_FILE_MISSING"),
        path: ["files", i],
      });
    else if (bytes.length !== file.bytes || hashBytes(bytes) !== file.sha256)
      integrity.push({
        ...packIssue("FILE_INTEGRITY_MISMATCH"),
        path: ["files", i],
      });
  });
  if ([...files.keys()].some((path) => !expected.has(path)))
    integrity.push({
      ...packIssue("UNDECLARED_ARCHIVE_FILE"),
      path: ["files"],
    });
  return integrity;
}
