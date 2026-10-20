import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { assertStudioSource } from "@/lib/http-security/source";
import { emptyDto, loginDto, readStudioJson } from "@/lib/http-security/json";
import {
  errorResponse,
  privateHeaders,
  StudioError,
} from "@/lib/http-security/errors";
import { verifyCsrf } from "@/lib/security/p2a-tokens";
import {
  createPreauth,
  login,
  logout,
  readSession,
  sessionDto,
} from "./service";
import {
  cookieOptions,
  cookieToken,
  PREAUTH_COOKIE,
  SESSION_COOKIE,
} from "./cookies";

export type StudioAuthEndpoint = "preauth" | "login" | "session" | "logout";

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
    let credential = "";
    if (endpoint !== "session") {
      const body = await readStudioJson(request);
      if (endpoint === "login") credential = loginDto(body).credential;
      else emptyDto(body);
    }
    const sessionRaw = cookieToken(request.headers, "session");
    const preauthRaw =
      endpoint === "login" ? cookieToken(request.headers, "preauth") : null;
    const csrf = request.headers.get("x-csrf-token");
    if (endpoint === "login" || endpoint === "logout") {
      const raw = endpoint === "login" ? preauthRaw : sessionRaw;
      if (!raw)
        throw new StudioError(
          endpoint === "login" ? "AUTHENTICATION_FAILED" : "UNAUTHENTICATED",
        );
      if (
        !csrf ||
        !verifyCsrf(raw, endpoint === "login" ? "preauth" : "session", csrf)
      )
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
      case "login": {
        const authenticated = await login(
          database,
          preauthRaw,
          csrf,
          credential,
          requestId,
        );
        const response = NextResponse.json(authenticated.dto, {
          headers: privateHeaders,
        });
        response.cookies.set(SESSION_COOKIE, authenticated.raw, {
          ...cookieOptions,
          maxAge: 28800,
        });
        response.cookies.set(PREAUTH_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
          expires: new Date(0),
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
