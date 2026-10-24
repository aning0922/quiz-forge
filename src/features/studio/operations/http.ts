import "server-only";
import { randomUUID } from "node:crypto";
import { createObservedDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import { assertStudioSource } from "@/lib/http-security/source";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { runConsumerSqlPhase } from "@/features/fulfillment/consumer-flow/sql-owner";
import { parseOperationsQuery } from "./query";
import type { OperationsService } from "./service";
import {
  OPERATIONS_RESPONSE_BYTES,
  parseProductOperations,
  parseProductOperationsPage,
  parseOperationsDashboard,
} from "./response";

export type OperationsEndpoint =
  | { action: "list" }
  | { action: "detail"; productId: string }
  | { action: "dashboard" };
/** One existing SQL owner for the entire read, including fresh authorization and actual close. */
export async function handleOperationsHttp(
  request: Request,
  endpoint: OperationsEndpoint,
  service: OperationsService,
): Promise<Response> {
  const requestId = randomUUID(),
    clock = createStudioRequestBudget(request.signal);
  try {
    clock.checkpoint();
    const config = await loadRuntimeConfig();
    clock.checkpoint();
    assertStudioSource(request.headers, config, { write: false, api: true });
    if (request.method !== "GET") throw new StudioError("INVALID_REQUEST");
    const params = new URL(request.url).searchParams;
    if (endpoint.action !== "list" && params.size)
      throw new StudioError("INVALID_REQUEST");
    let query;
    try {
      if (endpoint.action === "list") query = parseOperationsQuery(params);
    } catch {
      throw new StudioError("INVALID_REQUEST");
    }
    const token = cookieToken(request.headers, "session");
    if (!token) throw new StudioError("UNAUTHENTICATED");
    const text = await runConsumerSqlPhase(
      config,
      clock.budget,
      createObservedDatabase,
      async (db, checkpoint) => {
        const value =
          endpoint.action === "list"
            ? await service.listProductOperations(db, token, query!)
            : endpoint.action === "detail"
              ? await service.readProductOperations(
                  db,
                  token,
                  endpoint.productId,
                )
              : await service.readOperationsDashboard(db, token);
        checkpoint();
        const checked =
          endpoint.action === "list"
            ? parseProductOperationsPage(value, query)
            : endpoint.action === "detail"
              ? parseProductOperations(value, endpoint.productId)
              : parseOperationsDashboard(value);
        const text = JSON.stringify(checked);
        if (
          Buffer.byteLength(text, "utf8") >
          OPERATIONS_RESPONSE_BYTES[endpoint.action]
        )
          throw new StudioError("STUDIO_UNAVAILABLE");
        return text;
      },
    );
    clock.checkpoint();
    return new Response(text, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    // Owner BUSY/TIMEOUT and unknown failures remain finite 503 errors, never empty observations.
    return errorResponse(error, requestId);
  } finally {
    clock.dispose();
  }
}
