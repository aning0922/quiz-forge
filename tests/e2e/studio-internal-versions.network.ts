import { request as httpRequest } from "node:http";
import type { Page, Route } from "@playwright/test";

const unavailable = () => Error("INTERNAL_VERSION_E2E_NETWORK_UNAVAILABLE");
const maximum = 262144;
// Isolated synthetic probes never load runtime config or contact the managed3100 server.
const probe =
  process.env.QF_INTERNAL_NETWORK_SENTINEL === "synthetic-only" &&
  !process.env.QUIZFORGE_P2A_CONFIG;
const allowedOrigin = () =>
  probe
    ? process.env.QF_INTERNAL_NETWORK_PROBE_ORIGIN
    : "http://127.0.0.1:3100";
const deadline = probe ? 200 : 20000;
const probeFacts = { attempts: 0, completed: 0, failures: 0, timedOut: 0 };
export function internalNetworkProbeFacts() {
  if (!probe) throw unavailable();
  return { ...probeFacts };
}
function localUrl(value: string) {
  const url = new URL(value);
  if (
    url.origin !== allowedOrigin() ||
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !url.pathname.startsWith("/api/studio/")
  )
    throw unavailable();
  return url;
}
function expectedPath(url: URL, method: string) {
  if (probe && url.pathname === "/api/studio/probe/failure") return;
  if (method === "GET" && url.pathname === "/api/studio/auth/session") return;
  const base = "/api/studio/products/internal-version-fixture",
    path = url.pathname.slice(base.length);
  if (!url.pathname.startsWith(base)) throw unavailable();
  if (path === "/internal-versions" && ["GET", "POST"].includes(method)) return;
  if (method === "GET" && /^\/internal-versions\/[a-f0-9-]{36}$/.test(path))
    return;
  if (
    ["GET", "POST"].includes(method) &&
    /^\/drafts\/[a-f0-9-]{36}\/revisions\/(?:[1-9]|[1-9][0-9]|100)\/internal-review$/.test(
      path,
    )
  )
    return;
  if (
    method === "POST" &&
    (/^\/internal-(?:review|version)-applications\/resolve$/.test(path) ||
      /^\/imports\/[a-f0-9-]{36}\/validations\/[a-f0-9-]{36}\/draft-revisions$/.test(
        path,
      ))
  )
    return;
  throw unavailable();
}
/** Response only: never retain request headers or a transport exception in a returned object. */
export class InternalNetworkResponse {
  constructor(
    private readonly code: number,
    private readonly body: Buffer,
    private readonly fields: Record<string, string>,
  ) {}
  status() {
    return this.code;
  }
  ok() {
    return this.code >= 200 && this.code < 300;
  }
  headers() {
    return { ...this.fields };
  }
  async json(): Promise<unknown> {
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(this.body),
      );
    } catch {
      throw unavailable();
    }
  }
  bytes() {
    return Buffer.from(this.body);
  }
}
/** Native HTTP has no Playwright APIRequest fetchLog/HTML step containing Cookie or CSRF.
 * All failures are rebuilt without cause/headers/URL; only loopback Studio API paths are allowed.
 */
async function controlledRequest(
  url: URL,
  method: string,
  fields: Record<string, string>,
  body?: Buffer,
) {
  try {
    expectedPath(url, method);
    const headers: Record<string, string> = {
      ...fields,
      "accept-encoding": "identity",
    };
    for (const name of ["connection", "transfer-encoding", "content-length"])
      delete headers[name];
    if (!["GET", "POST"].includes(method) || (body && body.length > 4096))
      throw unavailable();
    return await new Promise<InternalNetworkResponse>((resolve, reject) => {
      const signal = AbortSignal.timeout(deadline);
      if (probe) probeFacts.attempts++;
      const req = httpRequest(
        url,
        { method, headers, signal, agent: false },
        (response) => {
          if (
            (response.statusCode ?? 503) >= 300 &&
            (response.statusCode ?? 503) < 400
          ) {
            response.destroy();
            req.destroy();
            reject(unavailable());
            return;
          }
          const cap =
            (response.statusCode ?? 503) >= 400
              ? 4096
              : method === "GET" && url.pathname.endsWith("/internal-versions")
                ? maximum
                : 65536;
          const parts: Buffer[] = [];
          let size = 0;
          response.on("data", (part: Buffer) => {
            size += part.length;
            if (size > cap) {
              response.destroy();
              req.destroy();
              reject(unavailable());
            } else parts.push(part);
          });
          response.on("error", () => reject(unavailable()));
          response.on("aborted", () => reject(unavailable()));
          response.on("end", () => {
            if (probe) probeFacts.completed++;
            const safe: Record<string, string> = {};
            for (const name of [
              "content-type",
              "cache-control",
              "pragma",
              "x-content-type-options",
              "referrer-policy",
              "retry-after",
            ])
              if (typeof response.headers[name] === "string")
                safe[name] = response.headers[name];
            resolve(
              new InternalNetworkResponse(
                response.statusCode ?? 503,
                Buffer.concat(parts),
                safe,
              ),
            );
          });
        },
      );
      req.on("error", () => {
        if (probe) {
          probeFacts.failures++;
          if (signal.aborted) probeFacts.timedOut++;
        }
        reject(unavailable());
      });
      req.end(body);
    });
  } catch {
    throw unavailable();
  }
}
async function sessionFields(page: Page) {
  // This PW call has no credential arguments and no APIRequest transport/fetchLog.
  const cookies = await page.context().cookies(page.url());
  return {
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    origin: new URL(page.url()).origin,
  };
}
export async function internalGet(page: Page, input: string) {
  try {
    if (!input.startsWith("/api/studio/") || input.startsWith("//"))
      throw unavailable();
    const url = localUrl(new URL(input, page.url()).href);
    if (url.pathname === "/api/studio/auth/session") throw unavailable();
    return await controlledRequest(url, "GET", await sessionFields(page));
  } catch {
    throw unavailable();
  }
}
export async function internalPost(page: Page, input: string, data: unknown) {
  try {
    if (!input.startsWith("/api/studio/") || input.startsWith("//"))
      throw unavailable();
    const fields = await sessionFields(page),
      url = localUrl(new URL(input, page.url()).href),
      session = await controlledRequest(
        localUrl(new URL("/api/studio/auth/session", url).href),
        "GET",
        fields,
      ),
      value = await session.json();
    if (
      !session.ok() ||
      !value ||
      typeof value !== "object" ||
      !("csrfToken" in value) ||
      typeof value.csrfToken !== "string" ||
      value.csrfToken.length > 256
    )
      throw unavailable();
    return await controlledRequest(
      url,
      "POST",
      {
        ...fields,
        "content-type": "application/json",
        "x-csrf-token": value.csrfToken,
      },
      Buffer.from(JSON.stringify(data)),
    );
  } catch {
    throw unavailable();
  }
}
/** Relay the actual intercepted browser request, including its original credentials and exact body.
 * allHeaders has no credential parameters/fetchLog; the native request never enters PW APIRequest.
 */
export async function internalRouteFetch(route: Route) {
  try {
    const request = route.request(),
      url = localUrl(request.url());
    if (url.pathname === "/api/studio/auth/session") throw unavailable();
    return await controlledRequest(
      url,
      request.method(),
      await request.allHeaders(),
      request.postDataBuffer() ?? undefined,
    );
  } catch {
    throw unavailable();
  }
}
export async function fulfillInternalResponse(
  route: Route,
  response: InternalNetworkResponse,
) {
  try {
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: response.bytes(),
    });
  } catch {
    throw unavailable();
  }
}
