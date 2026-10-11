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
import {
  createImportIntentSchema,
  recoverReceiveSchema,
  importIdSchema,
  idempotencyKeySchema,
} from "@/features/quizpack/import/contracts";
import {
  createReceiveContext,
  remainingReceiveMs,
} from "@/features/quizpack/import/context";
import type {
  ImportReceiveService,
  ReceiveSource,
} from "@/features/quizpack/import/service-contract";
import {
  assertArchiveHeaders,
  cancelWithinHttpBudget,
  createReceiveSource,
} from "./receive-source";
import { parseImportQuery } from "./query";

export type ImportEndpoint = {
  action: "settings" | "list" | "create" | "read" | "archive" | "recover";
  productId: string;
  importId?: string;
};
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new StudioError("INVALID_REQUEST");
  return result.data;
}

/** HTTP validation and dispatch only; the A-owned service is the authority. */
export async function handleImportHttp(
  request: Request,
  endpoint: ImportEndpoint,
  service: ImportReceiveService,
  startedAt = performance.now(),
): Promise<Response> {
  const budget =
    endpoint.action === "archive" || endpoint.action === "recover"
      ? createReceiveContext(request.signal, startedAt)
      : undefined;
  const requestId = randomUUID();
  let db: P2aDatabase | undefined;
  let source: ReceiveSource | undefined;
  const write =
    endpoint.action === "create" ||
    endpoint.action === "archive" ||
    endpoint.action === "recover";
  try {
    // Even an early Host/auth/header rejection owns and cancels the raw reader.
    if (endpoint.action === "archive" && request.body)
      source = createReceiveSource(request.body.getReader());
    const checkBudget = () => {
      if (budget) remainingReceiveMs(budget.context);
    };
    checkBudget();
    const config = await loadRuntimeConfig();
    checkBudget();
    assertStudioSource(request.headers, config, { write, api: true });
    const productId = parse(productIdSchema, endpoint.productId);
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
    if (endpoint.action === "settings")
      execute = (database) =>
        service.readImportSettings(
          database,
          credentials.sessionToken,
          productId,
        );
    else if (endpoint.action === "list") {
      let query;
      try {
        query = parseImportQuery(params);
      } catch {
        throw new StudioError("INVALID_REQUEST");
      }
      execute = (database) =>
        service.listImports(
          database,
          credentials.sessionToken,
          productId,
          query,
        );
    } else if (endpoint.action === "create") {
      const key = parse(
        idempotencyKeySchema,
        request.headers.get("idempotency-key"),
      );
      const input = parse(
        createImportIntentSchema,
        await readStudioJson(request),
      );
      execute = async (database) => {
        const result = await service.createIntent(
          database,
          credentials,
          productId,
          key,
          input,
        );
        status = result.created ? 201 : 200;
        return result.import;
      };
    } else {
      const id = parse(importIdSchema, endpoint.importId);
      if (endpoint.action === "read")
        execute = (database) =>
          service.readImport(database, credentials.sessionToken, productId, id);
      else if (endpoint.action === "archive") {
        assertArchiveHeaders(request.headers);
        if (!source) throw new StudioError("INVALID_REQUEST");
        const inputSource = source;
        execute = (database) =>
          service.receiveArchive(
            database,
            credentials,
            productId,
            id,
            inputSource,
            budget!.context,
          );
      } else {
        const input = parse(
          recoverReceiveSchema,
          await readStudioJson(request),
        );
        checkBudget();
        execute = (database) =>
          service.recoverReceive(
            database,
            credentials,
            productId,
            id,
            input,
            budget!.context,
          );
      }
    }
    checkBudget();
    db = await createDatabase(config);
    checkBudget();
    const result = await execute(db);
    // An acknowledged committed result stays authoritative even after deadline.
    return Response.json(result, { status, headers: privateHeaders });
  } catch (error) {
    return errorResponse(error, requestId);
  } finally {
    budget?.dispose();
    if (source) await cancelWithinHttpBudget(source.cancel);
    await db?.close().catch(() => undefined);
  }
}
