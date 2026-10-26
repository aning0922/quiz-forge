import { dirname, resolve } from "node:path";
import { z } from "zod";
import { buildSupportedQuizPack } from "../src/features/quizpack/package/build";
import type {
  ContentSchemaVersion,
  PackageValidationReport,
  SupportedValidationContext,
  SupportedValidationReportV2,
  SupportedValidationReportV3,
} from "../src/features/quizpack/package/api";
import { buildQuizPack } from "../src/features/quizpack/v1/build";
import {
  parsePackJson,
  canonicalPackJson,
  readLocalFile,
  readResourceFile,
  writeArchiveNoClobber,
  recordPostCommitInterruption,
  type ArchiveCommitReceipt,
} from "../src/features/quizpack/v1/io";
import {
  assetPathSchema,
  packIdSchema,
  packVersionSchema,
} from "../src/features/quizpack/v1/manifest";
import {
  PackToolError,
  withPackDeadline,
} from "../src/features/quizpack/v1/zip";
import type {
  ValidationContext,
  BuildInput,
  Result,
  QuizPackValidationReport,
} from "../src/features/quizpack/v1/api";
const inputSchema = z.strictObject({
  packId: packIdSchema,
  packVersion: packVersionSchema,
  contentFile: z.string().min(1).max(512),
  assets: z
    .array(
      z.strictObject({
        path: assetPathSchema,
        source: z.string().min(1).max(512),
      }),
    )
    .max(64),
});
export interface CommittedBuildOutput<
  R extends PackageValidationReport = QuizPackValidationReport,
> {
  ok: true;
  committed: true;
  report: R;
  output: ArchiveCommitReceipt;
}
/** Shared by the CLI and IO injection tests; packages cannot configure IO hooks. */
async function buildQuizPackFileWith<R extends PackageValidationReport>(
  inputFile: string,
  outFile: string,
  context: ValidationContext,
  builder: (
    input: BuildInput,
    context: ValidationContext,
  ) => Promise<
    Result<{ archive: Uint8Array; report: R }> & { issuesTruncated?: boolean }
  >,
) {
  let committed: CommittedBuildOutput<R> | undefined;
  try {
    return await withPackDeadline(context, async (signal, limits) => {
      const spec = inputSchema.safeParse(
        parsePackJson(
          await readLocalFile(inputFile, limits.manifestBytes, signal),
          limits.jsonDepth,
        ),
      );
      if (!spec.success) throw new PackToolError("CLI_BUILD_INPUT_STRUCTURE");
      const root = dirname(resolve(inputFile));
      const content = parsePackJson(
        await readResourceFile(
          root,
          spec.data.contentFile,
          limits.contentBytes,
          signal,
        ),
        limits.jsonDepth,
      );
      const assets = [];
      let payloadBytes = Buffer.byteLength(canonicalPackJson(content));
      const payloadLimit = Math.min(
        limits.archiveBytes,
        limits.totalUncompressedBytes,
      );
      for (const asset of spec.data.assets) {
        const bytes = await readResourceFile(
          root,
          asset.source,
          limits.resourceBytes,
          signal,
        );
        payloadBytes += bytes.length;
        if (payloadBytes > payloadLimit)
          throw new PackToolError("BUILD_TOTAL_LIMIT");
        assets.push({
          path: asset.path,
          bytes,
        });
      }
      const result = await builder(
        {
          packId: spec.data.packId,
          packVersion: spec.data.packVersion,
          content,
          assets,
        },
        { ...context, signal },
      );
      if (!result.ok) {
        return {
          ...result,
          committed: false,
          candidateValid: false,
          importable: false,
          publishable: false,
        };
      }
      const receipt = await writeArchiveNoClobber(
        outFile,
        result.value.archive,
        signal,
      );
      committed = {
        ok: true,
        committed: true,
        report: result.value.report,
        output: receipt,
      };
      return committed;
    });
  } catch (error) {
    if (!committed) throw error;
    recordPostCommitInterruption(committed.output, error);
    return committed;
  }
}

/** Legacy path keeps the exact P1 report type and output bytes. */
export function buildQuizPackFile(
  inputFile: string,
  outFile: string,
  context: ValidationContext,
) {
  return buildQuizPackFileWith<QuizPackValidationReport>(
    inputFile,
    outFile,
    context,
    buildQuizPack,
  );
}
export function buildSupportedQuizPackFile(
  inputFile: string,
  outFile: string,
  context: SupportedValidationContext,
  expectedContentVersion: ContentSchemaVersion,
) {
  if (
    expectedContentVersion !== "quizpack-content.v1" &&
    expectedContentVersion !== "quizpack-content.v2" &&
    expectedContentVersion !== "quizpack-content.v3"
  )
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  return buildQuizPackFileWith<
    SupportedValidationReportV2 | SupportedValidationReportV3
  >(inputFile, outFile, context, (input, selected) =>
    buildSupportedQuizPack(input, selected, expectedContentVersion),
  );
}
