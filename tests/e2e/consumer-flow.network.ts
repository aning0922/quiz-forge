import { request as httpRequest } from "node:http";
import type { Page, Route } from "@playwright/test";
import { CONSUMER_LIMITS_V1 as L } from "../../src/lib/consumer-contract/v1/limits";
import {
  CONSUMER_COOKIE_NAME_V1,
  consumerCsrfForGrant,
} from "../../src/lib/consumer-contract/v1/credentials";
import { CONSUMER_CSRF_HEADER_V1 } from "../../src/features/fulfillment/consumer-flow/http-protocol";
import { consumerResourceSelectorSchema } from "../../src/features/fulfillment/consumer-flow/display-contract";

const unavailable = () => Error("CONSUMER_E2E_NETWORK_UNAVAILABLE");
const origin = "http://127.0.0.1:3100";
const uuid =
  "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
const studio = "/api/studio/products/consumer-flow-fixture";
function allowed(input: string, method: string): { url: URL; maximum: number } {
  if (/[\x00-\x20\x7f\\#]/.test(input)) throw unavailable();
  const url = new URL(input, origin);
  if (
    url.origin !== origin ||
    url.username ||
    url.password ||
    !["GET", "POST"].includes(method)
  )
    throw unavailable();
  const path = url.pathname;
  if (
    method === "GET" &&
    new RegExp(`^/play/${uuid}/api/resources$`).test(path)
  ) {
    if (
      [...url.searchParams.keys()].length !== 3 ||
      ["resourceId", "resourceVersion", "sha256"].some(
        (k) => url.searchParams.getAll(k).length !== 1,
      )
    )
      throw unavailable();
    if (
      !consumerResourceSelectorSchema.safeParse(
        Object.fromEntries(url.searchParams),
      ).success
    )
      throw unavailable();
    return { url, maximum: L.imageBytes };
  }
  if (url.search) throw unavailable();
  if (path === "/api/studio/auth/session" && method === "GET")
    return { url, maximum: 8192 };
  if (path.startsWith(studio)) {
    const suffix = path.slice(studio.length);
    if (
      method === "GET" &&
      ["/play-versions", "/internal-versions", "/access-keys"].includes(suffix)
    )
      return { url, maximum: L.playListResponseBytes };
    if (method === "GET" && new RegExp(`^/play-versions/${uuid}$`).test(suffix))
      return { url, maximum: L.playSnapshotBytes + L.operationReceiptBytes };
    if (method === "GET" && new RegExp(`^/access-keys/${uuid}$`).test(suffix))
      return { url, maximum: L.operationReceiptBytes };
    if (
      method === "POST" &&
      ([
        "/play-versions",
        "/access-keys",
        "/play-version-applications/resolve",
        "/access-key-applications/resolve",
        "/access-key-void-applications/resolve",
      ].includes(suffix) ||
        new RegExp(`^/access-keys/${uuid}/void$`).test(suffix))
    )
      return { url, maximum: L.operationReceiptBytes };
  }
  if (
    method === "GET" &&
    new RegExp(`^/play/${uuid}/api/(session|entry|report)$`).test(path)
  )
    return { url, maximum: L.entryResponseBytes };
  if (
    method === "POST" &&
    new RegExp(
      `^/play/${uuid}/api/(save|complete)(/resolve)?$|^/play/${uuid}/api/logout$`,
    ).test(path)
  )
    return { url, maximum: L.stateResponseBytes };
  // Exchange must use the real browser UI, so no native helper accepts a raw Key.
  throw unavailable();
}

/** Response only. Never retain credentials, request data or a transport exception. */
export class ConsumerNetworkResponse {
  constructor(
    private readonly code: number,
    private readonly body: Buffer,
    private readonly fields: Record<string, string>,
  ) {}
  status() {
    return this.code;
  }
  headers() {
    return { ...this.fields };
  }
  bytes() {
    return Buffer.from(this.body);
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
}

/** Native HTTP avoids Playwright APIRequest fetchLog and credential-bearing failure output. */
async function controlled(
  input: string,
  method: string,
  fields: Record<string, string>,
  body?: Buffer,
) {
  try {
    const { url, maximum } = allowed(input, method);
    if (body && body.length > L.saveRequestBytes) throw unavailable();
    const headers = { ...fields, "accept-encoding": "identity" };
    for (const name of ["connection", "transfer-encoding", "content-length"])
      delete (headers as Record<string, string>)[name];
    return await new Promise<ConsumerNetworkResponse>((resolve, reject) => {
      const req = httpRequest(
        url,
        { method, headers, agent: false, signal: AbortSignal.timeout(20_000) },
        (response) => {
          const code = response.statusCode ?? 503;
          if (
            (code >= 300 && code < 400) ||
            (response.headers["content-encoding"] &&
              response.headers["content-encoding"] !== "identity")
          ) {
            response.destroy();
            req.destroy();
            reject(unavailable());
            return;
          }
          const cap = code >= 400 ? L.errorResponseBytes : maximum,
            parts: Buffer[] = [];
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
            const safe: Record<string, string> = {};
            for (const name of [
              "content-type",
              "cache-control",
              "pragma",
              "x-content-type-options",
              "referrer-policy",
              "retry-after",
              "access-control-allow-origin",
            ])
              if (typeof response.headers[name] === "string")
                safe[name] = response.headers[name];
            resolve(
              new ConsumerNetworkResponse(code, Buffer.concat(parts), safe),
            );
          });
        },
      );
      req.on("error", () => reject(unavailable()));
      req.end(body);
    });
  } catch {
    throw unavailable();
  }
}
async function fields(page: Page, input: string) {
  if (new URL(page.url()).origin !== origin) throw unavailable();
  const url = new URL(input, origin);
  if (url.origin !== origin) throw unavailable();
  const cookies = await page.context().cookies(url.href);
  return {
    cookies,
    headers: {
      cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      origin,
      "sec-fetch-site": "same-origin",
    },
  };
}
export async function consumerGet(
  page: Page,
  input: string,
  overrides: Record<string, string> = {},
) {
  try {
    return await controlled(input, "GET", {
      ...(await fields(page, input)).headers,
      ...overrides,
    });
  } catch {
    throw unavailable();
  }
}
/** Cross-session probe keeps the valid source grant inside native Node HTTP, never in PW arguments. */
export async function consumerCrossSessionGet(
  page: Page,
  input: string,
  sourceSessionId: string,
) {
  try {
    if (!new RegExp(`^${uuid}$`).test(sourceSessionId)) throw unavailable();
    const source = `/play/${sourceSessionId}/api/session`;
    return await controlled(input, "GET", (await fields(page, source)).headers);
  } catch {
    throw unavailable();
  }
}
export async function consumerPost(
  page: Page,
  input: string,
  data: unknown,
  overrides: Record<string, string> = {},
) {
  try {
    const f = await fields(page, input),
      headers: Record<string, string> = {
        ...f.headers,
        "content-type": "application/json",
      };
    if (input.startsWith(studio + "/")) {
      const session = await controlled(
          "/api/studio/auth/session",
          "GET",
          f.headers,
        ),
        value = await session.json();
      if (
        session.status() !== 200 ||
        !value ||
        typeof value !== "object" ||
        !("csrfToken" in value) ||
        typeof value.csrfToken !== "string" ||
        value.csrfToken.length !== 43
      )
        throw unavailable();
      headers["x-csrf-token"] = value.csrfToken;
    } else {
      const token = f.cookies.find(
        (c) => c.name === CONSUMER_COOKIE_NAME_V1 && input.startsWith(c.path),
      )?.value;
      const csrf = await consumerCsrfForGrant(token);
      if (csrf) headers[CONSUMER_CSRF_HEADER_V1] = csrf;
    }
    return await controlled(
      input,
      "POST",
      { ...headers, ...overrides },
      Buffer.from(JSON.stringify(data)),
    );
  } catch {
    throw unavailable();
  }
}
/** Chromium interception can precede generated Fetch Metadata. Supply only a
 * missing site value after proving the trusted main document's real origin;
 * destination, credentials and explicit header values are never repaired. */
export async function consumerRouteFetch(route: Route, trustedPage: Page) {
  try {
    const request = route.request();
    allowed(request.url(), request.method()); // Fixed destination/path allowlist.
    const frame = request.frame(),
      headers = await request.allHeaders();
    if (
      request.method() !== "POST" ||
      request.resourceType() !== "fetch" ||
      request.isNavigationRequest() ||
      frame !== trustedPage.mainFrame() ||
      frame.page() !== trustedPage ||
      new URL(trustedPage.url()).origin !== origin ||
      new URL(frame.url()).origin !== origin ||
      (await frame.evaluate(() => location.origin)) !== origin ||
      new URL(trustedPage.url()).origin !== origin ||
      new URL(frame.url()).origin !== origin
    )
      throw unavailable();
    if (
      headers.origin !== origin ||
      (headers.host !== undefined && headers.host !== new URL(origin).host) ||
      (headers["sec-fetch-site"] !== undefined &&
        headers["sec-fetch-site"] !== "same-origin")
    )
      throw unavailable();
    if (headers["sec-fetch-site"] === undefined)
      headers["sec-fetch-site"] = "same-origin";
    return await controlled(
      request.url(),
      request.method(),
      headers,
      request.postDataBuffer() ?? undefined,
    );
  } catch {
    throw unavailable();
  }
}
export async function fulfillConsumerResponse(
  route: Route,
  response: ConsumerNetworkResponse,
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
