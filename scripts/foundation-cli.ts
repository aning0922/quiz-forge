import { FoundationJsonError } from "../src/lib/foundation-json";

export function writeFoundationCliError(
  error: unknown,
  fallbackCode: string,
): void {
  const code = error instanceof FoundationJsonError ? error.code : fallbackCode;
  process.stdout.write(
    `${JSON.stringify({
      structurallyValid: false,
      referenceValid: false,
      publishable: false,
      issues: [
        {
          code,
          path: [],
          message: "Foundation input or invocation rejected.",
        },
      ],
      unverified: [
        "zip-container",
        "file-bytes-and-hashes",
        "scoring-and-witnesses",
        "component-registry",
        "human-approval",
        "source-and-commercial-license-claims",
        "database-authorization-and-publication",
      ],
    })}\n`,
  );
  process.exitCode = 1;
}
