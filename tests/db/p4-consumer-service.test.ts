import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "node:net";
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
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
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { blobPath } from "@/features/quizpack/import/storage";
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
const saveInput = async (
  state: ConsumerState,
  answers = state.answers,
  progress = state.progress,
) => ({
  binding: {
    schemaVersion: "quizforge.consumer-save.v1" as const,
    session: state.session,
    expectedStateRevision: state.stateRevision,
    consumerStateAnswersSha256: await consumerAnswersSha256(answers),
    progressSha256: await consumerProgressSha256(progress),
  },
  answers,
  progress,
});

it("actual consumer grants, CAS races, immutable completion, scoped resource stream and exact logout", async () => {
  const db = await openTestDatabase(),
    runId = randomUUID();
  const invoke = async <T>(
    work: (owner: ReturnType<typeof createConsumerRequestOwner>) => Promise<T>,
  ) => {
    const owner = createConsumerRequestOwner(
      db.config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      return await work(owner);
    } finally {
      await owner.closeIfNotTransferred();
    }
  };
  try {
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
      created = await invoke((o) =>
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
      );
    const issue = async () => {
      const raw = createConsumerToken("access-key"),
        credentialDigest = (await digestConsumerToken(raw, "access-key"))!,
        issued = await invoke((o) =>
          createAccessKeyService(o).issue(
            { ...credentials, requestId: randomUUID() },
            fixture.productId,
            {
              schemaVersion: "quizforge.access-key-issue.v1",
              operationKey: randomUUID(),
              keyId: randomUUID(),
              play: {
                productId: fixture.productId,
                playVersionId: created.play.id,
                playSnapshotSha256: created.play.snapshotSha256,
              },
              credentialDigest,
              validForSeconds: 3600,
            },
          ),
        );
      return { raw, key: issued.key };
    };
    const first = await issue(),
      second = await issue(),
      unused = await issue(),
      grants: ConsumerFixtureObservations["grants"] = [];
    const exchange = async (raw: string) => {
      const x = await invoke((o) => createConsumerFlowService(o).exchange(raw)),
        view = await invoke((o) =>
          createConsumerFlowService(o).readSession(
            { grantToken: x.cookieGrantToken },
            x.result.session.sessionId,
          ),
        );
      grants.push({
        source: "verified-bootstrap-and-cookie-digest",
        grantId: view.grant.grantId,
        session: view.grant.session,
        credentialDigest: (await digestConsumerToken(
          x.cookieGrantToken,
          "grant",
        ))!,
        issuedAt: view.grant.issuedAt,
        expiresAt: view.grant.expiresAt,
        logoutObserved: false,
      });
      return {
        view,
        credentials: {
          grantToken: x.cookieGrantToken,
          csrfToken: view.grant.csrf,
          requestId: randomUUID(),
        },
        sessionId: x.result.session.sessionId,
      };
    };
    const a = await exchange(first.raw),
      b = await exchange(second.raw);
    if (!("state" in a.view.outcome) || !("state" in b.view.outcome))
      throw Error("P4_EDITABLE_REQUIRED");
    let state = a.view.outcome.state;
    expect(state.stateRevision === 0 && state.answers.length === 0).toBe(true);
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).readSession(b.credentials, a.sessionId),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(
      invoke(async (o) =>
        createConsumerFlowService(o).save(
          { ...a.credentials, csrfToken: b.credentials.csrfToken },
          a.sessionId,
          await saveInput(state),
        ),
      ),
    ).rejects.toMatchObject({ code: "CSRF_REJECTED" });
    const entry = await invoke((o) =>
      createConsumerFlowService(o).readEntry(a.credentials, a.sessionId),
    );
    expect(
      entry.facts.entry.assets.every(
        (asset) => asset.purpose !== ("portrait" as string),
      ),
    ).toBe(true);
    const content = JSON.parse(
      await readFile(
        new URL("../fixtures/p4-baseline/content.json", import.meta.url),
        "utf8",
      ),
    ) as {
      questions: { id: string; options: { id: string }[] }[];
      resources: {
        id: string;
        version: string;
        sha256: string;
        purpose: string;
      }[];
    };
    const portrait = content.resources.find((r) => r.purpose === "portrait")!;
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).readResource(a.credentials, a.sessionId, {
          resourceId: portrait.id,
          resourceVersion: portrait.version,
          sha256: portrait.sha256,
        }),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const resource = async (
      asset: { resourceRef: { id: string; version: string }; sha256: string },
      auth = a,
    ) =>
      invoke(async (o) => {
        const result = await createConsumerFlowService(o).readResource(
            auth.credentials,
            auth.sessionId,
            {
              resourceId: asset.resourceRef.id,
              resourceVersion: asset.resourceRef.version,
              sha256: asset.sha256,
            },
          ),
          reader = o.resourceBody(result.bytes).getReader(),
          hash = createHash("sha256");
        let bytes = 0;
        for (;;) {
          const r = await reader.read();
          if (r.done) break;
          hash.update(r.value);
          bytes += r.value.length;
        }
        return { sha256: hash.digest("hex"), bytes };
      });
    expect(
      (await resource(entry.facts.entry.assets[0]!)).sha256 ===
        entry.facts.entry.assets[0]!.sha256,
    ).toBe(true);
    const bad = await saveInput(state, [
      { questionId: content.questions[0]!.id, optionId: "not-an-option" },
    ]);
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, bad),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ANSWERS" });
    const q = content.questions[0]!,
      left = await saveInput(
        state,
        [{ questionId: q.id, optionId: q.options[0]!.id }],
        { questionId: q.id },
      ),
      right = await saveInput(
        state,
        [{ questionId: q.id, optionId: q.options[1]!.id }],
        { questionId: q.id },
      );
    const raced = await Promise.all([
      invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, left),
      ),
      invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, right),
      ),
    ]);
    expect(
      raced.filter((r) => r.kind === "applied-current").length === 1 &&
        raced.filter((r) => r.kind === "superseded").length === 1,
    ).toBe(true);
    const observed = await invoke((o) =>
      createConsumerFlowService(o).readSession(a.credentials, a.sessionId),
    );
    if (!("state" in observed.outcome)) throw Error("P4_STATE_REQUIRED");
    state = observed.outcome.state;
    const incomplete = {
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
          incomplete,
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_ANSWERS" });
    const noop = await saveInput(state),
      same = await invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, noop),
      );
    if (!("state" in same)) throw Error("P4_STATE_REQUIRED");
    expect(
      same.kind === "applied-current" &&
        same.state.stateRevision === state.stateRevision + 1,
    ).toBe(true);
    state = same.state;
    expect(
      (
        await invoke((o) =>
          createConsumerFlowService(o).resolveSave(
            a.credentials,
            a.sessionId,
            left.binding,
          ),
        )
      ).kind,
    ).toBe("superseded");
    const full = await saveInput(
        state,
        content.questions.map((q) => ({
          questionId: q.id,
          optionId: q.options[0]!.id,
        })),
        { questionId: null },
      ),
      saved = await invoke((o) =>
        createConsumerFlowService(o).save(a.credentials, a.sessionId, full),
      );
    if (!("state" in saved)) throw Error("P4_STATE_REQUIRED");
    state = saved.state;
    const complete = {
      schemaVersion: "quizforge.consumer-complete.v1" as const,
      session: state.session,
      expectedStateRevision: state.stateRevision,
      consumerStateAnswersSha256: state.consumerStateAnswersSha256,
      progressSha256: state.progressSha256,
      completionKey: randomUUID(),
    };
    const wrong = await invoke((o) =>
      createConsumerFlowService(o).complete(a.credentials, a.sessionId, {
        ...complete,
        progressSha256: "f".repeat(64),
      }),
    );
    expect(wrong.kind).toBe("state-conflict");
    const completed = await Promise.all([
      invoke((o) =>
        createConsumerFlowService(o).complete(
          a.credentials,
          a.sessionId,
          complete,
        ),
      ),
      invoke((o) =>
        createConsumerFlowService(o).complete(a.credentials, a.sessionId, {
          ...complete,
          completionKey: randomUUID(),
        }),
      ),
    ]);
    expect(
      completed.filter((r) => r.kind === "applied").length === 1 &&
        completed.filter((r) => r.kind === "completed-other").length === 1,
    ).toBe(true);
    const report = await invoke((o) =>
      createConsumerFlowService(o).readReport(a.credentials, a.sessionId),
    );
    expect(
      (
        await invoke((o) =>
          createConsumerFlowService(o).resolveComplete(
            a.credentials,
            a.sessionId,
            report.receipt.binding,
          ),
        )
      ).kind,
    ).toBe("applied");
    expect(
      (
        await invoke((o) =>
          createConsumerFlowService(o).resolveComplete(
            a.credentials,
            a.sessionId,
            { ...report.receipt.binding, progressSha256: "f".repeat(64) },
          ),
        )
      ).kind,
    ).toBe("operation-conflict");
    expect(
      (
        await invoke((o) =>
          createConsumerFlowService(o).save(a.credentials, a.sessionId, full),
        )
      ).kind,
    ).toBe("completed");
    expect(
      (await resource(report.view.display.result.portrait)).sha256 ===
        report.view.display.result.portrait.sha256,
    ).toBe(true);
    const voidClaimed = await invoke((o) =>
      createAccessKeyService(o).voidUnused(
        credentials,
        fixture.productId,
        first.key.issue.binding.keyId,
        {
          schemaVersion: "quizforge.access-key-void-unused.v1",
          productId: fixture.productId,
          keyId: first.key.issue.binding.keyId,
          issueBindingSha256: first.key.issue.bindingSha256,
          operationKey: randomUUID(),
        },
      ),
    );
    expect(voidClaimed.kind).toBe("claimed");
    await invoke((o) =>
      createAccessKeyService(o).voidUnused(
        credentials,
        fixture.productId,
        unused.key.issue.binding.keyId,
        {
          schemaVersion: "quizforge.access-key-void-unused.v1",
          productId: fixture.productId,
          keyId: unused.key.issue.binding.keyId,
          issueBindingSha256: unused.key.issue.bindingSha256,
          operationKey: randomUUID(),
        },
      ),
    );
    await expect(
      invoke((o) => createConsumerFlowService(o).exchange(unused.raw)),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    // Existing JSON report does not reopen fixed assets or rerun the engine.
    const image = blobPath(
        db.config,
        report.view.display.result.portrait.sha256,
      ),
      held = image + `.p4-${runId}`;
    let lock = await StorageLock.acquire(db.config);
    try {
      await rename(image, held);
    } finally {
      await lock.close();
    }
    try {
      expect(
        (
          await invoke((o) =>
            createConsumerFlowService(o).readReport(a.credentials, a.sessionId),
          )
        ).receipt.reportId === report.receipt.reportId,
      ).toBe(true);
      await expect(
        resource(report.view.display.result.portrait),
      ).rejects.toMatchObject({ code: "DEPENDENCY_UNAVAILABLE" });
    } finally {
      lock = await StorageLock.acquire(db.config);
      try {
        await rename(held, image);
      } finally {
        await lock.close();
      }
    }
    let newest = a;
    for (let n = 0; n < 16; n++) newest = await exchange(first.raw);
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).readSession(a.credentials, a.sessionId),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).logout(a.credentials, a.sessionId),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await invoke((o) =>
      createConsumerFlowService(o).logout(newest.credentials, newest.sessionId),
    );
    grants.find(
      (g) => g.grantId === newest.view.grant.grantId,
    )!.logoutObserved = true;
    await expect(
      invoke((o) =>
        createConsumerFlowService(o).readSession(
          newest.credentials,
          newest.sessionId,
        ),
      ),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    const keys = await Promise.all(
      [first, second, unused].map((k) =>
        invoke((o) =>
          createAccessKeyService(o).read(
            operator.raw,
            fixture.productId,
            k.key.issue.binding.keyId,
          ),
        ),
      ),
    );
    const observations: ConsumerFixtureObservations = {
      schemaVersion: "quizforge.consumer-fixture-observations.v1",
      instanceId: db.config.instanceId,
      runId,
      productId: fixture.productId,
      mode: "operator-services",
      suiteCompletion: null,
      plays: [created.play],
      keys,
      states: [state, b.view.outcome.state],
      reports: [report.receipt],
      grants,
    };
    const finished = await finishConsumerFixture(db, runId, observations);
    expect(finished.finished && !finished.completed).toBe(true);
    const owner = await launchOwnedPreviewNodeProcess(
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
      await stopAndProveServerExit(owner),
    );
  } finally {
    await db.close();
  }
}, 120000);
