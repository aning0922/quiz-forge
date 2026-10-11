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
import {
  MAX_PRODUCT_TAGS,
  parseWorkspaceQuery,
  productIdSchema,
  taxonomyIdSchema,
  productCreateSchema,
  productReplaceMetadataSchema,
  productLifecycleSchema,
  taxonomyCreateSchema,
  taxonomyRenameSchema,
  taxonomyLifecycleSchema,
  type TaxonomyKind,
} from "@/features/product/workspace/contracts";
import type { WorkspaceService } from "@/features/product/workspace/service-contract";

export type WorkspaceEndpoint =
  | {
      domain: "product";
      action: "list" | "read" | "create" | "replace" | "archive" | "restore";
      id?: string;
    }
  | {
      domain: TaxonomyKind;
      action: "list" | "create" | "rename" | "archive" | "restore";
      id?: string;
    };

function checkProductTagLimit(input: unknown): void {
  if (
    input &&
    typeof input === "object" &&
    "tagIds" in input &&
    Array.isArray(input.tagIds) &&
    input.tagIds.length > MAX_PRODUCT_TAGS
  )
    throw new StudioError("TAG_LIMIT_EXCEEDED");
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StudioError("INVALID_REQUEST");
  return parsed.data;
}

/** Only HTTP validation and service dispatch. The actual service owns read/write authority. */
export async function handleWorkspaceHttp(
  request: Request,
  endpoint: WorkspaceEndpoint,
  service: WorkspaceService,
): Promise<Response> {
  const requestId = randomUUID();
  let database: P2aDatabase | undefined;
  const write = endpoint.action !== "list" && endpoint.action !== "read";
  try {
    const config = await loadRuntimeConfig();
    assertStudioSource(request.headers, config, { write, api: true });
    const params = new URL(request.url).searchParams;
    if (endpoint.action !== "list" && params.size)
      throw new StudioError("INVALID_REQUEST");
    const body = write ? await readStudioJson(request) : undefined;
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
    let execute: (db: P2aDatabase) => Promise<unknown>;
    if (endpoint.domain === "product") {
      if (endpoint.action === "list") {
        let query;
        try {
          query = parseWorkspaceQuery(params, "product");
        } catch {
          throw new StudioError("INVALID_REQUEST");
        }
        execute = (db) =>
          service.listProducts(db, credentials.sessionToken, query);
      } else if (endpoint.action === "create") {
        checkProductTagLimit(body);
        const input = parse(productCreateSchema, body);
        execute = (db) => service.createProduct(db, credentials, input);
      } else {
        const id = parse(productIdSchema, endpoint.id);
        if (endpoint.action === "read")
          execute = (db) =>
            service.readProduct(db, credentials.sessionToken, id);
        else if (endpoint.action === "replace") {
          checkProductTagLimit(body);
          const input = parse(productReplaceMetadataSchema, body);
          execute = (db) =>
            service.replaceProductMetadata(db, credentials, id, input);
        } else {
          const input = parse(productLifecycleSchema, body);
          execute =
            endpoint.action === "archive"
              ? (db) => service.archiveProduct(db, credentials, id, input)
              : (db) => service.restoreProduct(db, credentials, id, input);
        }
      }
    } else {
      const kind = endpoint.domain;
      if (endpoint.action === "list") {
        let query;
        try {
          query = parseWorkspaceQuery(params, "taxonomy");
        } catch {
          throw new StudioError("INVALID_REQUEST");
        }
        execute = (db) =>
          service.listTaxonomy(db, credentials.sessionToken, kind, query);
      } else if (endpoint.action === "create") {
        const input = parse(taxonomyCreateSchema, body);
        execute = (db) => service.createTaxonomy(db, credentials, kind, input);
      } else {
        const id = parse(taxonomyIdSchema, endpoint.id);
        if (endpoint.action === "rename") {
          const input = parse(taxonomyRenameSchema, body);
          execute = (db) =>
            service.renameTaxonomy(db, credentials, kind, id, input);
        } else {
          const input = parse(taxonomyLifecycleSchema, body);
          execute =
            endpoint.action === "archive"
              ? (db) =>
                  service.archiveTaxonomy(db, credentials, kind, id, input)
              : (db) =>
                  service.restoreTaxonomy(db, credentials, kind, id, input);
        }
      }
    }
    database = await createDatabase(config);
    const result = await execute(database);
    return Response.json(result, {
      status: endpoint.action === "create" ? 201 : 200,
      headers: privateHeaders,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  } finally {
    await database?.close().catch(() => undefined);
  }
}
