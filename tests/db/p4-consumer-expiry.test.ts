import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createPreauth, login } from "@/lib/auth/service";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createConsumerFlowService } from "@/features/fulfillment/consumer-flow/service";
import { createInternalPlayService } from "@/features/product/internal-play/service";
import { createAccessKeyService } from "@/features/fulfillment/access/service";
import {
  createConsumerToken,
  digestConsumerToken,
} from "@/lib/consumer-contract/v1/credentials";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import * as integrity from "@/lib/consumer-contract/v1/integrity";
import * as reportContracts from "@/features/report/persisted/snapshot-contract";
import { verifyConsumerSchema } from "@/lib/db/consumer-schema";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { configureImports } from "@/features/quizpack/import/config-management";
import { openTestDatabase } from "./p2a-fixture";
import {
  readConsumerFixture,
  finishConsumerFixture,
  cleanupConsumerFixture,
} from "./p4-consumer-fixture";
import type { ConsumerFixtureObservations } from "./p4-consumer-fixture-contract";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
} from "../support/p3c-server-owner";

const exec = promisify(execFile);
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") return reject(Error("P4_PORT_REQUIRED"));
      s.close((e) => (e ? reject(e) : resolve(a.port)));
    });
  });
it("actual DB-clock deadlines crossed during post-authorization hashes prevent both save and report writes", async () => {
  const db = await openTestDatabase(),
    runId = randomUUID();
  const invoke = async <T>(
    work: (o: ReturnType<typeof createConsumerRequestOwner>) => Promise<T>,
  ) => {
    const o = createConsumerRequestOwner(
      db.config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      return await work(o);
    } finally {
      await o.closeIfNotTransferred();
    }
  };
  try {
    await configureImports(db.config.instanceId, false);
    await exec(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "tests/db/p4-consumer-fixture.ts",
        "prepare",
        runId,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TSX_TSCONFIG_PATH: path.join(process.cwd(), "tsconfig.json"),
        },
        timeout: 90000,
        maxBuffer: 8192,
      },
    );
    const fixture = await readConsumerFixture(db, runId),
      pre = await createPreauth(db.app, null, randomUUID()),
      operator = await login(
        db.app,
        pre.raw,
        pre.dto.csrfToken,
        fixture.operator.secret,
        randomUUID(),
      ),
      credentials = {
        sessionToken: operator.raw,
        csrfToken: operator.dto.csrfToken,
        requestId: randomUUID(),
      },
      play = (
        await invoke((o) =>
          createInternalPlayService(o).create(credentials, fixture.productId, {
            schemaVersion: "quizforge.internal-play-create.v1",
            operationKey: randomUUID(),
            parent: {
              productId: fixture.productId,
              versionId: fixture.parent!.version.id,
              snapshotSha256: fixture.parent!.version.snapshotSha256,
            },
            renderer: fixture.consumerRenderer!,
          }),
        )
      ).play;
    const content = JSON.parse(
        await readFile(
          new URL("../fixtures/p4-baseline/content.json", import.meta.url),
          "utf8",
        ),
      ) as { questions: { id: string; options: { id: string }[] }[] },
      answers = content.questions.map((q) => ({
        questionId: q.id,
        optionId: q.options[0]!.id,
      })),
      progress = { questionId: null },
      observations: ConsumerFixtureObservations = {
        schemaVersion: "quizforge.consumer-fixture-observations.v1",
        instanceId: db.config.instanceId,
        runId,
        productId: fixture.productId,
        mode: "operator-services",
        suiteCompletion: null,
        plays: [play],
        keys: [],
        states: [],
        reports: [],
        grants: [],
      };
    const keyIds: string[] = [],
      states = new Map<string, ConsumerState>(),
      grants = new Map<string, ConsumerFixtureObservations["grants"][number]>();
    const enter = async (raw: string) => {
      const x = await invoke((o) => createConsumerFlowService(o).exchange(raw)),
        token = x.cookieGrantToken,
        sessionId = x.result.session.sessionId,
        view = await invoke((o) =>
          createConsumerFlowService(o).readSession(
            { grantToken: token },
            sessionId,
          ),
        );
      return {
        raw,
        token,
        sessionId,
        view,
        credentials: {
          grantToken: token,
          csrfToken: view.grant.csrf,
          requestId: randomUUID(),
        },
      };
    };
    const record = async (a: Awaited<ReturnType<typeof enter>>) => {
      const view = await invoke((o) =>
        createConsumerFlowService(o).readSession(a.credentials, a.sessionId),
      );
      grants.set(view.grant.grantId, {
        source: "verified-bootstrap-and-cookie-digest",
        grantId: view.grant.grantId,
        session: view.grant.session,
        credentialDigest: (await digestConsumerToken(a.token, "grant"))!,
        issuedAt: view.grant.issuedAt,
        expiresAt: view.grant.expiresAt,
        logoutObserved: false,
      });
      if ("state" in view.outcome) states.set(a.sessionId, view.outcome.state);
      return view;
    };
    const issue = async () => {
      const raw = createConsumerToken("access-key"),
        credentialDigest = (await digestConsumerToken(raw, "access-key"))!,
        key = (
          await invoke((o) =>
            createAccessKeyService(o).issue(credentials, fixture.productId, {
              schemaVersion: "quizforge.access-key-issue.v1",
              operationKey: randomUUID(),
              keyId: randomUUID(),
              play: {
                productId: fixture.productId,
                playVersionId: play.id,
                playSnapshotSha256: play.snapshotSha256,
              },
              credentialDigest,
              validForSeconds: 86400,
            }),
          )
        ).key;
      keyIds.push(key.issue.binding.keyId);
      const a = await enter(raw);
      if (!("state" in a.view.outcome)) throw Error("P4_STATE_REQUIRED");
      const state = a.view.outcome.state,
        input = {
          binding: {
            schemaVersion: "quizforge.consumer-save.v1" as const,
            session: state.session,
            expectedStateRevision: state.stateRevision,
            consumerStateAnswersSha256: await consumerAnswersSha256(answers),
            progressSha256: await consumerProgressSha256(progress),
          },
          answers,
          progress,
        };
      await invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, input),
      );
      return a;
    };
    // Controlled synthetic timestamps only: disable/update/enable the SAME named trigger inside one owner TX
    // under exclusive maintenance. No application can observe disabled committed schema or renew a real Key.
    const seed = async (
      a: Awaited<ReturnType<typeof enter>>,
      kind: "key" | "grant",
      milliseconds: number,
    ) => {
      const lock = await StorageLock.acquire(db.config);
      try {
        await db.admin.sql.begin(async (tx) => {
          const [time] = await tx<
            { at: string }[]
          >`SELECT qf.consumer_moment(date_trunc('milliseconds',clock_timestamp())) AS at`;
          if (!time) throw Error("P4_CLOCK_REQUIRED");
          await tx`ALTER TABLE qf.access_key DISABLE TRIGGER consumer_key_change`;
          if (kind === "key")
            await tx`UPDATE qf.access_key SET expires_at=${time.at}::timestamptz+${milliseconds}*interval '1 millisecond',issued_at=${time.at}::timestamptz+${milliseconds}*interval '1 millisecond'-valid_for_seconds*interval '1 second' WHERE id=${a.view.grant.session.keyId}`;
          else
            await tx`UPDATE qf.access_key SET issued_at=${time.at}::timestamptz-interval '9 hours',expires_at=${time.at}::timestamptz-interval '9 hours'+valid_for_seconds*interval '1 second' WHERE id=${a.view.grant.session.keyId}`;
          await tx`ALTER TABLE qf.access_key ENABLE TRIGGER consumer_key_change`;
          if (kind === "grant") {
            await tx`ALTER TABLE qf.consumer_session DISABLE TRIGGER consumer_session_change`;
            await tx`UPDATE qf.consumer_session SET created_at=${time.at}::timestamptz-interval '8 hours 5 minutes' WHERE id=${a.sessionId}`;
            await tx`ALTER TABLE qf.consumer_session ENABLE TRIGGER consumer_session_change`;
            await tx`ALTER TABLE qf.consumer_grant DISABLE TRIGGER consumer_grant_change`;
            await tx`UPDATE qf.consumer_grant SET expires_at=${time.at}::timestamptz+${milliseconds}*interval '1 millisecond',issued_at=${time.at}::timestamptz+${milliseconds}*interval '1 millisecond'-interval '8 hours' WHERE grant_id=${a.view.grant.grantId} AND session_id=${a.sessionId}`;
            await tx`ALTER TABLE qf.consumer_grant ENABLE TRIGGER consumer_grant_change`;
          }
        });
      } finally {
        if (!(await lock.close())) throw Error("P4_MAINTENANCE_CLOSE_UNKNOWN");
      }
      // Reverify the exact committed trigger/catalog definitions before any application observation.
      await verifyConsumerSchema(db.app.sql);
      return record(a);
    };
    for (const operation of ["save", "complete"] as const)
      for (const kind of ["grant", "key"] as const) {
        const a = await issue(),
          view = await seed(a, kind, 1600);
        if (!("state" in view.outcome)) throw Error("P4_STATE_REQUIRED");
        const state = view.outcome.state;
        const deadline =
          kind === "grant" ? view.grant.expiresAt : view.keyExpiresAt;
        let calls = 0,
          crossed = false;
        const pause = async () => {
          calls++;
          const [before] = await db.admin.sql<
            { expired: boolean }[]
          >`SELECT clock_timestamp()>=${deadline}::timestamptz AS expired`;
          expect(before?.expired).toBe(false);
          await delay(1850);
          const [after] = await db.admin.sql<
            { expired: boolean }[]
          >`SELECT clock_timestamp()>=${deadline}::timestamptz AS expired`;
          crossed = after?.expired === true;
        };
        const realReportHash = reportContracts.persistedReportSnapshotSha256,
          realTextHash = integrity.consumerTextSha256;
        const reportSpy = vi
          .spyOn(reportContracts, "persistedReportSnapshotSha256")
          .mockImplementation(async (input) => {
            const result = await realReportHash(input);
            if (operation === "complete" && calls === 0) await pause();
            return result;
          });
        const saveSpy = vi
          .spyOn(integrity, "consumerTextSha256")
          .mockImplementation(async (text) => {
            const result = await realTextHash(text);
            if (
              operation === "save" &&
              calls === 0 &&
              text.includes('"quizforge.consumer-save-receipt.v1"') &&
              JSON.parse(text).binding.expectedStateRevision ===
                state.stateRevision
            )
              await pause();
            return result;
          });
        try {
          if (operation === "save") {
            const input = {
              binding: {
                schemaVersion: "quizforge.consumer-save.v1" as const,
                session: state.session,
                expectedStateRevision: state.stateRevision,
                consumerStateAnswersSha256: state.consumerStateAnswersSha256,
                progressSha256: state.progressSha256,
              },
              answers: state.answers,
              progress: state.progress,
            };
            await expect(
              invoke((o) =>
                createConsumerFlowService(o).save(
                  a.credentials,
                  a.sessionId,
                  input,
                ),
              ),
            ).rejects.toMatchObject({
              code: kind === "grant" ? "ACCESS_DENIED" : "KEY_NOT_ACTIVE",
            });
          } else {
            const binding = {
              schemaVersion: "quizforge.consumer-complete.v1" as const,
              session: state.session,
              expectedStateRevision: state.stateRevision,
              consumerStateAnswersSha256: state.consumerStateAnswersSha256,
              progressSha256: state.progressSha256,
              completionKey: randomUUID(),
            };
            await expect(
              invoke((o) =>
                createConsumerFlowService(o).complete(
                  a.credentials,
                  a.sessionId,
                  binding,
                ),
              ),
            ).rejects.toMatchObject({
              code: kind === "grant" ? "ACCESS_DENIED" : "KEY_NOT_ACTIVE",
            });
          }
        } finally {
          reportSpy.mockRestore();
          saveSpy.mockRestore();
        }
        expect(calls === 1 && crossed).toBe(true);
        const [actual] = await db.admin.sql<
          { revision: number; report: boolean }[]
        >`SELECT state_revision AS revision,EXISTS(SELECT 1 FROM qf.quiz_report WHERE key_id=${state.session.keyId}) AS report FROM qf.consumer_session WHERE id=${a.sessionId}`;
        expect(
          actual?.revision === state.stateRevision && actual.report === false,
        ).toBe(true);
        if (kind === "grant") {
          await expect(
            invoke((o) =>
              createConsumerFlowService(o).readSession(
                a.credentials,
                a.sessionId,
              ),
            ),
          ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
          await record(await enter(a.raw));
        } else {
          const expired = await record(a);
          expect(expired.outcome.kind).toBe("expired");
          await expect(
            invoke((o) => createConsumerFlowService(o).exchange(a.raw)),
          ).rejects.toMatchObject({ code: "KEY_NOT_ACTIVE" });
        }
      }
    // A real already-completed report stays available after a controlled Key expiry, without rescoring.
    const a = await issue(),
      view = await record(a);
    if (!("state" in view.outcome)) throw Error("P4_STATE_REQUIRED");
    const state = view.outcome.state;
    const completed = await invoke((o) =>
      createConsumerFlowService(o).complete(a.credentials, a.sessionId, {
        schemaVersion: "quizforge.consumer-complete.v1",
        session: state.session,
        expectedStateRevision: state.stateRevision,
        consumerStateAnswersSha256: state.consumerStateAnswersSha256,
        progressSha256: state.progressSha256,
        completionKey: randomUUID(),
      }),
    );
    if (!("report" in completed)) throw Error("P4_REPORT_REQUIRED");
    observations.reports.push(completed.report);
    await seed(a, "key", 350);
    await delay(500);
    const again = await enter(a.raw);
    expect(again.view.outcome.kind).toBe("completed");
    await record(again);
    const report = await invoke((o) =>
      createConsumerFlowService(o).readReport(
        again.credentials,
        again.sessionId,
      ),
    );
    expect(
      report.receipt.reportSnapshotSha256 ===
        completed.report.reportSnapshotSha256,
    ).toBe(true);
    observations.keys = await Promise.all(
      keyIds.map((id) =>
        invoke((o) =>
          createAccessKeyService(o).read(operator.raw, fixture.productId, id),
        ),
      ),
    );
    observations.states = [...states.values()];
    observations.grants = [...grants.values()];
    await finishConsumerFixture(db, runId, observations);
    const server = await launchOwnedPreviewNodeProcess(
      {
        cwd: process.cwd(),
        instanceId: db.config.instanceId,
        runId,
        port: await freePort(),
        runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
      },
      ["-e", "setInterval(()=>{},1000)"],
    );
    await cleanupConsumerFixture(
      db,
      runId,
      await stopAndProveServerExit(server),
    );
  } finally {
    vi.restoreAllMocks();
    await db.close();
  }
}, 120000);
