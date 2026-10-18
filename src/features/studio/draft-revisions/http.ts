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
  draftApplicationScopeSchema,
  draftIdSchema,
} from "@/features/product/drafts/contracts";
import {
  DRAFT_REVISION_LIMITS,
  appendReadyValidationSchema,
  appendDraftBindingSchema,
  appendDraftResultSchema,
  draftRevisionResolutionSchema,
  draftRevisionHistorySchema,
} from "@/features/product/draft-revisions/contracts";
import type { ProductDraftRevisionService } from "@/features/product/draft-revisions/service-contract";
import { parseRevisionHistoryQuery } from "./urls";
import {
  checkAppendResult,
  checkRevisionResolution,
  checkRevisionHistory,
} from "./client";
export type RevisionEndpoint = Readonly<{
  action: "append" | "resolve" | "history";
  productId: string;
  importId?: string;
  validationId?: string;
  draftId?: string;
}>;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
}
export function revisionJsonResponse(
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
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
/** Source/CSRF applies to both POSTs. Only append enters write/UNKNOWN semantics. */
export async function handleDraftRevisionHttp(
  request: Request,
  endpoint: RevisionEndpoint,
  service: ProductDraftRevisionService,
  startedAt = performance.now(),
): Promise<Response> {
  const requestId = randomUUID(),
    write = endpoint.action === "append",
    post = endpoint.action !== "history",
    budget = createStudioRequestBudget(request.signal, startedAt);
  let db: P2aDatabase | undefined,
    entered = false,
    successful = false;
  try {
    budget.checkpoint();
    const config = await loadRuntimeConfig();
    budget.checkpoint();
    assertStudioSource(request.headers, config, { write: post, api: true });
    const url = new URL(request.url);
    if (request.method !== (post ? "POST" : "GET") || (post && url.search))
      throw new StudioError("INVALID_REQUEST");
    const productId = parse(
        draftApplicationScopeSchema.shape.productId,
        endpoint.productId,
      ),
      credentials = {
        sessionToken: cookieToken(request.headers, "session"),
        csrfToken: request.headers.get("x-csrf-token"),
        requestId,
      };
    if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
    if (
      post &&
      (!credentials.csrfToken ||
        !verifyCsrf(credentials.sessionToken, "session", credentials.csrfToken))
    )
      throw new StudioError("CSRF_REJECTED");
    let execute: (database: P2aDatabase) => Promise<unknown>,
      status = 200;
    if (endpoint.action === "append") {
      const scope = parse(draftApplicationScopeSchema, {
          productId,
          sourceImportId: endpoint.importId,
          sourceValidationId: endpoint.validationId,
        }),
        input = parse(
          appendReadyValidationSchema,
          await readStudioJson(request, budget.budget),
        );
      execute = async (database) => {
        const value = await service.appendReadyValidation(
          database,
          credentials,
          scope,
          input,
        );
        successful = true;
        const result = appendDraftResultSchema.parse(value);
        status = result.created ? 201 : 200;
        return checkAppendResult(result, status, { ...scope, ...input });
      };
    } else if (endpoint.action === "resolve") {
      const binding = parse(
        appendDraftBindingSchema,
        await readStudioJson(request, budget.budget),
      );
      if (binding.productId !== productId)
        throw new StudioError("INVALID_REQUEST");
      execute = async (database) =>
        checkRevisionResolution(
          draftRevisionResolutionSchema.parse(
            await service.resolveApplication(
              database,
              credentials.sessionToken,
              binding,
            ),
          ),
          binding,
        );
    } else {
      const draftId = parse(draftIdSchema, endpoint.draftId);
      let query;
      try {
        query = parseRevisionHistoryQuery(url);
      } catch {
        throw new StudioError("INVALID_REQUEST");
      }
      execute = async (database) =>
        checkRevisionHistory(
          draftRevisionHistorySchema.parse(
            await service.readHistory(
              database,
              credentials.sessionToken,
              productId,
              draftId,
              query,
            ),
          ),
          productId,
          draftId,
          query,
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
    entered = true;
    const value = await execute(db);
    budget.checkpoint();
    const response = revisionJsonResponse(
      value,
      status,
      endpoint.action === "history"
        ? DRAFT_REVISION_LIMITS.historyResponseBytes
        : DRAFT_REVISION_LIMITS.responseBytes,
    );
    const closing = db;
    db = undefined;
    await closing.close();
    budget.checkpoint();
    return response;
  } catch (error) {
    let mapped =
      write && entered && (successful || !(error instanceof StudioError))
        ? new StudioError("WRITE_OUTCOME_UNKNOWN")
        : error;
    if (
      !write &&
      mapped instanceof StudioError &&
      mapped.code === "WRITE_OUTCOME_UNKNOWN"
    )
      mapped = new StudioError("STUDIO_UNAVAILABLE");
    const response = errorResponse(mapped, requestId);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } finally {
    try {
      await db?.close();
    } catch {
      /* Closing cannot confer rollback authority. */
    } finally {
      budget.dispose();
    }
  }
}
