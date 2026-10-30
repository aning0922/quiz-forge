import { hasPrivateTestUse } from "../content/private-test";
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
      beforeStructure: (_manifest, content) => {
        if (hasPrivateTestUse(content))
          throw new Error("PRIVATE_TEST_LOCAL_PROVISION_REQUIRED");
      },
      propagate: () => false,
    },
    { kind: "expected-version", expectedContentVersion },
  );
