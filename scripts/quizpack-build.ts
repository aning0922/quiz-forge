import { PackToolError } from "../src/features/quizpack/v1/zip";
import {
  failCli,
  outputJson,
  productArgument,
  contentVersionArgument,
} from "./quizpack-cli";
import {
  buildQuizPackFile,
  buildSupportedQuizPackFile,
} from "./quizpack-build-operation";
async function main(): Promise<void> {
  const [inputFile, productFlag, productId, outFlag, outFile, ...extra] =
    process.argv.slice(2);
  if (
    !inputFile ||
    inputFile.startsWith("-") ||
    productFlag !== "--product" ||
    outFlag !== "--out" ||
    !outFile ||
    outFile.startsWith("-")
  )
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  const expectedContentVersion = contentVersionArgument(extra);
  const context = { targetProductId: productArgument(productId) };
  const output = expectedContentVersion
    ? await buildSupportedQuizPackFile(
        inputFile,
        outFile,
        context,
        expectedContentVersion,
      )
    : await buildQuizPackFile(inputFile, outFile, context);
  outputJson(output);
  if (!output.ok) process.exitCode = 1;
}
void main().catch(failCli);
