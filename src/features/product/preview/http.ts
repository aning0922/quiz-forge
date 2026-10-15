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
import {
  previewScopeSchema,
  previewEntryResponseSchema,
  previewRevealResponseSchema,
  previewScoreRequestSchema,
} from "./contracts";
import { readPreviewScoreJson } from "./request-json";
import { previewCheckpoint } from "./service";
import type { ProductPreviewService } from "./service-contract";
export type PreviewEndpoint = Readonly<{
  productId: string;
  draftId: string;
  revision: string;
  action: "entry" | "score";
}>;
export function previewEndpointScope(
  endpoint: Omit<PreviewEndpoint, "action">,
) {
  if (!/^[1-9][0-9]{0,9}$/.test(endpoint.revision))
    throw new StudioError("INVALID_REQUEST");
  const value = previewScopeSchema.safeParse({
    productId: endpoint.productId,
    draftId: endpoint.draftId,
    revision: Number(endpoint.revision),
  });
  if (!value.success) throw new StudioError("INVALID_REQUEST");
  return value.data;
}
/** Read-only POST transport: success or failure never has persistent-write UNKNOWN semantics. */
export async function handlePreviewHttp(
  request: Request,
  endpoint: PreviewEndpoint,
  service: ProductPreviewService,
  startedAt = performance.now(),
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
      ? previewScoreRequestSchema.safeParse(
          await readPreviewScoreJson(request, clock.budget),
        )
      : undefined;
    if (input && !input.success) throw new StudioError("INVALID_REQUEST");
    previewCheckpoint(clock.budget);
    db = await createDatabase(config, clock.budget);
    const result =
      post && input?.success
        ? previewRevealResponseSchema.safeParse({
            ok: true,
            value: await service.score(
              db,
              credentials,
              scope,
              input.data,
              clock.budget,
            ),
          })
        : previewEntryResponseSchema.safeParse({
            ok: true,
            value: await service.entry(db, credentials, scope, clock.budget),
          });
    previewCheckpoint(clock.budget);
    if (!result.success) throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
    const text = JSON.stringify(result.data);
    const closing = db;
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
    return errorResponse(error, observationId);
  } finally {
    try {
      await db?.close();
    } catch {
      /* Finite read failure carries no write authority. */
    }
    clock.dispose();
  }
}
