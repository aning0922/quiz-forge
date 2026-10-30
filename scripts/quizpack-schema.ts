import { getQuizPackContentJsonSchema } from "../src/features/quizpack/v1/content";
import { getQuizPackManifestJsonSchema } from "../src/features/quizpack/v1/manifest";
import { getCurrentContentJsonSchema as getContentJsonSchema } from "../src/features/quizpack/content/current";
import { getSupportedManifestJsonSchema } from "../src/features/quizpack/package/manifest";
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
    ["v2", "v3"].includes(args[1]!)
  ) {
    outputJson({
      schemaVersion:
        args[1] === "v2"
          ? "quizpack-content-schema.v2"
          : "quizpack-content-schema.v3",
      content: getContentJsonSchema(
        args[1] === "v2" ? "quizpack-content.v2" : "quizpack-content.v3",
      ),
    });
  } else if (
    args.length === 2 &&
    args[0] === "--manifest-content-version" &&
    ["v1", "v2", "v3"].includes(args[1]!)
  ) {
    const version =
      args[1] === "v1"
        ? "quizpack-content.v1"
        : args[1] === "v2"
          ? "quizpack-content.v2"
          : "quizpack-content.v3";
    outputJson({
      schemaVersion: "quizpack-supported-manifest-schema.v1",
      contentSchemaVersion: version,
      manifest: getSupportedManifestJsonSchema(version),
    });
  } else {
    throw new PackToolError("CLI_INVALID_ARGUMENTS");
  }
} catch (error) {
  failCli(error);
}
