import { readLocalFile } from "../src/features/quizpack/v1/io";
import { validateQuizPack } from "../src/features/quizpack/v1/validate";
import {
  PackToolError,
  readBoundedBytes,
  withPackDeadline,
} from "../src/features/quizpack/v1/zip";
import { failCli, outputJson, productArgument } from "./quizpack-cli";
async function main(): Promise<void> {
  const [file, flag, productId, ...extra] = process.argv.slice(2);
  if (
    !file ||
    (file.startsWith("-") && file !== "-") ||
    flag !== "--product" ||
    extra.length
  )
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  const context = { targetProductId: productArgument(productId) };
  const report = await withPackDeadline(context, async (signal, limits) => {
    const bytes =
      file === "-"
        ? await readBoundedBytes(process.stdin, limits.archiveBytes, signal)
        : await readLocalFile(file, limits.archiveBytes, signal);
    return await validateQuizPack(
      (async function* () {
        yield bytes;
      })(),
      { ...context, signal },
    );
  });
  outputJson(report);
  if (!report.candidateValid) process.exitCode = 1;
}
void main().catch(failCli);
