import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import { assertStudioSource } from "@/lib/http-security/source";
import { readStudioJson } from "@/lib/http-security/json";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import {
  DRAFT_LIMITS,
  applyDraftResultSchema,
  applyReadyValidationSchema,
  draftApplicationScopeSchema,
  draftApplicationReadResultSchema,
  draftIdSchema,
  draftIdempotencyKeySchema,
  draftReadResultSchema,
  draftRevisionDtoSchema,
} from "@/features/product/drafts/contracts";
import type { ProductDraftService } from "@/features/product/drafts/service-contract";
export type DraftEndpoint = {
  action: "apply" | "draft" | "revision" | "application";
  productId: string;
  importId?: string;
  validationId?: string;
  draftId?: string;
  revision?: string;
  idempotencyKey?: string;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
}
/** Measures the complete serialized envelope once, including JSON escaping. */
export function draftJsonResponse(
  value: unknown,
  status: number,
  maximum: number,
) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > maximum)
    throw new StudioError("STUDIO_UNAVAILABLE");
  return new Response(text, {
    status,
    headers: {
      ...privateHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
export async function handleDraftHttp(
  request: Request,
  endpoint: DraftEndpoint,
  service: ProductDraftService,
  startedAt = performance.now(),
): Promise<Response> {
  const requestId = randomUUID(),
    write = endpoint.action === "apply";
  let db: P2aDatabase | undefined,
    serviceEntered = false,
    successful = false;
  const budget = createStudioRequestBudget(request.signal, startedAt);
  try {
    budget.checkpoint();
    const config = await loadRuntimeConfig();
    budget.checkpoint();
    assertStudioSource(request.headers, config, { write, api: true });
    if (
      request.method !== (write ? "POST" : "GET") ||
      new URL(request.url).searchParams.size
    )
      throw new StudioError("INVALID_REQUEST");
    const productId = parse(
      draftApplicationScopeSchema.shape.productId,
      endpoint.productId,
    );
    const credentials = {
      sessionToken: cookieToken(request.headers, "session"),
      csrfToken: request.headers.get("x-csrf-token"),
      requestId,
    };
    if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
    if (
      write &&
      (!credentials.csrfToken ||
        !verifyCsrf(credentials.sessionToken, "session", credentials.csrfToken))
    )
      throw new StudioError("CSRF_REJECTED");
    let execute: (database: P2aDatabase) => Promise<unknown>;
    let status = 200;
    if (endpoint.action === "apply") {
      const scope = parse(draftApplicationScopeSchema, {
        productId,
        sourceImportId: endpoint.importId,
        sourceValidationId: endpoint.validationId,
      });
      const input = parse(
        applyReadyValidationSchema,
        await readStudioJson(request, budget.budget),
      );
      execute = async (database) => {
        const result = applyDraftResultSchema.parse(
          await service.applyReadyValidation(
            database,
            credentials,
            scope,
            input,
          ),
        );
        status = result.created ? 201 : 200;
        return result;
      };
    } else if (endpoint.action === "draft")
      execute = async (database) =>
        draftReadResultSchema.parse(
          await service.readDraft(
            database,
            credentials.sessionToken,
            productId,
          ),
        );
    else if (endpoint.action === "application") {
      const key = parse(draftIdempotencyKeySchema, endpoint.idempotencyKey);
      execute = async (database) =>
        draftApplicationReadResultSchema.parse(
          await service.readDraftApplicationByKey(
            database,
            credentials.sessionToken,
            productId,
            key,
          ),
        );
    } else {
      const draftId = parse(draftIdSchema, endpoint.draftId);
      if (!endpoint.revision || !/^[1-9][0-9]{0,9}$/.test(endpoint.revision))
        throw new StudioError("INVALID_REQUEST");
      const revision = Number(endpoint.revision);
      if (revision > 2147483647) throw new StudioError("INVALID_REQUEST");
      execute = async (database) =>
        draftRevisionDtoSchema.parse(
          await service.readDraftRevision(
            database,
            credentials.sessionToken,
            productId,
            draftId,
            revision,
          ),
        );
    }
    budget.checkpoint();
    try {
      db = await createDatabase(config, budget.budget);
    } catch (error) {
      if (error instanceof StudioError && error.code === "RECEIVE_TIMEOUT")
        throw new StudioError("STUDIO_UNAVAILABLE");
      throw error;
    }
    budget.checkpoint();
    serviceEntered = true;
    const value = await execute(db);
    successful = true;
    budget.checkpoint();
    const response = draftJsonResponse(
      value,
      status,
      endpoint.action === "revision"
        ? DRAFT_LIMITS.revisionResponseBytes
        : DRAFT_LIMITS.smallResponseBytes,
    );
    const closing = db;
    db = undefined;
    await closing.close();
    budget.checkpoint();
    return response;
  } catch (error) {
    const mapped =
      write && serviceEntered && (successful || !(error instanceof StudioError))
        ? new StudioError("WRITE_OUTCOME_UNKNOWN")
        : error;
    return errorResponse(mapped, requestId);
  } finally {
    try {
      await db?.close();
    } catch {
      /* Never turn a close failure into rollback/not-sent authority. */
    } finally {
      budget.dispose();
    }
  }
}
