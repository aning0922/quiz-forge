import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import {
  internalGet,
  internalPost,
  internalRouteFetch,
  fulfillInternalResponse,
  internalNetworkProbeFacts,
} from "../e2e/studio-internal-versions.network";

let server: Server, origin: string;
let cookieReceived = false,
  csrfReceived = false;
const mode = process.env.QF_INTERNAL_NETWORK_PROBE_MODE;
const cookie = process.env.QF_INTERNAL_COOKIE_SENTINEL,
  csrf = process.env.QF_INTERNAL_CSRF_SENTINEL;
if (
  !cookie ||
  !csrf ||
  process.env.QF_INTERNAL_NETWORK_SENTINEL !== "synthetic-only" ||
  process.env.QUIZFORGE_P2A_CONFIG
)
  throw Error("SYNTHETIC_SENTINELS_REQUIRED");
test.beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/api/studio/probe/failure") {
      cookieReceived = !!request.headers.cookie?.includes(cookie!);
      csrfReceived = request.headers["x-csrf-token"] === csrf;
    }
    if (request.url === "/") {
      response.setHeader(
        "set-cookie",
        `synthetic_session=${cookie}; Path=/; HttpOnly; SameSite=Strict`,
      );
      response.setHeader("content-type", "text/html");
      response.end("<!doctype html><main>Synthetic privacy probe</main>");
    } else if (request.url === "/api/studio/auth/session") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ csrfToken: csrf }));
    } else if (mode?.endsWith("stall")) {
      request.on("error", () => {}); // No response until the helper's fixed deadline closes its socket.
    } else if (mode?.endsWith("late")) {
      setTimeout(() => {
        response.setHeader("content-type", "application/json");
        response.setHeader("set-cookie", `not_forwarded=${cookie}; Path=/`);
        response.end('{"ok":true}');
      }, 80);
    } else request.socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("SYNTHETIC_LISTENER_REQUIRED");
  origin = `http://127.0.0.1:${address.port}`;
  process.env.QF_INTERNAL_NETWORK_PROBE_ORIGIN = origin;
});
async function stop() {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
test.afterAll(stop);
test("actual transport failure has a final reporter artifact with a fixed outer error", async ({
  page,
}) => {
  test.fail(); // Deliberate fixed failure renders all internal PW steps into the final HTML/JSON report.
  await page.goto(origin);
  if (mode === "unsafe-api-reset") {
    try {
      await page.request.post(origin + "/api/studio/probe/failure", {
        headers: { "x-csrf-token": csrf! },
        data: { synthetic: true },
      });
    } catch {
      /* The positive control demonstrates catch alone cannot remove APIRequest fetchLog. */
    }
  } else if (mode === "safe-api-refused") {
    await stop();
    let failed = false;
    try {
      await internalGet(page, "/api/studio/probe/failure");
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  } else if (mode === "safe-post-reset" || mode === "safe-post-stall") {
    let failed = false;
    try {
      await internalPost(page, "/api/studio/probe/failure", {
        synthetic: true,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  } else {
    let forwarded = false;
    await page.route("**/api/studio/probe/failure", async (route) => {
      const original = await route.request().allHeaders();
      expect(!!original.cookie?.includes(cookie!)).toBe(true);
      expect(original["x-csrf-token"] === csrf).toBe(true);
      if (mode?.endsWith("refused")) await stop();
      try {
        if (mode === "unsafe-relay-refused") await route.fetch();
        else {
          const response = await internalRouteFetch(route);
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ ok: true });
          await fulfillInternalResponse(route, response);
          forwarded = true;
          return;
        }
      } catch {
        /* Fixed body only; no native/PW exception reaches a returned error. */
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"code":"FIXED_SAFE_FAILURE"}',
      });
      forwarded = true;
    });
    const result = await page.evaluate(async () => {
      try {
        const session = (await fetch("/api/studio/auth/session", {
          credentials: "same-origin",
        }).then((r) => r.json())) as { csrfToken: string };
        const response = await fetch("/api/studio/probe/failure", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrfToken,
          },
          body: '{"synthetic":true}',
        });
        return response.status;
      } catch {
        return 0;
      }
    });
    expect(forwarded).toBe(true);
    expect(result).toBe(mode === "safe-relay-late" ? 200 : 503);
  }
  if (mode?.startsWith("safe-")) {
    const facts = internalNetworkProbeFacts();
    expect(facts.attempts).toBeGreaterThan(0);
    if (mode.endsWith("stall")) expect(facts.timedOut).toBeGreaterThan(0);
    else if (mode.endsWith("late")) {
      expect(facts.completed).toBe(1);
      expect(facts.failures).toBe(0);
      expect(
        (await page.context().cookies()).some(
          (c) => c.name === "not_forwarded",
        ),
      ).toBe(false);
    } else expect(facts.failures).toBeGreaterThan(0);
  }
  if (
    mode === "unsafe-api-reset" ||
    mode === "safe-post-reset" ||
    mode === "safe-post-stall"
  ) {
    expect(cookieReceived).toBe(true);
    expect(csrfReceived).toBe(true);
  }
  throw Error("FIXED_SAFE_FAILURE");
});
