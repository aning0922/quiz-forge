import { getQuizPackContentJsonSchema } from "../src/features/quizpack/v1/content";
import { getQuizPackManifestJsonSchema } from "../src/features/quizpack/v1/manifest";
import { getContentJsonSchema } from "../src/features/quizpack/content";
import { PackToolError } from "../src/features/quizpack/v1/zip";
import { failCli, outputJson } from "./quizpack-cli";
try {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    outputJson({
      schemaVersion: "quizpack-schemas.v1",
      manifest: getQuizPackManifestJsonSchema(),
      content: getQuizPackContentJsonSchema(),
    });
  } else if (
    args.length === 2 &&
    args[0] === "--content-version" &&
    args[1] === "v2"
  ) {
    outputJson({
      schemaVersion: "quizpack-content-schema.v2",
      content: getContentJsonSchema("quizpack-content.v2"),
    });
  } else {
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  }
} catch (error) {
  failCli(error);
}
