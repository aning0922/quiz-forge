import "server-only";
import { randomUUID } from "node:crypto";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import { assertStudioSource } from "@/lib/http-security/source";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import {
  authorizedPreviewRead,
  reauthorizePreview,
} from "@/features/product/preview/auth";
import { resolveFixedPreviewResource } from "@/features/product/preview/repository";
import { samePreviewBinding } from "@/features/product/preview/contracts";
import { previewEndpointScope } from "@/features/product/preview/http";
import { parsePreviewResourceQuery } from "@/features/product/preview/urls";
import { StorageReadGuard } from "./guard";
import { ResourceReadTask } from "./task";
import { readPrivateResource } from "./storage";
export async function handlePreviewResourceHttp(
  request: Request,
  endpoint: { productId: string; draftId: string; revision: string },
  startedAt = performance.now(),
): Promise<Response> {
  const observationId = randomUUID();
  try {
    // No config/DB allocation or IO is permitted before zero-queue admission.
    if (request.method !== "GET" || request.headers.has("range"))
      throw new StudioError("INVALID_REQUEST");
    const scope = previewEndpointScope(endpoint);
    let input: ReturnType<typeof parsePreviewResourceQuery>;
    try {
      input = parsePreviewResourceQuery(new URL(request.url));
    } catch {
      throw new StudioError("INVALID_REQUEST");
    }
    const task = ResourceReadTask.acquire(request.signal, startedAt);
    return await task.run(async () => {
      let db: P2aDatabase | undefined, guard: StorageReadGuard | undefined;
      let lockLost: (() => void) | undefined;
      try {
        task.checkpoint();
        const config = await loadRuntimeConfig();
        task.checkpoint();
        assertStudioSource(request.headers, config, {
          write: false,
          api: true,
        });
        const credentials = {
          sessionToken: cookieToken(request.headers, "session"),
        };
        if (!credentials.sessionToken) throw new StudioError("UNAUTHENTICATED");
        db = await createDatabase(config, {
          signal: task.signal,
          deadlineMonotonicMs: task.deadlineMonotonicMs,
        });
        task.checkpoint();
        await reauthorizePreview(db, credentials);
        task.checkpoint();
        // This pool is NOT attached to request cancellation: its lifetime follows real filesystem settlement.
        guard = await StorageReadGuard.acquire(
          config,
          () => task.checkpoint(),
          task.deadlineMonotonicMs,
        );
        lockLost = () =>
          task.stop(new StudioError("PREVIEW_RESOURCE_UNAVAILABLE"));
        guard.signal.addEventListener("abort", lockLost, { once: true });
        task.checkpoint();
        guard.assert();
        const fixed = await authorizedPreviewRead(db, credentials, (tx) =>
          resolveFixedPreviewResource(tx, scope, input.resourceRef),
        );
        if (!samePreviewBinding(fixed.binding, input.binding))
          throw new StudioError("PREVIEW_BINDING_MISMATCH");
        task.checkpoint();
        await guard.check();
        const held = guard;
        const bytes = await readPrivateResource(
          config,
          fixed.resource,
          () => {
            task.checkpoint();
            held.assert();
          },
          () => task.stop(new StudioError("PREVIEW_TIMEOUT")),
          (handle) => {
            task.quarantine(handle);
            task.quarantine(held);
          },
        );
        task.checkpoint();
        await guard.check();
        await reauthorizePreview(db, credentials);
        task.checkpoint();
        const closingDb = db;
        db = undefined;
        await closingDb.close();
        task.checkpoint();
        guard.signal.removeEventListener("abort", lockLost);
        lockLost = undefined;
        const closingGuard = guard;
        guard = undefined;
        await closingGuard.close();
        task.checkpoint();
        return new Response(task.body(bytes), {
          status: 200,
          headers: {
            ...privateHeaders,
            "Cache-Control": "private, no-store, max-age=0",
            "Content-Type": fixed.resource.mediaType,
            "Content-Length": String(fixed.resource.bytes),
          },
        });
      } finally {
        // This runs only after actual open/read/stat/close has settled. A racing HTTP timeout does not enter early.
        if (guard && lockLost)
          guard.signal.removeEventListener("abort", lockLost);
        try {
          await db?.close();
        } finally {
          if (!task.hasUnconfirmedIo) await guard?.close();
        }
      }
    });
  } catch (error) {
    const response = errorResponse(error, observationId);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  }
}
