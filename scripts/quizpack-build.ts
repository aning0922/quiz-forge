import { dirname, resolve } from "node:path";
import { z } from "zod";
import { buildQuizPack } from "../src/features/quizpack/v1/build";
import {
  parsePackJson,
  canonicalPackJson,
  readLocalFile,
  readResourceFile,
  writeArchiveNoClobber,
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
import { failCli, outputJson, productArgument } from "./quizpack-cli";
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
async function main(): Promise<void> {
  const [inputFile, productFlag, productId, outFlag, outFile, ...extra] =
    process.argv.slice(2);
  if (
    !inputFile ||
    inputFile.startsWith("-") ||
    productFlag !== "--product" ||
    outFlag !== "--out" ||
    !outFile ||
    outFile.startsWith("-") ||
    extra.length
  )
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  const context = { targetProductId: productArgument(productId) };
  const output = await withPackDeadline(context, async (signal, limits) => {
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
        candidateValid: false,
        importable: false,
        publishable: false,
      };
    }
    await writeArchiveNoClobber(outFile, result.value.archive, signal);
    return { ok: true, report: result.value.report };
  });
  outputJson(output);
  if (!output.ok) process.exitCode = 1;
}
void main().catch(failCli);
