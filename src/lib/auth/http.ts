import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { assertStudioSource } from "@/lib/http-security/source";
import { emptyDto, readStudioJson } from "@/lib/http-security/json";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import { createPreauth, logout, readSession, sessionDto } from "./service";
import {
  cookieOptions,
  cookieToken,
  PREAUTH_COOKIE,
  SESSION_COOKIE,
} from "./cookies";

export type StudioAuthEndpoint = "preauth" | "session" | "logout";

/** HTTP boundary: only these Handlers set/delete cookies, after DB commit. */
export async function handleStudioAuth(
  request: Request,
  endpoint: StudioAuthEndpoint,
): Promise<Response> {
  const requestId = randomUUID();
  let database: P2aDatabase | undefined;
  try {
    const config = await loadRuntimeConfig();
    assertStudioSource(request.headers, config, {
      write: endpoint !== "session",
      api: true,
    });
    if (endpoint !== "session") emptyDto(await readStudioJson(request));
    const sessionRaw = cookieToken(request.headers, "session");
    const csrf = request.headers.get("x-csrf-token");
    if (endpoint === "logout") {
      if (!sessionRaw) throw new StudioError("UNAUTHENTICATED");
      if (!csrf || !verifyCsrf(sessionRaw, "session", csrf))
        throw new StudioError("CSRF_REJECTED");
    }
    database = await createDatabase(config);
    switch (endpoint) {
      case "preauth": {
        const created = await createPreauth(database, sessionRaw, requestId);
        const response = NextResponse.json(created.dto, {
          status: 201,
          headers: privateHeaders,
        });
        response.cookies.set(PREAUTH_COOKIE, created.raw, {
          ...cookieOptions,
          maxAge: 300,
        });
        return response;
      }
      case "session": {
        const actor = await readSession(database, sessionRaw);
        return NextResponse.json(sessionDto(actor, sessionRaw!), {
          headers: privateHeaders,
        });
      }
      case "logout": {
        await logout(database, sessionRaw, csrf, requestId);
        const response = new NextResponse(null, {
          status: 204,
          headers: privateHeaders,
        });
        response.cookies.set(SESSION_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
          expires: new Date(0),
        });
        response.cookies.set(PREAUTH_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
          expires: new Date(0),
        });
        return response;
      }
    }
    throw new StudioError("STUDIO_UNAVAILABLE");
  } catch (error) {
    return errorResponse(error, requestId);
  } finally {
    await database?.close().catch(() => undefined);
  }
}
