import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import { assertStudioSource } from "@/lib/http-security/source";
import { readStudioJson } from "@/lib/http-security/json";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import { productIdSchema } from "@/features/product/workspace/contracts";
import { importIdSchema } from "@/features/quizpack/import/contracts";
import {
  prepareValidationSchema,
  startValidationSchema,
  validationCasSchema,
  validationIdSchema,
  preparedValidationDtoSchema,
  validationDtoSchema,
  validationPageSchema,
  startValidationResultSchema,
} from "@/features/quizpack/validation/contracts";
import { createValidationContext } from "@/features/quizpack/validation/operation";
import { readMediaOperationState } from "@/features/quizpack/server/media";
import type { QuizpackValidationService } from "@/features/quizpack/validation/service-contract";
import { parseValidationQuery } from "./query";
export type ValidationEndpoint = {
  action: "prepare" | "start" | "list" | "read" | "recover" | "retry";
  productId: string;
  importId: string;
  validationId?: string;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
}
/** Typed dispatch only. Production routes bind the actual application service, never a fallback. */
export async function handleValidationHttp(
  request: Request,
  endpoint: ValidationEndpoint,
  service: QuizpackValidationService,
  startedAt = performance.now(),
): Promise<Response> {
  const write = endpoint.action !== "read" && endpoint.action !== "list";
  const budget = write
    ? createValidationContext(request.signal, startedAt)
    : undefined;
  const requestId = randomUUID();
  let db: P2aDatabase | undefined;
  const checkpoint = () => {
    if (!budget) return;
    const state = readMediaOperationState(budget.context);
    if (state.phase === "stopping")
      throw new StudioError(
        state.stop.reason === "CANCELLED"
          ? "VALIDATION_CANCELLED"
          : "VALIDATION_TIMEOUT",
      );
  };
  try {
    checkpoint();
    const config = await loadRuntimeConfig();
    checkpoint();
    assertStudioSource(request.headers, config, { write, api: true });
    if (request.method !== (write ? "POST" : "GET"))
      throw new StudioError("INVALID_REQUEST");
    const productId = parse(productIdSchema, endpoint.productId);
    const importId = parse(importIdSchema, endpoint.importId);
    const params = new URL(request.url).searchParams;
    if (endpoint.action !== "list" && params.size)
      throw new StudioError("INVALID_REQUEST");
    const credentials: StudioWriteCredentials = {
      sessionToken: cookieToken(request.headers, "session"),
      csrfToken: request.headers.get("x-csrf-token"),
      requestId,
    };
    if (write) {
      if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
      if (
        !credentials.csrfToken ||
        !verifyCsrf(credentials.sessionToken, "session", credentials.csrfToken)
      )
        throw new StudioError("CSRF_REJECTED");
    }
    let execute: (database: P2aDatabase) => Promise<unknown>;
    let status = 200;
    if (endpoint.action === "list") {
      let query;
      try {
        query = parseValidationQuery(params);
      } catch {
        throw new StudioError("INVALID_REQUEST");
      }
      execute = async (database) =>
        validationPageSchema.parse(
          await service.listValidations(
            database,
            credentials.sessionToken,
            productId,
            importId,
            query,
          ),
        );
    } else if (endpoint.action === "prepare") {
      const input = parse(
        prepareValidationSchema,
        await readStudioJson(request),
      );
      execute = async (database) =>
        preparedValidationDtoSchema.parse(
          await service.prepareValidation(
            database,
            credentials,
            productId,
            importId,
            input,
            budget!.context,
          ),
        );
    } else if (endpoint.action === "start") {
      const input = parse(startValidationSchema, await readStudioJson(request));
      execute = async (database) => {
        const result = startValidationResultSchema.parse(
          await service.startValidation(
            database,
            credentials,
            productId,
            importId,
            input,
            budget!.context,
          ),
        );
        status = result.outcome === "record" && result.created ? 201 : 200;
        return result;
      };
    } else {
      const id = parse(validationIdSchema, endpoint.validationId);
      if (endpoint.action === "read")
        execute = async (database) =>
          validationDtoSchema.parse(
            await service.readValidation(
              database,
              credentials.sessionToken,
              productId,
              importId,
              id,
            ),
          );
      else {
        const input = parse(validationCasSchema, await readStudioJson(request));
        const action = endpoint.action;
        execute = async (database) =>
          validationDtoSchema.parse(
            await service[
              action === "recover" ? "recoverValidation" : "retryValidation"
            ](
              database,
              credentials,
              productId,
              importId,
              id,
              input,
              budget!.context,
            ),
          );
      }
    }
    checkpoint();
    try {
      db = await createDatabase(config, budget?.context);
    } catch (error) {
      // The shared DB opener uses the older receive timeout vocabulary.
      if (
        budget &&
        error instanceof StudioError &&
        error.code === "RECEIVE_TIMEOUT"
      )
        throw new StudioError("VALIDATION_TIMEOUT");
      throw error;
    }
    checkpoint();
    const result = await execute(db);
    return Response.json(result, { status, headers: privateHeaders });
  } catch (error) {
    return errorResponse(error, requestId);
  } finally {
    await db?.close().catch(() => undefined);
    budget?.dispose();
  }
}
