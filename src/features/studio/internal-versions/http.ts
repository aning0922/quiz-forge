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
import { privateHeaders, StudioError } from "@/lib/http-security/errors";
import {
  INTERNAL_VERSION_LIMITS as L,
  INTERNAL_VERSION_HTTP_STATUSES,
  internalVersionErrorCodeSchema,
  recordBaselineInputSchema,
  sealInternalVersionInputSchema,
  recordBaselineBindingSchema,
  sealInternalVersionBindingSchema,
  internalVersionListResponseSchema,
  internalVersionDetailResponseSchema,
} from "@/features/product/internal-versions/contracts";
import { verifyInternalVersionDetail } from "@/features/product/internal-versions/integrity";
import {
  internalRevisionScopeSchema,
  internalRevisionParam,
} from "@/features/product/internal-versions/urls";
import {
  createInternalVersionOwner,
  type InternalVersionOwner,
} from "@/features/product/internal-versions/lifecycle";
import type { ProductInternalVersionService } from "@/features/product/internal-versions/service-contract";
import {
  checkReviewResult,
  checkSealResult,
  checkReviewResolution,
  checkVersionResolution,
  checkReviewState,
} from "./client";

export type InternalVersionEndpoint = Readonly<{
  action:
    | "record"
    | "seal"
    | "resolve-review"
    | "resolve-version"
    | "state"
    | "list"
    | "detail";
  productId: string;
  draftId?: string;
  revision?: string;
  versionId?: string;
}>;
export type InternalVersionServiceFactory = (
  owner: InternalVersionOwner,
) => ProductInternalVersionService;
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
};
export function internalJsonResponse(
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
/** Reconstruct the finite error DTO; legacy currentRevision fields never cross this boundary. */
function failure(error: unknown, requestId: string, write: boolean) {
  const parsed = internalVersionErrorCodeSchema.safeParse(
    error instanceof StudioError ? error.code : undefined,
  );
  const code =
    parsed.success && (write || parsed.data !== "WRITE_OUTCOME_UNKNOWN")
      ? parsed.data
      : "STUDIO_UNAVAILABLE";
  return internalJsonResponse(
    { code, requestId },
    INTERNAL_VERSION_HTTP_STATUSES[code],
    L.errorResponseBytes,
  );
}
/** Inject the actual owner-dependent factory. Read/resolve never invoke owner.runNew here. */
export async function handleInternalVersionHttp(
  request: Request,
  endpoint: InternalVersionEndpoint,
  factory: InternalVersionServiceFactory,
  startedAt = performance.now(),
): Promise<Response> {
  const requestId = randomUUID(),
    write = endpoint.action === "record" || endpoint.action === "seal",
    post =
      write ||
      endpoint.action === "resolve-review" ||
      endpoint.action === "resolve-version",
    clock = createStudioRequestBudget(request.signal, startedAt);
  let db: P2aDatabase | undefined,
    owner: InternalVersionOwner | undefined,
    entered = false,
    successful = false;
  try {
    clock.checkpoint();
    const config = await loadRuntimeConfig();
    clock.checkpoint();
    assertStudioSource(request.headers, config, { write: post, api: true });
    if (
      request.method !== (post ? "POST" : "GET") ||
      new URL(request.url).search
    )
      throw new StudioError("INVALID_REQUEST");
    const productId = parse(
        internalRevisionScopeSchema.shape.productId,
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
    let execute: (
        service: ProductInternalVersionService,
        database: P2aDatabase,
      ) => Promise<unknown>,
      status = 200;
    if (endpoint.action === "record" || endpoint.action === "state") {
      let revision: number;
      try {
        revision = internalRevisionParam(endpoint.revision);
      } catch {
        throw new StudioError("INVALID_REQUEST");
      }
      const scope = parse(internalRevisionScopeSchema, {
        productId,
        draftId: endpoint.draftId,
        revision,
      });
      if (endpoint.action === "record") {
        const input = parse(
          recordBaselineInputSchema,
          await readStudioJson(request, clock.budget),
        );
        if (
          input.target.draftId !== scope.draftId ||
          input.target.revision !== scope.revision
        )
          throw new StudioError("INVALID_REQUEST");
        execute = async (service, database) => {
          const value = await service.recordBaseline(
            database,
            credentials,
            scope,
            input,
            clock.budget,
          );
          successful = true;
          status = value.created ? 201 : 200;
          return {
            ok: true,
            value: await checkReviewResult({ ok: true, value }, status, {
              productId,
              ...input,
            }),
          };
        };
      } else
        execute = async (service, database) => ({
          ok: true,
          value: await checkReviewState(
            {
              ok: true,
              value: await service.readReviewState(
                database,
                credentials.sessionToken,
                scope,
              ),
            },
            scope,
          ),
        });
    } else if (endpoint.action === "seal") {
      const input = parse(
        sealInternalVersionInputSchema,
        await readStudioJson(request, clock.budget),
      );
      execute = async (service, database) => {
        const value = await service.sealInternalVersion(
          database,
          credentials,
          productId,
          input,
          clock.budget,
        );
        successful = true;
        status = value.created ? 201 : 200;
        return {
          ok: true,
          value: await checkSealResult({ ok: true, value }, status, {
            productId,
            ...input,
          }),
        };
      };
    } else if (endpoint.action === "resolve-review") {
      const binding = parse(
        recordBaselineBindingSchema,
        await readStudioJson(request, clock.budget),
      );
      if (binding.productId !== productId)
        throw new StudioError("INVALID_REQUEST");
      execute = async (service, database) => ({
        ok: true,
        value: await checkReviewResolution(
          await service.resolveReview(
            database,
            credentials.sessionToken,
            binding,
          ),
          binding,
        ),
      });
    } else if (endpoint.action === "resolve-version") {
      const binding = parse(
        sealInternalVersionBindingSchema,
        await readStudioJson(request, clock.budget),
      );
      if (binding.productId !== productId)
        throw new StudioError("INVALID_REQUEST");
      execute = async (service, database) => ({
        ok: true,
        value: await checkVersionResolution(
          await service.resolveVersion(
            database,
            credentials.sessionToken,
            binding,
          ),
          binding,
        ),
      });
    } else if (endpoint.action === "list") {
      execute = async (service, database) => {
        const value = internalVersionListResponseSchema.parse({
          ok: true,
          value: await service.readVersions(
            database,
            credentials.sessionToken,
            productId,
          ),
        });
        if (value.value.productId !== productId)
          throw new StudioError("STUDIO_UNAVAILABLE");
        return value;
      };
    } else {
      const versionId = parse(
        sealInternalVersionBindingSchema.shape.reviewId,
        endpoint.versionId,
      );
      execute = async (service, database) => {
        const value = await verifyInternalVersionDetail(
          internalVersionDetailResponseSchema.parse({
            ok: true,
            value: await service.readVersion(
              database,
              credentials.sessionToken,
              productId,
              versionId,
            ),
          }).value,
        );
        if (
          value.version.id !== versionId ||
          value.version.binding.productId !== productId
        )
          throw new StudioError("STUDIO_UNAVAILABLE");
        return { ok: true, value };
      };
    }
    clock.checkpoint();
    db = await createDatabase(config, clock.budget);
    owner = createInternalVersionOwner(db, clock);
    clock.checkpoint();
    const service = factory(owner);
    entered = true;
    const value = await execute(service, db);
    clock.checkpoint();
    const response = internalJsonResponse(
      value,
      status,
      endpoint.action === "list" ? L.listResponseBytes : L.responseBytes,
    );
    await owner.closeIfNotTransferred();
    clock.checkpoint();
    return response;
  } catch (error) {
    return failure(
      write &&
        entered &&
        (successful ||
          !(error instanceof StudioError) ||
          !internalVersionErrorCodeSchema.safeParse(error.code).success)
        ? new StudioError("WRITE_OUTCOME_UNKNOWN")
        : error,
      requestId,
      write,
    );
  } finally {
    try {
      if (owner) await owner.closeIfNotTransferred();
      else {
        try {
          await db?.close();
        } finally {
          clock.dispose();
        }
      }
    } catch {
      /* Cleanup cannot establish rollback or change a returned proof. */
    }
  }
}
