import "server-only";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import type {
  ConsumerSaveInput,
  ConsumerSaveBinding,
} from "@/lib/consumer-contract/v1/state";
import type {
  ConsumerCompleteBinding,
  PersistedReportView,
} from "@/features/report/persisted/view-contracts";
import type {
  CreateInternalPlayBinding,
  InternalPlayDetail,
  InternalPlayReceipt,
} from "@/features/product/internal-play/contracts";
import type {
  IssueAccessKeyBinding,
  VoidUnusedAccessKeyBinding,
  AccessKeyDetail,
  AccessKeyCursor,
} from "@/features/fulfillment/access/contracts";
import type {
  ConsumerSaveResolution,
  ConsumerCompleteResolution,
  ConsumerExchangeResult,
  ConsumerSessionView,
} from "./contracts";
import type {
  InternalPlayResolution,
  IssueAccessKeyResolution,
  VoidUnusedAccessKeyResolution,
} from "./operator-resolutions";
import type {
  ConsumerEntryView,
  ConsumerResourceSelector,
} from "./display-contract";

/** Sensitive request-local credentials, never DTOs, storage records, URLs, logs or audit data. */
export type ConsumerReadCredentials = Readonly<{ grantToken: string | null }>;
export type ConsumerWriteCredentials = ConsumerReadCredentials &
  Readonly<{ csrfToken: string | null; requestId: string }>;

/** HTTP-visible lifecycle only; constructing an owner and executing phases remain server-internal. */
export interface ConsumerRequestLifecycle {
  closeIfNotTransferred(): Promise<void>;
  /**
   * Accept only the one bytes object issued by this owner's resource read, exactly once.
   * Retain the actual IO task/bytes through stream drain/cancel/deadline; a handler return or
   * Promise.race is not a resource-close proof. Unknown actual closes remain quarantined.
   */
  resourceBody(bytes: Uint8Array): ReadableStream<Uint8Array>;
}

/**
 * Application interfaces, not implementations. Factories bind a single request owner, config and
 * initial 15s budget. HTTP must not supply an arbitrary existing DB connection or renew the clock.
 * Every route selector and input is parsed again inside the service. Resolution results are bound
 * to the original request; a read never authorizes a write or clears pending by itself.
 *
 * The owner opens databases lazily. Pure SQL methods do not acquire a ResourceReadTask. Exchange
 * uses two distinct owned connections: budget COMMIT and actual close must settle successfully
 * before the second connection opens. Any unknown stops there, without refund or automatic retry.
 * Actual fixed-source IO has its own task/guard and close quarantine, outside domain write locks.
 * A/B will implement the owner and explicit same-TransactionSql domain ports after contract review.
 */
export interface ConsumerFlowService {
  /** Only result may be serialized as JSON. cookieGrantToken goes exclusively to HttpOnly Set-Cookie. */
  exchange(
    rawKey: string,
  ): Promise<
    Readonly<{ result: ConsumerExchangeResult; cookieGrantToken: string }>
  >;
  readSession(
    credentials: ConsumerReadCredentials,
    sessionId: string,
  ): Promise<ConsumerSessionView>;
  readEntry(
    credentials: ConsumerReadCredentials,
    sessionId: string,
  ): Promise<ConsumerEntryView>;
  save(
    credentials: ConsumerWriteCredentials,
    sessionId: string,
    input: ConsumerSaveInput,
  ): Promise<ConsumerSaveResolution>;
  resolveSave(
    credentials: ConsumerWriteCredentials,
    sessionId: string,
    binding: ConsumerSaveBinding,
  ): Promise<ConsumerSaveResolution>;
  complete(
    credentials: ConsumerWriteCredentials,
    sessionId: string,
    binding: ConsumerCompleteBinding,
  ): Promise<ConsumerCompleteResolution>;
  resolveComplete(
    credentials: ConsumerWriteCredentials,
    sessionId: string,
    binding: ConsumerCompleteBinding,
  ): Promise<ConsumerCompleteResolution>;
  readReport(
    credentials: ConsumerReadCredentials,
    sessionId: string,
  ): Promise<PersistedReportView>;
  /** Bounded bytes fully owned by this request; no path, FD, dynamic URL or arbitrary source exposed. */
  readResource(
    credentials: ConsumerReadCredentials,
    sessionId: string,
    selector: ConsumerResourceSelector,
  ): Promise<
    Readonly<{
      bytes: Uint8Array;
      mediaType: "image/png" | "image/jpeg" | "image/webp";
    }>
  >;
  /** Revoke only the freshly verified exact grant identity/digest. Does not delete business pending. */
  logout(
    credentials: ConsumerWriteCredentials,
    sessionId: string,
  ): Promise<void>;
}

/** Studio authority stays separate. Read-only Studio actors can resolve/read, but cannot write. */
export interface InternalPlayService {
  create(
    credentials: StudioWriteCredentials,
    productId: string,
    binding: CreateInternalPlayBinding,
  ): Promise<Readonly<{ created: boolean; play: InternalPlayReceipt }>>;
  resolve(
    sessionToken: string | null,
    productId: string,
    binding: CreateInternalPlayBinding,
  ): Promise<InternalPlayResolution>;
  read(
    sessionToken: string | null,
    productId: string,
    playId: string,
  ): Promise<InternalPlayDetail>;
  list(
    sessionToken: string | null,
    productId: string,
  ): Promise<Readonly<{ productId: string; versions: InternalPlayReceipt[] }>>;
}
export interface AccessKeyService {
  issue(
    credentials: StudioWriteCredentials,
    productId: string,
    binding: IssueAccessKeyBinding,
  ): Promise<Readonly<{ created: boolean; key: AccessKeyDetail }>>;
  resolveIssue(
    sessionToken: string | null,
    productId: string,
    binding: IssueAccessKeyBinding,
  ): Promise<IssueAccessKeyResolution>;
  voidUnused(
    credentials: StudioWriteCredentials,
    productId: string,
    keyId: string,
    binding: VoidUnusedAccessKeyBinding,
  ): Promise<VoidUnusedAccessKeyResolution>;
  resolveVoid(
    sessionToken: string | null,
    productId: string,
    binding: VoidUnusedAccessKeyBinding,
  ): Promise<VoidUnusedAccessKeyResolution>;
  read(
    sessionToken: string | null,
    productId: string,
    keyId: string,
  ): Promise<AccessKeyDetail>;
  list(
    sessionToken: string | null,
    productId: string,
    cursor: AccessKeyCursor | null,
  ): Promise<
    Readonly<{
      productId: string;
      keys: AccessKeyDetail[];
      nextCursor: AccessKeyCursor | null;
    }>
  >;
}
