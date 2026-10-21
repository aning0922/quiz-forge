import { SESSION_COOKIE } from "@/lib/auth/cookies";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import {
  preparedValidationDtoSchema,
  startValidationResultSchema,
} from "@/features/quizpack/validation/contracts";

const uncertainBodies = new Set<unknown>();
/** Calls the actual compiled Next route: source imports cannot supply its compiler-fixed roots. */
export async function validateRecoveryArchiveHttp(
  origin: string,
  credentials: StudioWriteCredentials,
  scope: { productId: string; importId: string; stateRevision: number },
) {
  if (
    uncertainBodies.size ||
    !credentials.sessionToken ||
    !credentials.csrfToken ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}$/.test(origin)
  )
    throw Error("RECOVERY_DRILL_HTTP_INVALID");
  const base = `/api/studio/products/${encodeURIComponent(scope.productId)}/imports/${encodeURIComponent(scope.importId)}/validations`;
  const post = async (route: string, input: unknown) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(origin + route, {
        method: "POST",
        signal: controller.signal,
        redirect: "error",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE}=${credentials.sessionToken}`,
          "x-csrf-token": credentials.csrfToken!,
          "x-request-id": crypto.randomUUID(),
        },
        body: JSON.stringify(input),
      });
      if (!response.body) throw Error("RECOVERY_DRILL_HTTP_FAILED");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        total += part.value.length;
        if (total > 65_536) throw Error("RECOVERY_DRILL_HTTP_LIMIT");
        chunks.push(part.value);
      }
      if (!response.ok) throw Error("RECOVERY_DRILL_HTTP_FAILED");
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } finally {
      clearTimeout(timer);
      if (reader) {
        try {
          await reader.cancel();
          reader.releaseLock();
        } catch (error) {
          uncertainBodies.add(reader);
          throw error;
        }
      }
    }
  };
  const prepared = preparedValidationDtoSchema.parse(
    await post(base + "/prepare", {
      expectedImportStateRevision: scope.stateRevision,
    }),
  );
  return startValidationResultSchema.parse(
    await post(base, {
      expectedImportStateRevision: scope.stateRevision,
      expectedValidationKey: prepared.validationKey,
    }),
  );
}
