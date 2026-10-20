import "server-only";
import { headers } from "next/headers";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { cookieToken } from "@/lib/auth/cookies";
import { readSession, sessionDto } from "@/lib/auth/service";
import { StudioError } from "@/lib/http-security/errors";
import { assertStudioSource } from "@/lib/http-security/source";
import type { StudioSessionDto } from "./contracts";

export type StudioPageState =
  | { status: "unavailable" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; session: StudioSessionDto };

/** RSC reads real DB authority, never writes cookies and never exposes config. */
export async function studioPageState(): Promise<StudioPageState> {
  let database: P2aDatabase | undefined;
  try {
    const config = await loadRuntimeConfig();
    const incoming = new Headers(await headers());
    assertStudioSource(incoming, config, { write: false, api: false });
    database = await createDatabase(config);
    const raw = cookieToken(incoming, "session");
    const actor = await readSession(database, raw);
    return { status: "authenticated", session: sessionDto(actor, raw!) };
  } catch (error) {
    return error instanceof StudioError && error.code === "UNAUTHENTICATED"
      ? { status: "unauthenticated" }
      : { status: "unavailable" };
  } finally {
    await database?.close().catch(() => undefined);
  }
}
