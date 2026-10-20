import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { csrfForToken, issueToken } from "@/lib/security/p2a-tokens";
import { StudioError } from "@/lib/http-security/errors";
import type { QuizpackValidationService } from "@/features/quizpack/validation/service-contract";
import { handleValidationHttp, type ValidationEndpoint } from "./http";
import { dto, tuple } from "./fixtures.test-support";
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  create: vi.fn(),
  close: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db/runtime", () => ({ loadRuntimeConfig: mocks.load }));
vi.mock("@/lib/db/client", () => ({ createDatabase: mocks.create }));
const origin = "http://127.0.0.1:3100";
function service() {
  return {
    prepareValidation: vi.fn<QuizpackValidationService["prepareValidation"]>(
      async () => ({
        productId: tuple.productId,
        importId: tuple.importId,
        expectedImportStateRevision: 7,
        archiveSha256: tuple.archiveSha256,
        archiveBytes: 123,
        identitySha256: tuple.identitySha256,
        validationKey: tuple.expectedValidationKey,
      }),
    ),
    startValidation: vi.fn<QuizpackValidationService["startValidation"]>(
      async () => ({ outcome: "record", created: true, validation: dto }),
    ),
    readValidation: vi.fn<QuizpackValidationService["readValidation"]>(
      async () => dto,
    ),
    listValidations: vi.fn<QuizpackValidationService["listValidations"]>(
      async () => ({
        items: [dto],
        page: 1,
        pageSize: 1,
        total: 1,
        hasNext: false,
      }),
    ),
    recoverValidation: vi.fn<QuizpackValidationService["recoverValidation"]>(
      async () => dto,
    ),
    retryValidation: vi.fn<QuizpackValidationService["retryValidation"]>(
      async () => dto,
    ),
  } satisfies QuizpackValidationService;
}
function endpoint(action: ValidationEndpoint["action"]): ValidationEndpoint {
  return {
    action,
    productId: tuple.productId,
    importId: tuple.importId,
    validationId: dto.id,
  };
}
function request(
  action: ValidationEndpoint["action"],
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    query?: string;
    method?: string;
  } = {},
) {
  const token = issueToken("session").raw;
  const write = action !== "read" && action !== "list";
  return new Request(
    `${origin}/api/studio/products/${tuple.productId}/imports/${tuple.importId}/validations${options.query ?? ""}`,
    {
      method: options.method ?? (write ? "POST" : "GET"),
      headers: {
        host: "127.0.0.1:3100",
        origin,
        cookie: `${SESSION_COOKIE}=${token}`,
        "x-csrf-token": csrfForToken(token, "session")!,
        "content-type": "application/json",
        ...options.headers,
      },
      ...(write
        ? {
            body: JSON.stringify(
              options.body ??
                (action === "prepare"
                  ? { expectedImportStateRevision: 7 }
                  : action === "start"
                    ? {
                        expectedImportStateRevision: 7,
                        expectedValidationKey: tuple.expectedValidationKey,
                      }
                    : { expectedStateRevision: 2 }),
            ),
          }
        : {}),
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ profile: "local-http-p2a", origin });
  mocks.create.mockResolvedValue({ close: mocks.close });
});
describe("validation HTTP typed dispatch", () => {
  it("prepare returns strict public identity without starting", async () => {
    const svc = service();
    const response = await handleValidationHttp(
      request("prepare"),
      endpoint("prepare"),
      svc,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(svc.prepareValidation).toHaveBeenCalledTimes(1);
    expect(svc.startValidation).not.toHaveBeenCalled();
  });
  it("201 is a real record create; replay and strict not-started are 200", async () => {
    const svc = service();
    expect(
      (await handleValidationHttp(request("start"), endpoint("start"), svc))
        .status,
    ).toBe(201);
    svc.startValidation.mockResolvedValue({
      outcome: "record",
      created: false,
      validation: dto,
    });
    expect(
      (await handleValidationHttp(request("start"), endpoint("start"), svc))
        .status,
    ).toBe(200);
    svc.startValidation.mockResolvedValue({
      outcome: "not-started",
      execution: "not-started",
      productId: tuple.productId,
      importId: tuple.importId,
      expectedValidationKey: tuple.expectedValidationKey,
      expectedImportStateRevision: 7,
      code: "MEDIA_UNAVAILABLE",
    });
    const response = await handleValidationHttp(
      request("start"),
      endpoint("start"),
      svc,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe("not-started");
  });
  it.each([
    { host: "localhost:3100" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
    { "x-csrf-token": "wrong" },
    { cookie: "" },
  ])("rejects unsafe write before DB/service", async (headers) => {
    const svc = service();
    expect(
      (
        await handleValidationHttp(
          request("start", { headers }),
          endpoint("start"),
          svc,
        )
      ).status,
    ).toBeGreaterThanOrEqual(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(svc.startValidation).not.toHaveBeenCalled();
  });
  it("validates strict body, method, route IDs and query before opening DB", async () => {
    const svc = service();
    for (const incoming of [
      request("start", {
        body: {
          expectedImportStateRevision: 7,
          expectedValidationKey: tuple.expectedValidationKey,
          identitySha256: tuple.identitySha256,
        },
      }),
      request("prepare", { query: "?page=1" }),
      request("start", { method: "PUT" }),
    ])
      expect(
        (
          await handleValidationHttp(
            incoming,
            endpoint(incoming.method === "PUT" ? "start" : "prepare"),
            svc,
          )
        ).status,
      ).toBe(400);
    expect(
      (
        await handleValidationHttp(
          request("read"),
          { ...endpoint("read"), importId: "UPPER" },
          svc,
        )
      ).status,
    ).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("read/list dispatch only to read service and exact key stays unfiltered", async () => {
    const svc = service();
    await handleValidationHttp(
      request("list", {
        query: `?validationKey=${tuple.expectedValidationKey}&page=1&pageSize=1`,
      }),
      endpoint("list"),
      svc,
    );
    expect(svc.listValidations.mock.calls[0]?.at(-1)).toEqual({
      validationKey: tuple.expectedValidationKey,
      page: 1,
      pageSize: 1,
    });
    await handleValidationHttp(request("read"), endpoint("read"), svc);
    expect(svc.readValidation).toHaveBeenCalledTimes(1);
    expect(svc.prepareValidation).not.toHaveBeenCalled();
    expect(svc.recoverValidation).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0]?.[1]).toBeUndefined();
  });
  it.each(["recover", "retry"] as const)(
    "%s has its own explicit CAS action and original entry budget",
    async (action) => {
      const svc = service();
      const entered = performance.now() - 50;
      svc[
        action === "recover" ? "recoverValidation" : "retryValidation"
      ].mockImplementation(
        async (_db, _credentials, _product, _import, _id, input, context) => {
          expect(input).toEqual({ expectedStateRevision: 2 });
          expect(context.deadlineMonotonicMs).toBe(entered + 60000);
          expect(mocks.create.mock.calls[0]?.[1]).toBe(context);
          return dto;
        },
      );
      expect(
        (
          await handleValidationHttp(
            request(action),
            endpoint(action),
            svc,
            entered,
          )
        ).status,
      ).toBe(200);
      expect(
        svc[action === "recover" ? "retryValidation" : "recoverValidation"],
      ).not.toHaveBeenCalled();
    },
  );
  it("expired handler budget does not begin configuration or database work", async () => {
    const response = await handleValidationHttp(
      request("start"),
      endpoint("start"),
      service(),
      performance.now() - 60001,
    );
    expect(response.status).toBe(504);
    expect((await response.json()).code).toBe("VALIDATION_TIMEOUT");
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("shared database initialization timeout projects validation timeout", async () => {
    mocks.create.mockRejectedValue(new StudioError("RECEIVE_TIMEOUT"));
    const svc = service();
    const response = await handleValidationHttp(
      request("start"),
      endpoint("start"),
      svc,
    );
    expect(response.status).toBe(504);
    expect(svc.startValidation).not.toHaveBeenCalled();
  });
  it("unknown claim errors never become not-started and hide exception details", async () => {
    const svc = service();
    svc.startValidation.mockRejectedValue(
      new StudioError("WRITE_OUTCOME_UNKNOWN"),
    );
    const response = await handleValidationHttp(
      request("start"),
      endpoint("start"),
      svc,
    );
    expect(response.status).toBe(503);
    expect(Object.keys(await response.json()).sort()).toEqual([
      "code",
      "requestId",
    ]);
    expect(mocks.close).toHaveBeenCalledTimes(1);
  });
});
