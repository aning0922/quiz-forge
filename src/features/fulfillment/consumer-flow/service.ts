import {
  consumerPolicyOutcome,
  observePolicySave as observeConsumerSave,
  observePolicyCompletion as observeConsumerCompletion,
} from "./policy-resolution";
import {
  exchangePolicyAttempt,
  revokePolicyGrant,
} from "../consumer-session/policy-repository";
import {
  decodeConsumerSessionRow,
  type SessionRow,
} from "../consumer-session/repository";
import { locateGrant } from "../access/repository";
import { projectConsumerCompletion } from "./result";
import { verifyPersistedReportSnapshotV2 } from "@/features/report/persisted/snapshot-contract-v2";
import { consumerCompleteBindingSha256V2 } from "@/lib/consumer-contract/v2/state";
import {
  currentSaveInputSchema as consumerSaveInputSchema,
  currentSaveBindingSchema as consumerSaveBindingSchema,
  currentCompleteBindingSchema as consumerCompleteBindingSchema,
  verifyCurrentSaveInput as verifyConsumerSaveInput,
  verifyCurrentReportView as verifyPersistedReportView,
} from "./current-wire";
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
import { consumerCompleteBindingSha256 } from "@/features/report/persisted/view-contracts";
import { verifyPersistedReportSnapshot } from "@/features/report/persisted/snapshot-contract";
import {
  readPersistedReport,
  insertPersistedReport,
} from "@/features/report/persisted/repository";
import {
  reserveConsumerExchange,
  verifyLockedGrant,
} from "../access/repository";
import { saveConsumerSession } from "../consumer-session/repository";
import type { ConsumerTx } from "@/lib/db/consumer-transaction";
import type { DisplayAssetV2 as DisplayAssetV1 } from "@/lib/assessment-contract/display-v2";
import type { ConsumerRequestOwner } from "./request-owner";
import type { ConsumerFlowService } from "./service-contract";
import {
  consumerServiceCall,
  consumerWrite,
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
  assertCurrentConsumerAttempt,
  assertConsumerContentAuthority,
  reauthorizeConsumer,
  type ConsumerAuthority,
} from "./authorization";
import { verifyCurrentSessionView } from "./current-contracts";
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
  await assertConsumerContentAuthority(tx, authority);
  const report = await readPersistedReport(tx, authority.state.session.keyId);
  let assets: readonly DisplayAssetV1[];
  if (report)
    assets =
      report.snapshot.view.display.contentSchemaVersion ===
      "quizpack-content.v3"
        ? report.snapshot.view.display.assets
        : [report.snapshot.view.display.result.portrait];
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
            const [scope] = await tx.sql<
              { product_id: string }[]
            >`SELECT product_id FROM qf.access_key WHERE credential_digest=${digest}`;
            if (!scope) throw new ConsumerError("ACCESS_DENIED");
            const result = await exchangePolicyAttempt(tx, {
              productId: scope.product_id,
              keyDigest: digest,
              freshGrantId: randomUUID(),
              freshDigest: grantDigest,
            });
            const state = await decodeConsumerSessionRow(
              tx,
              result.session as SessionRow,
            );
            return consumerExchangeResultSchema.parse({
              schemaVersion: "quizforge.consumer-exchange.v1",
              session: state.session,
              destination: result.destination,
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
                  if (!report && !consumerPolicyOutcome(a, null))
                    assertCurrentConsumerAttempt(a.policy);
                  return verifyCurrentSessionView(
                    {
                      schemaVersion:
                        a.state.schemaVersion === "quizforge.consumer-state.v2"
                          ? "quizforge.consumer-session-view.v2"
                          : "quizforge.consumer-session-view.v1",
                      grant: {
                        grantId: a.grant.grantId,
                        session: a.state.session,
                        issuedAt: a.grant.issuedAt,
                        expiresAt: a.grant.expiresAt,
                        csrf,
                      },
                      observedAt: a.at,
                      keyExpiresAt: a.key.issue.expiresAt,
                      outcome:
                        consumerPolicyOutcome(a, report?.receipt ?? null) ??
                        (report
                          ? { kind: "completed", report: report.receipt }
                          : {
                              kind:
                                a.key.issue.expiresAt <= a.at
                                  ? "expired"
                                  : "editable",
                              state: a.state,
                            }),
                    },
                    sessionId,
                    a.state,
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
              await assertConsumerContentAuthority(tx, a);
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
              await assertConsumerContentAuthority(tx, a);
              return readConsumerExecutionSource(tx, a.state);
            },
          );
          assertSameExecution(before.value, current.value);
          await verifyConsumerExecutionIo(
            io,
            current.value.play.snapshot.parentSnapshot,
            current.value.play.snapshot.renderer,
            current.value.source,
            current.value.play.snapshot.schemaVersion ===
              "quizforge.internal-play-snapshot.v2"
              ? current.value.play.snapshot.presentation
              : undefined,
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
            true,
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
                a,
                report?.receipt ?? null,
                true,
              );
            if (observed.kind !== "unresolved") return observed;
            assertCurrentConsumerAttempt(a.policy);
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
              a.grant,
              input,
            );
            return observeConsumerSave(
              input.binding,
              { ...a, state },
              null,
              true,
            );
          }),
        );
      });
    },
    resolveSave(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(
        owner,
        "resolve-save",
        async (c, observation) => {
          const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
            digest = await assertConsumerWriteCredentials(credentials),
            binding = parseConsumer(consumerSaveBindingSchema, bindingValue);
          // Lock-only READ COMMITTED barrier: any earlier writer must settle before absence is definitive.
          return c.sql((db, check) =>
            consumerWrite(db, check, observation, async (tx) => {
              const a = await lockConsumerAuthority(tx, digest, sessionId);
              return observeConsumerSave(
                binding,
                a,
                (await readPersistedReport(tx, a.state.session.keyId))
                  ?.receipt ?? null,
                true,
              );
            }),
          );
        },
      );
    },
    complete(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(owner, "complete", async (c, observation) => {
        const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
          digest = await assertConsumerWriteCredentials(credentials),
          binding = parseConsumer(consumerCompleteBindingSchema, bindingValue);
        const precheck = async (tx: ConsumerTx, a: ConsumerAuthority) => {
          const observed = await observeConsumerCompletion(
            binding,
            a,
            (await readPersistedReport(tx, a.state.session.keyId))?.receipt ??
              null,
          );
          if (observed.kind !== "unresolved")
            return { kind: "observed" as const, observed };
          assertCurrentConsumerAttempt(a.policy);
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
            execution.play.snapshot.schemaVersion ===
              "quizforge.internal-play-snapshot.v2"
              ? execution.play.snapshot.presentation
              : undefined,
          );
          return consumerWrite(
            io.db,
            io.checkpoint,
            observation,
            async (tx) => {
              const a = await lockConsumerAuthority(tx, digest, sessionId),
                observed = await observeConsumerCompletion(
                  binding,
                  a,
                  (await readPersistedReport(tx, a.state.session.keyId))
                    ?.receipt ?? null,
                  true,
                );
              if (observed.kind !== "unresolved") return observed;
              assertCurrentConsumerAttempt(a.policy);
              assertActiveConsumerKey(a.key, a.at);
              const final = await readConsumerExecutionSource(tx, a.state);
              assertSameExecution(execution, final);
              validateConsumerMembers(final.source, a.state, true);
              // Resolve exact identities again, while executing only the already verified fixed pure handle.
              fixedConsumerExecution(
                final.play.snapshot.parentSnapshot,
                final.play.snapshot.renderer,
                final.source,
                final.play.snapshot.schemaVersion ===
                  "quizforge.internal-play-snapshot.v2"
                  ? final.play.snapshot.presentation
                  : undefined,
              );
              io.checkpoint();
              const projected = projectConsumerCompletion(
                fixed,
                final,
                a.state,
              );
              await verifyLockedGrant(tx, a.key, a.session, a.locator);
              const completedAt = await consumerDatabaseMoment(tx);
              assertActiveConsumerKey(a.key, completedAt);
              const snapshotInput = {
                schemaVersion:
                  projected.version === 2
                    ? "quizforge.consumer-report-snapshot.v2"
                    : "quizforge.consumer-report-snapshot.v1",
                binding,
                play: final.play,
                answers: a.state.answers,
                progress: a.state.progress,
                score: projected.score,
                ...(a.state.schemaVersion === "quizforge.consumer-state.v2"
                  ? { matchingContext: a.state.matchingContext }
                  : {}),
                view: {
                  schemaVersion:
                    projected.version === 2
                      ? "quizforge.consumer-report-display.v2"
                      : "quizforge.consumer-report-display.v1",
                  reportId: randomUUID(),
                  session: a.state.session,
                  completedAt,
                  completionBindingSha256:
                    projected.version === 2
                      ? await consumerCompleteBindingSha256V2(binding)
                      : await consumerCompleteBindingSha256(binding),
                  parent: final.play.snapshot.parent,
                  renderer: final.play.snapshot.renderer,
                  font: final.play.snapshot.parentSnapshot.font,
                  mapping: final.play.snapshot.mapping,
                  mappingSha256: final.play.snapshot.mappingSha256,
                  display: projected.display,
                },
              };
              const snapshot =
                projected.version === 2
                  ? await verifyPersistedReportSnapshotV2(snapshotInput)
                  : await verifyPersistedReportSnapshot(snapshotInput);
              // Pure assembly/hash work has finished. Observe this exact locked grant again before INSERT.
              await verifyLockedGrant(tx, a.key, a.session, a.locator);
              io.checkpoint();
              const report = await insertPersistedReport(
                tx,
                a.key,
                a.session,
                a.grant,
                snapshot,
              );
              return observeConsumerCompletion(
                binding,
                a,
                report.receipt,
                true,
              );
            },
          );
        });
      });
    },
    resolveComplete(credentials, sessionInput, bindingValue) {
      return consumerServiceCall(
        owner,
        "resolve-complete",
        async (c, observation) => {
          const sessionId = parseConsumer(consumerUuidSchema, sessionInput),
            digest = await assertConsumerWriteCredentials(credentials),
            binding = parseConsumer(
              consumerCompleteBindingSchema,
              bindingValue,
            );
          // Lock-only READ COMMITTED barrier: any earlier writer must settle before absence is definitive.
          return c.sql((db, check) =>
            consumerWrite(db, check, observation, async (tx) => {
              const a = await lockConsumerAuthority(tx, digest, sessionId);
              return observeConsumerCompletion(
                binding,
                a,
                (await readPersistedReport(tx, a.state.session.keyId))
                  ?.receipt ?? null,
                true,
              );
            }),
          );
        },
      );
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
                  assertConsumerSessionBinding(
                    a.state.session,
                    report.receipt.binding.session,
                  );
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
            true,
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
            const locator = await locateGrant(tx, digest);
            if (!locator || locator.sessionId !== sessionId)
              throw new ConsumerError("ACCESS_DENIED");
            const [scope] = await tx.sql<
              { product_id: string }[]
            >`SELECT product_id FROM qf.consumer_session WHERE id=${sessionId} AND key_id=${locator.keyId}`;
            if (!scope) throw new ConsumerError("ACCESS_DENIED");
            await revokePolicyGrant(tx, {
              productId: scope.product_id,
              keyId: locator.keyId,
              sessionId,
              grantId: locator.grantId,
              credentialDigest: digest,
            });
          }),
        );
      });
    },
  });
}
