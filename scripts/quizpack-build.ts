import { PackToolError } from "../src/features/quizpack/v1/zip";
import { failCli, outputJson, productArgument } from "./quizpack-cli";
import { buildQuizPackFile } from "./quizpack-build-operation";
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
  const output = await buildQuizPackFile(inputFile, outFile, context);
  outputJson(output);
  if (!output.ok) process.exitCode = 1;
}
void main().catch(failCli);
