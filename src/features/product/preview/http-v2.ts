import "server-only";
import { randomUUID } from "node:crypto";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import { assertStudioSource } from "@/lib/http-security/source";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import { assertPreviewCsrf } from "./auth";
import { previewEndpointScope, type PreviewEndpoint } from "./http";
import { previewCheckpoint } from "./service";
import { readPreviewScoreJson } from "./request-json";
import { currentProductPreviewService } from "./service-v2";
import {
  currentPreviewResponseSchema,
  temporaryPreviewRequestV2Schema,
  temporaryPreviewResultResponseV2Schema,
} from "./contracts-v2";

/** Read-only temporary evaluation. No write receipt/UNKNOWN or consumer authority is created. */
export async function handleCurrentPreviewHttp(
  request: Request,
  endpoint: PreviewEndpoint,
  startedAt = performance.now(),
  service = currentProductPreviewService,
): Promise<Response> {
  const observationId = randomUUID(),
    clock = createStudioRequestBudget(request.signal, startedAt);
  let db: P2aDatabase | undefined;
  try {
    previewCheckpoint(clock.budget);
    const config = await loadRuntimeConfig();
    previewCheckpoint(clock.budget);
    const post = endpoint.action === "score";
    assertStudioSource(request.headers, config, { write: post, api: true });
    if (
      request.method !== (post ? "POST" : "GET") ||
      new URL(request.url).search
    )
      throw new StudioError("INVALID_REQUEST");
    const scope = previewEndpointScope(endpoint);
    const credentials = {
      sessionToken: cookieToken(request.headers, "session"),
      csrfToken: request.headers.get("x-csrf-token"),
    };
    if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
    if (post) assertPreviewCsrf(credentials);
    const input = post
      ? temporaryPreviewRequestV2Schema.safeParse(
          await readPreviewScoreJson(request, clock.budget),
        )
      : undefined;
    if (input && !input.success) throw new StudioError("INVALID_REQUEST");
    previewCheckpoint(clock.budget);
    db = await createDatabase(config, clock.budget);
    const result =
      post && input?.success
        ? temporaryPreviewResultResponseV2Schema.safeParse({
            ok: true,
            value: await service.score(
              db,
              credentials,
              scope,
              input.data,
              clock.budget,
            ),
          })
        : currentPreviewResponseSchema.safeParse({
            ok: true,
            value: await service.entry(db, credentials, scope, clock.budget),
          });
    previewCheckpoint(clock.budget);
    if (!result.success) throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
    const text = JSON.stringify(result.data),
      closing = db;
    db = undefined;
    await closing.close();
    previewCheckpoint(clock.budget);
    return new Response(text, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    if (
      clock.budget.signal.aborted ||
      performance.now() >= clock.budget.deadlineMonotonicMs
    ) {
      try {
        previewCheckpoint(clock.budget);
      } catch (expired) {
        error = expired;
      }
    }
    const response = errorResponse(error, observationId);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } finally {
    try {
      await db?.close();
    } catch {
      /* Read failure grants no write authority. */
    }
    clock.dispose();
  }
}
