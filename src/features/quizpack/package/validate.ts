import type { ValidateSupportedQuizPack } from "./api";
import { snapshotSupportedContext } from "./context";
import { inspectImage } from "../v1/media";
import { readRestrictedZip, throwIfAborted, withPackDeadline } from "../v1/zip";
import { validateSupportedQuizPackCore } from "./validate-core";
export const validateSupportedQuizPack: ValidateSupportedQuizPack = (
  source,
  context,
  expectedContentVersion,
) =>
  validateSupportedQuizPackCore(
    source,
    context,
    {
      execute: (work) =>
        withPackDeadline(snapshotSupportedContext(context), work),
      checkpoint: throwIfAborted,
      readZip: readRestrictedZip,
      inspect: inspectImage,
      propagate: () => false,
    },
    { kind: "expected-version", expectedContentVersion },
  );
