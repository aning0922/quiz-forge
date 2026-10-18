import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadRuntimeConfig, type P2aRuntimeConfig } from "@/lib/db/runtime";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { digestToken, verifyCsrf } from "@/lib/security/p2a-tokens";
import {
  consumerIdSchema,
  consumerUuidSchema,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import {
  assertConsumerSource,
  readConsumerJson,
} from "@/features/fulfillment/consumer-flow/http/security";
import {
  consumerFailureResponse,
  consumerJsonResponse,
} from "@/features/fulfillment/consumer-flow/http/response";
import type {
  ConsumerRequestLifecycle,
  InternalPlayService,
  AccessKeyService,
} from "@/features/fulfillment/consumer-flow/service-contract";
import {
  createInternalPlayBindingSchema,
  internalPlayListSchema,
  verifyInternalPlayDetail,
} from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSchema,
  accessKeyCursorSchema,
  accessKeyListSchema,
  verifyAccessKeyDetail,
} from "@/features/fulfillment/access/contracts";
import {
  verifyInternalPlayResolution,
  verifyIssueAccessKeyResolution,
  verifyVoidUnusedAccessKeyResolution,
} from "@/features/fulfillment/consumer-flow/operator-resolutions";
import {
  checkPlayCreatedV1,
  checkPlayReceiptV1,
  checkKeyIssuedV1,
} from "./facts";
const base = { productId: consumerIdSchema };
const endpointSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    action: z.enum([
      "list-plays",
      "create-play",
      "resolve-play",
      "list-keys",
      "issue-key",
      "resolve-issue",
      "resolve-void",
    ]),
  }),
  z.strictObject({
    ...base,
    action: z.literal("read-play"),
    playId: consumerUuidSchema,
  }),
  z.strictObject({
    ...base,
    action: z.enum(["read-key", "void-key"]),
    keyId: consumerUuidSchema,
  }),
]);
export type StudioConsumerEndpointV1 = z.infer<typeof endpointSchema>;
export type StudioConsumerHttpDependenciesV1<
  Owner extends ConsumerRequestLifecycle,
> = Readonly<{
  createOwner: (
    config: P2aRuntimeConfig,
    clock: ReturnType<typeof createStudioRequestBudget>,
  ) => Owner;
  createPlayService: (owner: Owner) => InternalPlayService;
  createAccessService: (owner: Owner) => AccessKeyService;
  loadConfig?: () => Promise<P2aRuntimeConfig>;
}>;
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ConsumerError("INVALID_REQUEST");
  return result.data;
}
function studioToken(headers: Headers) {
  const parts = (headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.split("=", 1)[0]!.trim() === SESSION_COOKIE);
  if (parts.length !== 1) throw new ConsumerError("ACCESS_DENIED");
  const part = parts[0]!,
    split = part.indexOf("="),
    raw = part.slice(split + 1);
  if (
    split < 0 ||
    part.slice(0, split) !== SESSION_COOKIE ||
    !digestToken(raw, "session")
  )
    throw new ConsumerError("ACCESS_DENIED");
  return raw;
}
/** One real request owner; reads/resolves have Studio read authority, new writes require operator in-service. */
export async function handleStudioConsumerHttpV1<
  Owner extends ConsumerRequestLifecycle,
>(
  request: Request,
  endpointInput: StudioConsumerEndpointV1,
  dependencies: StudioConsumerHttpDependenciesV1<Owner>,
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
      { action, productId } = endpoint;
    write = ["create-play", "issue-key", "void-key"].includes(action);
    const post =
      write ||
      ["resolve-play", "resolve-issue", "resolve-void"].includes(action);
    const config = await (dependencies.loadConfig ?? loadRuntimeConfig)();
    check();
    assertConsumerSource(request, config, { post });
    if (request.method !== (post ? "POST" : "GET"))
      throw new ConsumerError("INVALID_REQUEST");
    const url = new URL(request.url);
    let cursor: ReturnType<typeof accessKeyCursorSchema.parse> | null = null;
    if (action === "list-keys") {
      if (url.search) {
        if (
          [...url.searchParams.keys()].length !== 2 ||
          ["issuedAt", "keyId"].some(
            (k) => url.searchParams.getAll(k).length !== 1,
          )
        )
          throw new ConsumerError("INVALID_REQUEST");
        cursor = parse(accessKeyCursorSchema, {
          productId,
          ...Object.fromEntries(url.searchParams),
        });
      }
    } else if (url.search) throw new ConsumerError("INVALID_REQUEST");
    const sessionToken = studioToken(request.headers),
      csrfToken = request.headers.get("x-csrf-token"),
      credentials = { sessionToken, csrfToken, requestId };
    if (post && (!csrfToken || !verifyCsrf(sessionToken, "session", csrfToken)))
      throw new ConsumerError("CSRF_REJECTED");
    const body = post
      ? await readConsumerJson(
          request,
          action === "create-play" || action === "resolve-play"
            ? L.playRequestBytes
            : L.operationRequestBytes,
          clock.budget,
        )
      : undefined;
    let status = 200,
      maximum: number = L.operationReceiptBytes;
    // Factories stay lazy until every transport-level selector/binding check has succeeded.
    let run: (owner: Owner) => Promise<unknown>;
    if (action === "create-play" || action === "resolve-play") {
      const binding = parse(createInternalPlayBindingSchema, body);
      if (binding.parent.productId !== productId)
        throw new ConsumerError("INVALID_REQUEST");
      run = async (owner) => {
        const service = dependencies.createPlayService(owner);
        if (action === "resolve-play")
          return verifyInternalPlayResolution(
            await service.resolve(sessionToken, productId, binding),
            binding,
          );
        const value = await service.create(credentials, productId, binding);
        successful = true;
        status = value.created ? 201 : 200;
        return checkPlayCreatedV1(value, status, binding);
      };
    } else if (action === "issue-key" || action === "resolve-issue") {
      const binding = parse(issueAccessKeyBindingSchema, body);
      if (binding.play.productId !== productId)
        throw new ConsumerError("INVALID_REQUEST");
      run = async (owner) => {
        const service = dependencies.createAccessService(owner);
        if (action === "resolve-issue")
          return verifyIssueAccessKeyResolution(
            await service.resolveIssue(sessionToken, productId, binding),
            binding,
          );
        const value = await service.issue(credentials, productId, binding);
        successful = true;
        status = value.created ? 201 : 200;
        return checkKeyIssuedV1(value, status, binding);
      };
    } else if (action === "void-key" || action === "resolve-void") {
      const binding = parse(voidUnusedAccessKeyBindingSchema, body);
      if (
        binding.productId !== productId ||
        (action === "void-key" && binding.keyId !== endpoint.keyId)
      )
        throw new ConsumerError("INVALID_REQUEST");
      run = async (owner) => {
        const service = dependencies.createAccessService(owner);
        const value =
          action === "void-key"
            ? await service.voidUnused(
                credentials,
                productId,
                endpoint.keyId,
                binding,
              )
            : await service.resolveVoid(sessionToken, productId, binding);
        if (action === "void-key") successful = true;
        return verifyVoidUnusedAccessKeyResolution(value, binding);
      };
    } else if (action === "list-plays") {
      maximum = L.playListResponseBytes;
      run = async (owner) => {
        const value = internalPlayListSchema.parse(
          await dependencies
            .createPlayService(owner)
            .list(sessionToken, productId),
        );
        if (value.productId !== productId)
          throw new ConsumerError("UNAVAILABLE");
        await Promise.all(value.versions.map(checkPlayReceiptV1));
        return value;
      };
    } else if (action === "read-play") {
      maximum = L.playSnapshotBytes + L.operationReceiptBytes;
      run = async (owner) => {
        const value = await verifyInternalPlayDetail(
          await dependencies
            .createPlayService(owner)
            .read(sessionToken, productId, endpoint.playId),
        );
        if (
          value.play.id !== endpoint.playId ||
          value.snapshot.parent.productId !== productId
        )
          throw new ConsumerError("UNAVAILABLE");
        return value;
      };
    } else if (action === "list-keys") {
      maximum = L.keyListResponseBytes;
      run = async (owner) => {
        const value = accessKeyListSchema.parse(
          await dependencies
            .createAccessService(owner)
            .list(sessionToken, productId, cursor),
        );
        if (value.productId !== productId)
          throw new ConsumerError("UNAVAILABLE");
        await Promise.all(value.keys.map(verifyAccessKeyDetail));
        return value;
      };
    } else if (action === "read-key" && "keyId" in endpoint)
      run = async (owner) => {
        const value = await verifyAccessKeyDetail(
          await dependencies
            .createAccessService(owner)
            .read(sessionToken, productId, endpoint.keyId),
        );
        if (
          value.issue.binding.keyId !== endpoint.keyId ||
          value.issue.binding.play.productId !== productId
        )
          throw new ConsumerError("UNAVAILABLE");
        return value;
      };
    else throw new ConsumerError("INVALID_REQUEST");
    check();
    owner = dependencies.createOwner(config, clock);
    entered = true;
    const value = await run(owner);
    check();
    const response = consumerJsonResponse(value, status, maximum);
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
        /* Same owner retains actual close/quarantine. */
      }
    } else clock.dispose();
  }
}
