import "server-only";
import { StudioError } from "./errors";

export type LocalStudioProfile = {
  profile: "local-http-p2a";
  origin: string;
};

export function configuredHost(config: LocalStudioProfile): string {
  let parsed: URL;
  try {
    parsed = new URL(config.origin);
  } catch {
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
  if (
    config.profile !== "local-http-p2a" ||
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.origin !== config.origin ||
    parsed.username ||
    parsed.password
  ) {
    throw new StudioError("STUDIO_UNAVAILABLE");
  }
  return parsed.host;
}

export function assertStudioSource(
  headers: Headers,
  config: LocalStudioProfile,
  options: { write: boolean; api: boolean },
): void {
  if (headers.get("host") !== configuredHost(config)) {
    throw new StudioError("ORIGIN_REJECTED");
  }
  if (options.write && headers.get("origin") !== config.origin) {
    throw new StudioError("ORIGIN_REJECTED");
  }
  const site = headers.get("sec-fetch-site");
  if (options.api && site !== null && site !== "same-origin") {
    throw new StudioError("ORIGIN_REJECTED");
  }
}
