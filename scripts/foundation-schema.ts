import { getFoundationJsonSchema } from "../src/features/quizpack/foundation";
import { FoundationJsonError } from "../src/lib/foundation-json";
import { writeFoundationCliError } from "./foundation-cli";

try {
  if (process.argv.length !== 2)
    throw new FoundationJsonError("CLI_INVALID_ARGUMENTS");
  process.stdout.write(
    `${JSON.stringify(getFoundationJsonSchema(), null, 2)}\n`,
  );
} catch (error: unknown) {
  writeFoundationCliError(error, "CLI_SCHEMA_FAILED");
}
