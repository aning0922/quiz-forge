import "server-only";
import { randomUUID } from "node:crypto";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
import { consumerUuidSchema } from "@/lib/consumer-contract/v1/primitives";
import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  createConsumerToken,
  digestConsumerToken,
  consumerCsrfForGrant,
} from "@/lib/consumer-contract/v1/credentials";
import {
  consumerSaveInputSchema,
  consumerSaveBindingSchema,
  verifyConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerCompleteBindingSchema,
  consumerCompleteBindingSha256,
  verifyPersistedReportView,
} from "@/features/report/persisted/view-contracts";
import { verifyPersistedReportSnapshot } from "@/features/report/persisted/snapshot-contract";
import {
  readPersistedReport,
  insertPersistedReport,
} from "@/features/report/persisted/repository";
import {
  reserveConsumerExchange,
  lockAccessKey,
  rotateConsumerGrant,
  verifyLockedGrant,
  revokeExactGrant,
} from "../access/repository";
import {
  lockConsumerSession,
  createConsumerSession,
  saveConsumerSession,
} from "../consumer-session/repository";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import type { DisplayAssetV1 } from "@/lib/assessment-contract/display-v1";
import type { ConsumerRequestOwner } from "./request-owner";
import type { ConsumerFlowService } from "./service-contract";
import {
  consumerServiceCall,
  consumerWrite,
  consumerReferenceShare,
  consumerDatabaseMoment,
  parseConsumer,
} from "./transaction";
import {
  authorizedConsumerRead,
  consumerCredentialDigest,
  assertConsumerWriteCredentials,
  lockConsumerAuthority,
  assertConsumerSessionBinding,
  assertActiveConsumerKey,
  reauthorizeConsumer,
  type ConsumerAuthority,
} from "./authorization";
import { observeConsumerSave, observeConsumerCompletion } from "./resolution";
import {
  readConsumerExecutionSource,
  readConsumerPlaySource,
  validateConsumerMembers,
  projectConsumerEntry,
  type ConsumerExecutionSource,
} from "./source";
import {
  verifyConsumerExecutionIo,
  readConsumerResourceIo,
  fixedConsumerExecution,
} from "./fixed-execution";
import {
  consumerExchangeInputSchema,
  consumerExchangeResultSchema,
  verifyConsumerSessionView,
} from "./contracts";
import {
  consumerResourceSelectorSchema,
  type ConsumerResourceSelector,
} from "./display-contract";

const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.playSnapshotBytes);
const selectorMatches = (a: DisplayAssetV1, s: ConsumerResourceSelector) =>
  a.resourceRef.id === s.resourceId &&
  a.resourceRef.version === s.resourceVersion &&
  a.sha256 === s.sha256;
async function selectConsumerResource(
  tx: ConsumerTx,
  authority: ConsumerAuthority,
  selector: ConsumerResourceSelector,
) {
  const report = await readPersistedReport(tx, authority.state.session.keyId);
  let assets: readonly DisplayAssetV1[];
  if (report) assets = [report.snapshot.view.display.result.portrait];
  else {
    assertActiveConsumerKey(authority.key, authority.at);
    const execution = await readConsumerExecutionSource(tx, authority.state),
      entry = await projectConsumerEntry(authority.state, execution);
    assets = entry.facts.entry.assets;
  }
  const selected = assets.find((a) => selectorMatches(a, selector));
  if (!selected) throw new ConsumerError("ACCESS_DENIED");
  return selected;
}
function assertSameExecution(
  a: ConsumerExecutionSource,
  b: ConsumerExecutionSource,
) {
  if (
    !same(a.play, b.play) ||
    !same(a.source.evidence.validation, b.source.evidence.validation) ||
    a.source.evidence.canonicalContentSha256 !==
      b.source.evidence.canonicalContentSha256 ||
    a.source.evidence.assetSetSha256 !== b.source.evidence.assetSetSha256 ||
    a.source.evidence.canonicalManifestSha256 !==
      b.source.evidence.canonicalManifestSha256
  )
    throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
}

/** One factory per request. Browser credentials are request-local and never inserted into business rows. */
export function createConsumerFlowService(
  owner: ConsumerRequestOwner,
): ConsumerFlowService {
  return Object.freeze<ConsumerFlowService>({
    exchange(rawKey) {
      return consumerServiceCall(owner, "exchange", async (c, observation) => {
        const input = parseConsumer(consumerExchangeInputSchema, { rawKey }),
          digest = await digestConsumerToken(input.rawKey, "access-key");
        if (!digest) throw new ConsumerError("ACCESS_DENIED");
        // This commit AND the phase owner's actual close must finish before opening the Key connection.
        await c.sql((db, check) =>
          consumerWrite(db, check, observation, reserveConsumerExchange),
        );
        observation.kind = "not-started";
        const rawGrant = createConsumerToken("grant"),
          grantDigest = await digestConsumerToken(rawGrant, "grant");
        if (!grantDigest) throw new ConsumerError("UNAVAILABLE");
        const result = await c.sql((db, check) =>
          consumerWrite(db, check, observation, async (tx) => {
            await consumerReferenceShare(tx);
            const key = await lockAccessKey(tx, { credentialDigest: digest });
            if (!key || key.voidReceipt)
              throw new ConsumerError("ACCESS_DENIED");
            let session = await lockConsumerSession(tx, key);
            const report = await readPersistedReport(
              tx,
              key.issue.binding.keyId,
            );
            if (!report)
              assertActiveConsumerKey(key, await consumerDatabaseMoment(tx));
            if (!session) {
              if (report) throw new ConsumerError("UNAVAILABLE");
              session = await createConsumerSession(tx, key);
            }
            const at = await consumerDatabaseMoment(tx);
            if (!report) assertActiveConsumerKey(key, at);
            await rotateConsumerGrant(
              tx,
              key,
              session,
              { grantId: randomUUID(), credentialDigest: grantDigest },
              at,
            );
            return consumerExchangeResultSchema.parse({
              schemaVersion: "quizforge.consumer-exchange.v1",
              session: session.state.session,
              destination: report ? "report" : "play",
            });
          }),
        );
        return { result, cookieGrantToken: rawGrant };
      });
    },
    readSession(credentials, sessionInput) {
      return consumerServiceCall(owner, "read-session", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await consumerCredentialDigest(credentials),
          csrf = await consumerCsrfForGrant(credentials.grantToken);
        if (!csrf) throw new ConsumerError("ACCESS_DENIED");
        return c.sql(
          async (db, check) =>
            (
              await authorizedConsumerRead(
                db,
                check,
                digest,
                sessionId,
                async (tx, a) => {
                  const report = await readPersistedReport(
                    tx,
                    a.state.session.keyId,
                  );
                  return verifyConsumerSessionView(
                    {
                      schemaVersion: "quizforge.consumer-session-view.v1",
                      grant: {
                        grantId: a.grant.grantId,
                        session: a.state.session,
                        issuedAt: a.grant.issuedAt,
                        expiresAt: a.grant.expiresAt,
                        csrf,
                      },
                      observedAt: a.at,
                      keyExpiresAt: a.key.issue.expiresAt,
                      outcome: report
                        ? { kind: "completed", report: report.receipt }
                        : {
                            kind:
                              a.key.issue.expiresAt <= a.at
                                ? "expired"
                                : "editable",
                            state: a.state,
                          },
                    },
                    sessionId,
                  );
                },
              )
            ).value,
        );
      });
    },
    readEntry(credentials, sessionInput) {
      return consumerServiceCall(owner, "read-entry", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await consumerCredentialDigest(credentials);
        const before = await c.sql((db, check) =>
          authorizedConsumerRead(
            db,
            check,
            digest,
            sessionId,
            async (tx, a) => {
              if (!(await readPersistedReport(tx, a.state.session.keyId)))
                assertActiveConsumerKey(a.key, a.at);
              return readConsumerExecutionSource(tx, a.state);
            },
          ),
        );
        return c.io(async (io) => {
          const current = await authorizedConsumerRead(
            io.db,
            io.checkpoint,
            digest,
            sessionId,
            async (tx, a) => {
              if (!(await readPersistedReport(tx, a.state.session.keyId)))
                assertActiveConsumerKey(a.key, a.at);
              return readConsumerExecutionSource(tx, a.state);
            },
          );
          assertSameExecution(before.value, current.value);
          await verifyConsumerExecutionIo(
            io,
            current.value.play.snapshot.parentSnapshot,
            current.value.play.snapshot.renderer,
            current.value.source,
          );
          const entry = await projectConsumerEntry(
            current.authority.state,
            current.value,
          );
          await reauthorizeConsumer(
            io.db,
            io.checkpoint,
            current.authority.locator,
            current.authority.state.session,
          );
          await io.guard.check();
          return entry;
        });
      });
    },
    save(credentials, sessionInput, inputValue) {
      return consumerServiceCall(owner, "save", async (c, observation) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials),
          parsed = parseConsumer(consumerSaveInputSchema, inputValue);
        let input;
        try {
          input = await verifyConsumerSaveInput(parsed);
        } catch {
          throw new ConsumerError("INVALID_REQUEST");
        }
        if (input.binding.session.sessionId !== sessionId)
          throw new ConsumerError("ACCESS_DENIED");
        return c.sql((db, check) =>
          consumerWrite(db, check, observation, async (tx) => {
            const a = await lockConsumerAuthority(tx, digest, sessionId);
            assertConsumerSessionBinding(
              a.state.session,
              input.binding.session,
            );
            const report = await readPersistedReport(tx, a.state.session.keyId),
              observed = await observeConsumerSave(
                input.binding,
                a.state,
                report?.receipt ?? null,
              );
            if (observed.kind !== "unresolved") return observed;
            assertActiveConsumerKey(a.key, a.at);
            // Saving validates fixed definition membership without any filesystem task or execution dependency.
            const { source } = await readConsumerPlaySource(tx, a.state);
            validateConsumerMembers(source, input);
            await verifyLockedGrant(tx, a.key, a.session, a.locator);
            const at = await consumerDatabaseMoment(tx);
            assertActiveConsumerKey(a.key, at);
            const state = await saveConsumerSession(
              tx,
              a.key,
              a.session,
              input,
              at,
            );
            return observeConsumerSave(input.binding, state, null);
          }),
        );
      });
    },
    resolveSave(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(owner, "resolve-save", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials),
          binding = parseConsumer(consumerSaveBindingSchema, bindingValue);
        return c.sql(
          async (db, check) =>
            (
              await authorizedConsumerRead(
                db,
                check,
                digest,
                sessionId,
                async (tx, a) =>
                  observeConsumerSave(
                    binding,
                    a.state,
                    (await readPersistedReport(tx, a.state.session.keyId))
                      ?.receipt ?? null,
                  ),
              )
            ).value,
        );
      });
    },
    complete(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(owner, "complete", async (c, observation) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials),
          binding = parseConsumer(consumerCompleteBindingSchema, bindingValue);
        const precheck = async (tx: ConsumerTx, a: ConsumerAuthority) => {
          const observed = await observeConsumerCompletion(
            binding,
            a.state,
            (await readPersistedReport(tx, a.state.session.keyId))?.receipt ??
              null,
          );
          if (observed.kind !== "unresolved")
            return { kind: "observed" as const, observed };
          assertActiveConsumerKey(a.key, a.at);
          const execution = await readConsumerExecutionSource(tx, a.state);
          validateConsumerMembers(execution.source, a.state, true);
          return { kind: "source" as const, execution };
        };
        const before = await c.sql((db, check) =>
          authorizedConsumerRead(db, check, digest, sessionId, precheck),
        );
        if (before.value.kind === "observed") return before.value.observed;
        const expected = before.value.execution;
        return c.io(async (io) => {
          const current = await authorizedConsumerRead(
            io.db,
            io.checkpoint,
            digest,
            sessionId,
            precheck,
          );
          if (current.value.kind === "observed") return current.value.observed;
          const execution = current.value.execution;
          assertSameExecution(expected, execution);
          const fixed = await verifyConsumerExecutionIo(
            io,
            execution.play.snapshot.parentSnapshot,
            execution.play.snapshot.renderer,
            execution.source,
          );
          return consumerWrite(
            io.db,
            io.checkpoint,
            observation,
            async (tx) => {
              const a = await lockConsumerAuthority(tx, digest, sessionId),
                observed = await observeConsumerCompletion(
                  binding,
                  a.state,
                  (await readPersistedReport(tx, a.state.session.keyId))
                    ?.receipt ?? null,
                );
              if (observed.kind !== "unresolved") return observed;
              assertActiveConsumerKey(a.key, a.at);
              const final = await readConsumerExecutionSource(tx, a.state);
              assertSameExecution(execution, final);
              validateConsumerMembers(final.source, a.state, true);
              // Resolve exact identities again, while executing only the already verified fixed pure handle.
              fixedConsumerExecution(
                final.play.snapshot.parentSnapshot,
                final.play.snapshot.renderer,
                final.source,
              );
              io.checkpoint();
              const score = fixed.engine.score(fixed.prepared, a.state.answers);
              if (!score.ok) throw new ConsumerError("INVALID_ANSWERS");
              const display = fixed.display.projectResult(
                final.source.content,
                score.value,
                final.source.evidence.canonicalContentSha256,
              );
              if (!display.ok)
                throw new ConsumerError("DEPENDENCY_UNAVAILABLE");
              await verifyLockedGrant(tx, a.key, a.session, a.locator);
              const completedAt = await consumerDatabaseMoment(tx);
              assertActiveConsumerKey(a.key, completedAt);
              const snapshot = await verifyPersistedReportSnapshot({
                schemaVersion: "quizforge.consumer-report-snapshot.v1",
                binding,
                play: final.play,
                answers: a.state.answers,
                progress: a.state.progress,
                score: score.value,
                view: {
                  schemaVersion: "quizforge.consumer-report-display.v1",
                  reportId: randomUUID(),
                  session: a.state.session,
                  completedAt,
                  completionBindingSha256:
                    await consumerCompleteBindingSha256(binding),
                  parent: final.play.snapshot.parent,
                  renderer: final.play.snapshot.renderer,
                  font: final.play.snapshot.parentSnapshot.font,
                  mapping: final.play.snapshot.mapping,
                  mappingSha256: final.play.snapshot.mappingSha256,
                  display: display.value,
                },
              });
              // Pure assembly/hash work has finished. Observe this exact locked grant again before INSERT.
              await verifyLockedGrant(tx, a.key, a.session, a.locator);
              io.checkpoint();
              const report = await insertPersistedReport(
                tx,
                a.key,
                a.session,
                snapshot,
              );
              return observeConsumerCompletion(
                binding,
                a.state,
                report.receipt,
              );
            },
          );
        });
      });
    },
    resolveComplete(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(owner, "resolve-complete", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials),
          binding = parseConsumer(consumerCompleteBindingSchema, bindingValue);
        return c.sql(
          async (db, check) =>
            (
              await authorizedConsumerRead(
                db,
                check,
                digest,
                sessionId,
                async (tx, a) =>
                  observeConsumerCompletion(
                    binding,
                    a.state,
                    (await readPersistedReport(tx, a.state.session.keyId))
                      ?.receipt ?? null,
                  ),
              )
            ).value,
        );
      });
    },
    readReport(credentials, sessionInput) {
      return consumerServiceCall(owner, "read-report", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await consumerCredentialDigest(credentials);
        return c.sql(
          async (db, check) =>
            (
              await authorizedConsumerRead(
                db,
                check,
                digest,
                sessionId,
                async (tx, a) => {
                  const report = await readPersistedReport(
                    tx,
                    a.state.session.keyId,
                  );
                  if (!report) throw new ConsumerError("NOT_FOUND");
                  return verifyPersistedReportView({
                    receipt: report.receipt,
                    view: report.snapshot.view,
                  });
                },
              )
            ).value,
        );
      });
    },
    readResource(credentials, sessionInput, selectorValue) {
      return consumerServiceCall(owner, "read-resource", async (c) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await consumerCredentialDigest(credentials),
          selector = parseConsumer(
            consumerResourceSelectorSchema,
            selectorValue,
          );
        const before = await c.sql((db, check) =>
          authorizedConsumerRead(db, check, digest, sessionId, (tx, a) =>
            selectConsumerResource(tx, a, selector),
          ),
        );
        return c.io(async (io) => {
          const current = await authorizedConsumerRead(
            io.db,
            io.checkpoint,
            digest,
            sessionId,
            (tx, a) => selectConsumerResource(tx, a, selector),
          );
          if (
            !same(before.value, current.value) ||
            !same(before.authority.locator, current.authority.locator)
          )
            throw new ConsumerError("ACCESS_DENIED");
          const bytes = await readConsumerResourceIo(io, current.value);
          await reauthorizeConsumer(
            io.db,
            io.checkpoint,
            current.authority.locator,
            current.authority.state.session,
          );
          await io.guard.check();
          io.checkpoint();
          io.issueBody(bytes);
          return { bytes, mediaType: current.value.mediaType };
        });
      });
    },
    logout(credentials, sessionInput) {
      return consumerServiceCall(owner, "logout", async (c, observation) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials);
        await c.sql((db, check) =>
          consumerWrite(db, check, observation, async (tx) => {
            const a = await lockConsumerAuthority(tx, digest, sessionId);
            await revokeExactGrant(
              tx,
              a.key,
              a.session,
              a.grant,
              await consumerDatabaseMoment(tx),
            );
          }),
        );
      });
    },
  });
}
