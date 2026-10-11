import { getQuizPackContentJsonSchema } from "../src/features/quizpack/v1/content";
import { getQuizPackManifestJsonSchema } from "../src/features/quizpack/v1/manifest";
import { PackToolError } from "../src/features/quizpack/v1/zip";
import { failCli, outputJson } from "./quizpack-cli";
try {
  if (process.argv.length !== 2)
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  outputJson({
    schemaVersion: "quizpack-schemas.v1",
    manifest: getQuizPackManifestJsonSchema(),
    content: getQuizPackContentJsonSchema(),
  });
} catch (error) {
  failCli(error);
}
