import { types } from "node:util";
import { ZipFile } from "yazl";
import type { BuildInput, BuildOutput, Result, ValidationContext } from "./api";
import { parseQuizPackContent } from "./content";
import { canonicalPackJson, parsePackJson } from "./io";
import type { QuizPackManifest } from "./manifest";
import {
  hashBytes,
  snapshotValidationContext,
  validateQuizPack,
} from "./validate";
import {
  PackToolError,
  isPackPath,
  packIssue,
  readBoundedBytes,
  throwIfAborted,
  withPackDeadline,
} from "./zip";

export async function createStoredArchive(
  files: readonly { path: string; bytes: Uint8Array }[],
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const zip = new ZipFile();
  const stream = zip.outputStream as NodeJS.ReadableStream &
    AsyncIterable<Uint8Array> & { destroy(error?: Error): void };
  zip.on("error", () => stream.destroy(new PackToolError("ZIP_BUILD_FAILED")));
  const stop = () => stream.destroy(new PackToolError("OPERATION_CANCELLED"));
  signal.addEventListener("abort", stop, { once: true });
  try {
    throwIfAborted(signal);
    for (const file of [...files].sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    )) {
      zip.addBuffer(Buffer.from(file.bytes), file.path, {
        compress: false,
        forceDosTimestamp: true,
        forceZip64Format: false,
        mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
        mode: 0o100644,
      });
    }
    zip.end({ forceZip64Format: false, comment: "" });
    return await readBoundedBytes(stream, max, signal);
  } finally {
    signal.removeEventListener("abort", stop);
    stream.destroy();
  }
}
/** Caller declarations are never repaired; actual bytes must independently validate. */
export type QuizPackBuildResult = Result<BuildOutput> & {
  issuesTruncated?: boolean;
};
export async function buildQuizPack(
  input: BuildInput,
  context: ValidationContext,
): Promise<QuizPackBuildResult> {
  try {
    return await withPackDeadline(context, async (signal, limits) => {
      const snapshot = snapshotValidationContext({
        ...context,
        signal,
        limits,
      });
      // Canonicalize all ordinary metadata before the first asynchronous boundary.
      if (types.isProxy(input)) throw new PackToolError("BUILD_INVALID_INPUT");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      if (
        Object.keys(descriptors).sort().join() !==
          "assets,content,packId,packVersion" ||
        Object.values(descriptors).some(
          (d) => !("value" in d) || !d.enumerable,
        ) ||
        Object.getOwnPropertySymbols(input).length ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      )
        throw new PackToolError("BUILD_INVALID_INPUT");
      const identity = JSON.parse(
        canonicalPackJson({
          packId: input.packId,
          packVersion: input.packVersion,
        }),
      ) as { packId: string; packVersion: string };
      const contentBytes = Buffer.from(canonicalPackJson(input.content));
      if (contentBytes.length > snapshot.limits.contentBytes)
        throw new PackToolError("CONTENT_SIZE_LIMIT");
      const content = parseQuizPackContent(
        parsePackJson(contentBytes, snapshot.limits.jsonDepth),
      );
      if (!content.ok)
        return {
          ok: false,
          issues: content.issues.slice(0, limits.issues),
          issuesTruncated: content.issues.length > limits.issues,
        };
      if (
        !Array.isArray(input.assets) ||
        types.isProxy(input.assets) ||
        input.assets.length > snapshot.limits.resources
      )
        throw new PackToolError("BUILD_ASSET_LIMIT");
      const arrayFields = Object.getOwnPropertyDescriptors(input.assets);
      if (
        Object.getPrototypeOf(input.assets) !== Array.prototype ||
        Object.getOwnPropertySymbols(input.assets).length ||
        Object.keys(arrayFields).length !== input.assets.length + 1
      )
        throw new PackToolError("BUILD_INVALID_ASSET");
      for (let i = 0; i < input.assets.length; i++)
        if (
          !arrayFields[String(i)] ||
          !("value" in arrayFields[String(i)]!) ||
          !arrayFields[String(i)]!.enumerable
        )
          throw new PackToolError("BUILD_INVALID_ASSET");
      const assets: { path: string; bytes: Buffer }[] = [];
      const seen = new Set<string>();
      let payloadBytes = contentBytes.length;
      const payloadLimit = Math.min(
        limits.totalUncompressedBytes,
        limits.archiveBytes,
      );
      if (payloadBytes > payloadLimit)
        throw new PackToolError("BUILD_TOTAL_LIMIT");
      for (const item of input.assets) {
        if (!item || types.isProxy(item))
          throw new PackToolError("BUILD_INVALID_ASSET");
        const fields = Object.getOwnPropertyDescriptors(item);
        if (
          Object.keys(fields).sort().join() !== "bytes,path" ||
          Object.values(fields).some((d) => !("value" in d))
        )
          throw new PackToolError("BUILD_INVALID_ASSET");
        if (
          typeof item.path !== "string" ||
          !isPackPath(item.path) ||
          !item.path.startsWith("assets/") ||
          seen.has(item.path) ||
          !types.isUint8Array(item.bytes) ||
          types.isProxy(item.bytes)
        )
          throw new PackToolError("BUILD_INVALID_ASSET");
        if (item.bytes.length > snapshot.limits.resourceBytes)
          throw new PackToolError("BUILD_ASSET_LIMIT");
        payloadBytes += item.bytes.length;
        if (payloadBytes > payloadLimit)
          throw new PackToolError("BUILD_TOTAL_LIMIT");
        if (
          !content.value.resources.some(
            (resource) => resource.path === item.path,
          )
        )
          throw new PackToolError("BUILD_UNDECLARED_ASSET");
        seen.add(item.path);
        assets.push({ path: item.path, bytes: Buffer.from(item.bytes) });
      }
      throwIfAborted(signal);
      const components = new Map<
        string,
        QuizPackManifest["components"][number]
      >();
      for (const component of [
        ...Object.values(content.value.layouts).map(
          (layout) => layout.component,
        ),
        ...content.value.reportTemplates.map((report) => report.component),
      ])
        components.set(canonicalPackJson(component), component);
      const manifest: QuizPackManifest = {
        schemaVersion: "quizpack.v1",
        ...identity,
        productId: content.value.product.productId,
        contentSchemaVersion: content.value.schemaVersion,
        engine: content.value.engine,
        components: [...components.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, value]) => value),
        files: [
          {
            path: "content.json",
            bytes: contentBytes.length,
            sha256: hashBytes(contentBytes),
            mediaType: "application/json" as const,
          },
          ...assets.map((asset) => ({
            path: asset.path,
            bytes: asset.bytes.length,
            sha256: hashBytes(asset.bytes),
            mediaType: content.value.resources.find(
              (resource) => resource.path === asset.path,
            )!.mediaType,
          })),
        ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      };
      const manifestBytes = Buffer.from(canonicalPackJson(manifest));
      if (manifestBytes.length > limits.manifestBytes)
        throw new PackToolError("MANIFEST_SIZE_LIMIT");
      const files = [
        { path: "manifest.json", bytes: manifestBytes },
        { path: "content.json", bytes: contentBytes },
        ...assets,
      ];
      if (
        files.length > limits.entries ||
        files.reduce((size, file) => size + file.bytes.length, 0) >
          limits.totalUncompressedBytes
      )
        throw new PackToolError("BUILD_TOTAL_LIMIT");
      const archive = await createStoredArchive(
        files,
        limits.archiveBytes,
        signal,
      );
      const report = await validateQuizPack(
        (async function* () {
          yield archive;
        })(),
        { ...snapshot, signal },
      );
      throwIfAborted(signal);
      if (!report.candidateValid)
        return {
          ok: false,
          issues: report.issues,
          issuesTruncated: report.issuesTruncated,
        };
      return { ok: true, value: { archive, report } };
    });
  } catch (error) {
    return {
      ok: false,
      issues: [
        packIssue(error instanceof PackToolError ? error.code : "BUILD_FAILED"),
      ],
    };
  }
}
