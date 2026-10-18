import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadRuntimeConfig, type P2aRuntimeConfig } from "@/lib/db/runtime";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { consumerUuidSchema } from "@/lib/consumer-contract/v1/primitives";
import {
  consumerSaveInputSchema,
  consumerSaveBindingSchema,
  verifyConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import { verifyConsumerCsrf } from "@/lib/consumer-contract/v1/credentials";
import {
  consumerCompleteBindingSchema,
  verifyPersistedReportView,
} from "@/features/report/persisted/view-contracts";
import {
  consumerExchangeInputSchema,
  consumerExchangeResultSchema,
  verifyConsumerSessionView,
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
} from "../contracts";
import {
  consumerEntryViewSchema,
  consumerResourceSelectorSchema,
  verifyConsumerEntryView,
} from "../display-contract";
import type {
  ConsumerFlowService,
  ConsumerRequestLifecycle,
} from "../service-contract";
import { CONSUMER_CSRF_HEADER_V1 } from "../http-protocol";
import {
  assertConsumerSource,
  consumerGrantCookie,
  consumerSetCookie,
  readConsumerJson,
} from "./security";
import {
  consumerFailureResponse,
  consumerJsonResponse,
  consumerPrivateHeaders,
} from "./response";

const sessionActions = [
  "session",
  "entry",
  "save",
  "resolve-save",
  "complete",
  "resolve-complete",
  "report",
  "resource",
  "logout",
] as const;
const endpointSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("exchange") }),
  z.strictObject({
    action: z.enum(sessionActions),
    sessionId: consumerUuidSchema,
  }),
]);
export type ConsumerHttpEndpoint = z.infer<typeof endpointSchema>;
export type ConsumerHttpDependencies<Owner extends ConsumerRequestLifecycle> =
  Readonly<{
    createOwner: (
      config: P2aRuntimeConfig,
      clock: ReturnType<typeof createStudioRequestBudget>,
    ) => Owner;
    createService: (owner: Owner) => ConsumerFlowService;
    loadConfig?: () => Promise<P2aRuntimeConfig>;
  }>;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ConsumerError("INVALID_REQUEST");
  return parsed.data;
}
/** No DB construction here. Thin app routes must inject the real owner/service factories. */
export async function handleConsumerHttp<
  Owner extends ConsumerRequestLifecycle,
>(
  request: Request,
  endpointInput: ConsumerHttpEndpoint,
  dependencies: ConsumerHttpDependencies<Owner>,
  startedAt = performance.now(),
): Promise<Response> {
  const requestId = randomUUID(),
    clock = createStudioRequestBudget(request.signal, startedAt);
  let owner: Owner | undefined,
    entered = false,
    successful = false,
    write = false;
  const check = () => {
    if (
      clock.budget.signal.aborted ||
      performance.now() >= clock.budget.deadlineMonotonicMs
    )
      throw new ConsumerError("TIMEOUT");
  };
  try {
    check();
    const endpoint = parse(endpointSchema, endpointInput),
      action = endpoint.action;
    write = ["exchange", "save", "complete", "logout"].includes(action);
    const post =
      write || action === "resolve-save" || action === "resolve-complete";
    const config = await (dependencies.loadConfig ?? loadRuntimeConfig)();
    check();
    assertConsumerSource(request, config, {
      post,
      exchange: action === "exchange",
    });
    if (request.method !== (post ? "POST" : "GET"))
      throw new ConsumerError("INVALID_REQUEST");
    const url = new URL(request.url);
    if (action !== "resource" && url.search)
      throw new ConsumerError("INVALID_REQUEST");
    let selector:
      ReturnType<typeof consumerResourceSelectorSchema.parse> | undefined;
    if (action === "resource") {
      if (
        [...url.searchParams.keys()].length !== 3 ||
        ["resourceId", "resourceVersion", "sha256"].some(
          (k) => url.searchParams.getAll(k).length !== 1,
        )
      )
        throw new ConsumerError("INVALID_REQUEST");
      selector = parse(
        consumerResourceSelectorSchema,
        Object.fromEntries(url.searchParams),
      );
    }
    const grantToken =
      action === "exchange" ? null : consumerGrantCookie(request.headers);
    const csrfToken = request.headers.get(CONSUMER_CSRF_HEADER_V1),
      credentials = { grantToken, csrfToken, requestId };
    if (action !== "exchange" && !grantToken)
      throw new ConsumerError("ACCESS_DENIED");
    if (
      post &&
      action !== "exchange" &&
      !(await verifyConsumerCsrf(grantToken, csrfToken))
    )
      throw new ConsumerError("CSRF_REJECTED");
    check();
    const body = post
      ? await readConsumerJson(
          request,
          action === "save" ? L.saveRequestBytes : L.operationRequestBytes,
          clock.budget,
        )
      : undefined;
    let execute: (service: ConsumerFlowService) => Promise<Response>;
    if (action === "exchange") {
      const input = parse(consumerExchangeInputSchema, body);
      execute = async (service) => {
        const result = await service.exchange(input.rawKey);
        successful = true;
        check();
        const value = consumerExchangeResultSchema.parse(result.result);
        return consumerJsonResponse(value, 200, L.operationRequestBytes, {
          "Set-Cookie": consumerSetCookie(
            result.cookieGrantToken,
            value.session.sessionId,
          ),
        });
      };
    } else {
      const id = endpoint.sessionId;
      if (action === "session")
        execute = async (service) => {
          const value = await verifyConsumerSessionView(
            await service.readSession(credentials, id),
            id,
          );
          return consumerJsonResponse(value, 200, L.stateResponseBytes);
        };
      else if (action === "entry")
        execute = async (service) => {
          const value = consumerEntryViewSchema.parse(
            await service.readEntry(credentials, id),
          );
          if (value.facts.session.sessionId !== id)
            throw new ConsumerError("UNAVAILABLE");
          return consumerJsonResponse(
            await verifyConsumerEntryView(value, value.facts.session),
            200,
            L.entryResponseBytes,
          );
        };
      else if (action === "save") {
        let input: Awaited<ReturnType<typeof verifyConsumerSaveInput>>;
        try {
          input = await verifyConsumerSaveInput(
            parse(consumerSaveInputSchema, body),
          );
        } catch {
          throw new ConsumerError("INVALID_REQUEST");
        }
        if (input.binding.session.sessionId !== id)
          throw new ConsumerError("INVALID_REQUEST");
        execute = async (service) => {
          const value = await service.save(credentials, id, input);
          successful = true;
          return consumerJsonResponse(
            await verifyConsumerSaveResolution(value, input.binding),
            200,
            L.stateResponseBytes,
          );
        };
      } else if (action === "resolve-save") {
        const binding = parse(consumerSaveBindingSchema, body);
        if (binding.session.sessionId !== id)
          throw new ConsumerError("INVALID_REQUEST");
        execute = async (service) =>
          consumerJsonResponse(
            await verifyConsumerSaveResolution(
              await service.resolveSave(credentials, id, binding),
              binding,
            ),
            200,
            L.stateResponseBytes,
          );
      } else if (action === "complete" || action === "resolve-complete") {
        const binding = parse(consumerCompleteBindingSchema, body);
        if (binding.session.sessionId !== id)
          throw new ConsumerError("INVALID_REQUEST");
        execute = async (service) => {
          const value =
            action === "complete"
              ? await service.complete(credentials, id, binding)
              : await service.resolveComplete(credentials, id, binding);
          if (action === "complete") successful = true;
          return consumerJsonResponse(
            await verifyConsumerCompleteResolution(value, binding),
            200,
            L.stateResponseBytes,
          );
        };
      } else if (action === "report")
        execute = async (service) => {
          const value = await verifyPersistedReportView(
            await service.readReport(credentials, id),
          );
          if (value.view.session.sessionId !== id)
            throw new ConsumerError("UNAVAILABLE");
          return consumerJsonResponse(value, 200, L.reportResponseBytes);
        };
      else if (action === "logout") {
        parse(z.strictObject({}), body);
        execute = async (service) => {
          await service.logout(credentials, id);
          successful = true;
          return new Response(null, {
            status: 204,
            headers: {
              ...consumerPrivateHeaders,
              "Set-Cookie": consumerSetCookie("", id, true),
            },
          });
        };
      } else
        execute = async (service) => {
          const value = await service.readResource(credentials, id, selector!);
          if (
            !(value.bytes instanceof Uint8Array) ||
            value.bytes.byteLength < 1 ||
            value.bytes.byteLength > L.imageBytes ||
            !["image/png", "image/jpeg", "image/webp"].includes(value.mediaType)
          )
            throw new ConsumerError("UNAVAILABLE");
          check();
          // Exact bytes identity, one transfer. Do not clone, drain, wrap or dispose the owner clock.
          return new Response(owner!.resourceBody(value.bytes), {
            headers: {
              ...consumerPrivateHeaders,
              "Content-Type": value.mediaType,
              "Content-Length": String(value.bytes.byteLength),
            },
          });
        };
    }
    check();
    owner = dependencies.createOwner(config, clock);
    const service = dependencies.createService(owner);
    entered = true;
    const response = await execute(service);
    check();
    await owner.closeIfNotTransferred();
    check();
    return response;
  } catch (error) {
    return consumerFailureResponse(
      write && entered && (successful || !(error instanceof ConsumerError))
        ? new ConsumerError("OUTCOME_UNKNOWN")
        : error,
      requestId,
      write,
    );
  } finally {
    if (owner) {
      try {
        await owner.closeIfNotTransferred();
      } catch {
        /* Actual close/quarantine belongs to the same owner. */
      }
    } else clock.dispose();
  }
}
