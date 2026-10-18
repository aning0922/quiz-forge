import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import * as clients from "@/lib/db/client";
import * as privateResources from "@/features/quizpack/resource-read/storage";
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
} from "@/lib/consumer-contract/v1/state";
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
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
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

it("actual budget/CAS/report commits with lost results, NOWAIT rate limit and post-RR/post-file grant revocation", async () => {
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
  let openings = 0,
    closes = 0,
    nativeCommits = 0,
    loseNextWrite = false,
    afterRr: (() => Promise<void>) | undefined;
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
      operatorCredentials = {
        sessionToken: operator.raw,
        csrfToken: operator.dto.csrfToken,
        requestId: randomUUID(),
      },
      play = (
        await invoke((o) =>
          createInternalPlayService(o).create(
            operatorCredentials,
            fixture.productId,
            {
              schemaVersion: "quizforge.internal-play-create.v1",
              operationKey: randomUUID(),
              parent: {
                productId: fixture.productId,
                versionId: fixture.parent!.version.id,
                snapshotSha256: fixture.parent!.version.snapshotSha256,
              },
              renderer: fixture.consumerRenderer!,
            },
          ),
        )
      ).play,
      rawKey = createConsumerToken("access-key"),
      credentialDigest = (await digestConsumerToken(rawKey, "access-key"))!,
      key = (
        await invoke((o) =>
          createAccessKeyService(o).issue(
            operatorCredentials,
            fixture.productId,
            {
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
            },
          ),
        )
      ).key;
    const factory = clients.createObservedDatabase;
    vi.spyOn(clients, "createObservedDatabase").mockImplementation(
      async (...args) => {
        openings++;
        const actual = await factory(...args),
          nativeBegin = actual.sql.begin;
        // Preserve the exact observer-issued SQL object; replacing it is correctly rejected by the owner.
        actual.sql.begin = (async (...parameters: unknown[]) => {
          const result = await Reflect.apply(
            nativeBegin,
            actual.sql,
            parameters,
          );
          const isolation = String(parameters[0]);
          if (isolation.includes("repeatable read") && afterRr) {
            const run = afterRr;
            afterRr = undefined;
            await run();
          }
          if (isolation === "isolation level read committed" && loseNextWrite) {
            loseNextWrite = false;
            nativeCommits++;
            throw Object.assign(Error("P4_INJECTED_COMMITTED_RESULT_LOSS"), {
              code: "CONNECTION_CLOSED",
            });
          }
          return result;
        }) as typeof nativeBegin;
        return {
          ...actual,
          close: async () => {
            await actual.close();
            closes++;
          },
        };
      },
    );
    const budget = async () => {
      const [r] = await db.admin.sql<
        { window_index: string; used: number }[]
      >`SELECT window_index,used FROM qf.consumer_exchange_budget`;
      if (!r) throw Error("P4_BUDGET_REQUIRED");
      return r;
    };
    const before = await budget();
    openings = 0;
    closes = 0;
    await expect(
      invoke((o) => createConsumerFlowService(o).exchange("invalid")),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(openings === 0 && closes === 0).toBe(true);
    expect(JSON.stringify(await budget()) === JSON.stringify(before)).toBe(
      true,
    );
    // The real budget commits, then a wrapper loses only its returned result. No Key connection may follow.
    loseNextWrite = true;
    openings = 0;
    closes = 0;
    await expect(
      invoke((o) => createConsumerFlowService(o).exchange(rawKey)),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(openings === 1 && closes === 1 && nativeCommits === 1).toBe(true);
    const [unclaimed] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.consumer_session WHERE key_id=${key.issue.binding.keyId}) AS present`;
    expect(unclaimed?.present).toBe(false);
    const spent = await budget();
    expect(
      (spent.window_index === before.window_index &&
        spent.used === before.used + 1) ||
        (BigInt(spent.window_index) > BigInt(before.window_index) &&
          spent.used === 1),
    ).toBe(true);
    // Actual reserved budget row lock; nonwaiting rejection neither waits for the Key nor spends a unit.
    const started = deferred(),
      release = deferred(),
      held = db.admin.sql.begin(async (tx) => {
        await tx`SELECT singleton FROM qf.consumer_exchange_budget FOR UPDATE`;
        started.resolve();
        await release.promise;
      });
    await started.promise;
    openings = 0;
    closes = 0;
    try {
      await expect(
        invoke((o) => createConsumerFlowService(o).exchange(rawKey)),
      ).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(openings === 1 && closes === 1).toBe(true);
    } finally {
      release.resolve();
      await held;
    }
    expect(JSON.stringify(await budget()) === JSON.stringify(spent)).toBe(true);
    const grants: ConsumerFixtureObservations["grants"] = [];
    const enter = async () => {
      const x = await invoke((o) =>
          createConsumerFlowService(o).exchange(rawKey),
        ),
        token = x.cookieGrantToken,
        sessionId = x.result.session.sessionId,
        view = await invoke((o) =>
          createConsumerFlowService(o).readSession(
            { grantToken: token },
            sessionId,
          ),
        );
      grants.push({
        source: "verified-bootstrap-and-cookie-digest",
        grantId: view.grant.grantId,
        session: view.grant.session,
        credentialDigest: (await digestConsumerToken(token, "grant"))!,
        issuedAt: view.grant.issuedAt,
        expiresAt: view.grant.expiresAt,
        logoutObserved: false,
      });
      return {
        sessionId,
        view,
        credentials: {
          grantToken: token,
          csrfToken: view.grant.csrf,
          requestId: randomUUID(),
        },
      };
    };
    const a = await enter();
    if (!("state" in a.view.outcome)) throw Error("P4_STATE_REQUIRED");
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
      input = {
        binding: {
          schemaVersion: "quizforge.consumer-save.v1" as const,
          session: a.view.outcome.state.session,
          expectedStateRevision: 0,
          consumerStateAnswersSha256: await consumerAnswersSha256(answers),
          progressSha256: await consumerProgressSha256(progress),
        },
        answers,
        progress,
      };
    loseNextWrite = true;
    openings = 0;
    closes = 0;
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, input),
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(openings === 1 && closes === 1 && nativeCommits === 2).toBe(true);
    const saved = await invoke((o) =>
      createConsumerFlowService(o).resolveSave(
        a.credentials,
        a.sessionId,
        input.binding,
      ),
    );
    if (!("state" in saved)) throw Error("P4_STATE_REQUIRED");
    expect(saved.kind).toBe("applied-current");
    const state = saved.state;
    const binding = {
      schemaVersion: "quizforge.consumer-complete.v1" as const,
      session: state.session,
      expectedStateRevision: state.stateRevision,
      consumerStateAnswersSha256: state.consumerStateAnswersSha256,
      progressSha256: state.progressSha256,
      completionKey: randomUUID(),
    };
    loseNextWrite = true;
    openings = 0;
    closes = 0;
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).complete(
          a.credentials,
          a.sessionId,
          binding,
        ),
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(openings === 2 && closes === 2 && nativeCommits === 3).toBe(true);
    const resolved = await invoke((o) =>
      createConsumerFlowService(o).resolveComplete(
        a.credentials,
        a.sessionId,
        binding,
      ),
    );
    expect(resolved.kind).toBe("applied");
    const report = await invoke((o) =>
      createConsumerFlowService(o).readReport(a.credentials, a.sessionId),
    );
    // Revoke only after the real RR snapshot has ended; a second observation in that RR would be stale.
    afterRr = async () => {
      await invoke((o) =>
        createConsumerFlowService(o).logout(a.credentials, a.sessionId),
      );
      grants.find((g) => g.grantId === a.view.grant.grantId)!.logoutObserved =
        true;
    };
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).readSession(a.credentials, a.sessionId),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    expect(afterRr === undefined).toBe(true);
    const b = await enter(),
      nativeRead = privateResources.readPrivateResource;
    let readCalls = 0;
    const readSpy = vi
      .spyOn(privateResources, "readPrivateResource")
      .mockImplementation(async (...args) => {
        const bytes = await nativeRead(...args);
        readCalls++;
        await invoke((o) =>
          createConsumerFlowService(o).logout(b.credentials, b.sessionId),
        );
        grants.find((g) => g.grantId === b.view.grant.grantId)!.logoutObserved =
          true;
        return bytes;
      });
    try {
      const asset = report.view.display.result.portrait;
      await expect(
        invoke((o) =>
          createConsumerFlowService(o).readResource(
            b.credentials,
            b.sessionId,
            {
              resourceId: asset.resourceRef.id,
              resourceVersion: asset.resourceRef.version,
              sha256: asset.sha256,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
      expect(readCalls).toBe(1);
    } finally {
      readSpy.mockRestore();
    }
    // Distinct test attempts consume the real permanent fixed-window budget. Never reset/refund its row.
    const invalid = createConsumerToken("access-key");
    let limited = false;
    for (let n = 0; n < 121; n++) {
      try {
        await invoke((o) => createConsumerFlowService(o).exchange(invalid));
        throw Error("P4_INVALID_KEY_ACCEPTED");
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "RATE_LIMITED") {
          limited = true;
          break;
        }
        if (code !== "ACCESS_DENIED") throw error;
      }
    }
    expect(limited).toBe(true);
    expect((await budget()).used).toBe(60);
    const latest = await invoke((o) =>
      createAccessKeyService(o).read(
        operator.raw,
        fixture.productId,
        key.issue.binding.keyId,
      ),
    );
    await finishConsumerFixture(db, runId, {
      schemaVersion: "quizforge.consumer-fixture-observations.v1",
      instanceId: db.config.instanceId,
      runId,
      productId: fixture.productId,
      mode: "operator-services",
      suiteCompletion: null,
      plays: [play],
      keys: [latest],
      states: [state],
      reports: [report.receipt],
      grants,
    });
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
}, 180000);
