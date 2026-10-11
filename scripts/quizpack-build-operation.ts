import { dirname, resolve } from "node:path";
import { z } from "zod";
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
export interface CommittedBuildOutput {
  ok: true;
  committed: true;
  report: QuizPackValidationReport;
  output: ArchiveCommitReceipt;
}
/** Shared by the CLI and IO injection tests; packages cannot configure IO hooks. */
export async function buildQuizPackFile(
  inputFile: string,
  outFile: string,
  context: ValidationContext,
) {
  let committed: CommittedBuildOutput | undefined;
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
      const result = await buildQuizPack(
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
