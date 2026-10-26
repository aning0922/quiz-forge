import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { assertStudioSource } from "@/lib/http-security/source";
import { readStudioJson } from "@/lib/http-security/json";
import {
  StudioError,
  errorResponse,
  privateHeaders,
} from "@/lib/http-security/errors";
import {
  cookieToken,
  cookieOptions,
  SESSION_COOKIE,
  PREAUTH_COOKIE,
} from "../cookies";
import * as service from "./service";
import * as input from "./input";
export type AccountEndpoint =
  | "password-login"
  | "setup-inspect"
  | "setup"
  | "setup-result"
  | "me"
  | "password"
  | "logout-all"
  | "list"
  | "create"
  | "change"
  | "token"
  | "revoke"
  | "result"
  | "audit";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new StudioError("INVALID_REQUEST");
  return r.data;
}
export async function handleAccounts(
  request: Request,
  endpoint: AccountEndpoint,
  id?: string,
): Promise<Response> {
  const requestId = randomUUID();
  let db: P2aDatabase | undefined;
  try {
    const config = await loadRuntimeConfig();
    const write = request.method !== "GET";
    assertStudioSource(request.headers, config, { write, api: true });
    const body = write ? await readStudioJson(request) : undefined;
    const c = {
      sessionToken: cookieToken(request.headers, "session"),
      csrfToken: request.headers.get("x-csrf-token"),
      requestId,
    };
    let value: unknown;
    let clear = false;
    db = await createDatabase(config);
    switch (endpoint) {
      case "password-login": {
        const v = parse(input.passwordLoginInput, body);
        const logged = await service.passwordLogin(
          db,
          cookieToken(request.headers, "preauth"),
          c.csrfToken,
          v.loginName,
          v.password,
        );
        const r = NextResponse.json(logged.dto, { headers: privateHeaders });
        r.cookies.set(SESSION_COOKIE, logged.raw, {
          ...cookieOptions,
          maxAge: 28800,
        });
        r.cookies.set(PREAUTH_COOKIE, "", {
          ...cookieOptions,
          maxAge: 0,
          expires: new Date(0),
        });
        return r;
      }
      case "setup-inspect":
      case "setup":
      case "setup-result": {
        const v = parse(
          endpoint === "setup"
            ? input.setupInput
            : endpoint === "setup-result"
              ? input.setupResultInput
              : input.setupInspectInput,
          body,
        ) as { token: string; operationId?: string; password?: string };
        const digest = await service.requirePasswordTokenCsrf(
          v.token,
          c.csrfToken,
        );
        value =
          endpoint === "setup-inspect"
            ? await service.inspectPasswordSetup(db, digest)
            : endpoint === "setup-result"
              ? await service.setupResult(db, digest, v.operationId!)
              : await service.completePasswordSetup(
                  db,
                  digest,
                  v.operationId!,
                  v.password!,
                );
        break;
      }
      case "me":
        value = await service.readAccount(db, c.sessionToken);
        break;
      case "list":
      case "audit": {
        const entries = [...new URL(request.url).searchParams];
        if (new Set(entries.map(([k]) => k)).size !== entries.length)
          throw new StudioError("INVALID_REQUEST");
        const q = Object.fromEntries(entries);
        value =
          endpoint === "list"
            ? await service.listAccounts(
                db,
                c.sessionToken,
                parse(input.listInput, q),
              )
            : await service.readAccountAudit(
                db,
                c.sessionToken,
                parse(input.auditInput, q),
              );
        break;
      }
      case "result":
        value = await service.accountResult(
          db,
          c.sessionToken,
          parse(z.uuid(), id),
        );
        break;
      case "password": {
        const v = parse(input.passwordChangeInput, body);
        value = await service.changeOwnPassword(
          db,
          c,
          v.operationId,
          v.currentPassword,
          v.newPassword,
        );
        clear = true;
        break;
      }
      default: {
        let p: Record<string, unknown>;
        if (endpoint === "create")
          p = { ...parse(input.createAccountInput, body), action: "create" };
        else if (endpoint === "logout-all")
          p = {
            ...parse(input.operationInput, body),
            action: "logout-all",
            targetId: (await service.readAccount(db, c.sessionToken)).id,
          };
        else {
          const targetId = parse(z.uuid(), id);
          if (endpoint === "change")
            p = { ...parse(input.changeAccountInput, body), targetId };
          else if (endpoint === "token") {
            const v = parse(input.tokenInput, body);
            p = {
              operationId: v.operationId,
              expectedRevision: v.expectedRevision,
              targetId,
              action: v.purpose === "setup" ? "issue-setup" : "issue-reset",
            };
          } else
            p = {
              ...parse(input.revokeInput, body),
              targetId,
              action: "revoke-sessions",
            };
        }
        const r = await service.mutateAccount(db, c, p);
        value = endpoint === "logout-all" ? r.operation : r;
        clear =
          endpoint === "logout-all" ||
          (r.account.id === r.operation.actorId &&
            ["disable", "role", "revoke-sessions"].includes(
              r.operation.action,
            ));
        break;
      }
    }
    const response = NextResponse.json(value, {
      headers: { ...privateHeaders, "Referrer-Policy": "no-referrer" },
    });
    if (clear)
      response.cookies.set(SESSION_COOKIE, "", {
        ...cookieOptions,
        maxAge: 0,
        expires: new Date(0),
      });
    return response;
  } catch (e) {
    return errorResponse(e, requestId);
  } finally {
    await db?.close().catch(() => undefined);
  }
}
