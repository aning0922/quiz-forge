import { createReadStream } from "node:fs";
import { validateFoundationBundle } from "../src/features/quizpack/foundation";
import {
  FoundationJsonError,
  readFoundationJsonStream,
} from "../src/lib/foundation-json";
import { writeFoundationCliError } from "./foundation-cli";

async function main(): Promise<void> {
  const [file, flag, productId, ...extra] = process.argv.slice(2);
  if (
    !file ||
    (file.startsWith("-") && file !== "-") ||
    flag !== "--product" ||
    !productId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(productId) ||
    extra.length
  ) {
    throw new FoundationJsonError("CLI_INVALID_ARGUMENTS");
  }
  const input = await readFoundationJsonStream(
    file === "-" ? process.stdin : createReadStream(file),
  );
  const result = validateFoundationBundle(input, productId);
  // Structure/reference success cannot grant publishing authority in F1.
  process.stdout.write(
    `${JSON.stringify({ ...result, publishable: false })}\n`,
  );
  if (!result.structurallyValid || !result.referenceValid) process.exitCode = 1;
}

void main().catch((error: unknown) =>
  writeFoundationCliError(error, "CLI_INPUT_READ_FAILED"),
);
