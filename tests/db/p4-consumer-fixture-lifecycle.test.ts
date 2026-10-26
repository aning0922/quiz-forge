import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { loginVersionFixtureAccount } from "./version-account-fixture";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";
import { createInternalPlayService } from "@/features/product/internal-play/service";
import { createAccessKeyService } from "@/features/fulfillment/access/service";
import { configureImports } from "@/features/quizpack/import/config-management";
import { digestConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import {
  instanceDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
import { openTestDatabase } from "./p2a-fixture";
import {
  readConsumerFixture,
  finishConsumerFixture,
  cleanupConsumerFixture,
} from "./p4-consumer-fixture";
import {
  CONSUMER_FIXTURE_PRIVATE_NAME,
  CONSUMER_OBSERVATIONS_PRIVATE_NAME,
  type ConsumerFixtureObservations,
} from "./p4-consumer-fixture-contract";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  type ServerExitProof,
} from "../support/p3c-server-owner";

const exec = promisify(execFile);
const cli = (action: string, runId: string) =>
  exec(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "tests/db/p4-consumer-fixture.ts",
      action,
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
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("P4_PORT_REQUIRED"));
      server.close((e) => (e ? reject(e) : resolve(address.port)));
    });
  });

it("dedicated r1 physical source, actual play/Key services, exact finish and pre-delete refusal", async () => {
  const db = await openTestDatabase(),
    runId = randomUUID();
  try {
    await configureImports(db.config.instanceId, false);
    await cli("prepare", runId);
    const fixture = await readConsumerFixture(db, runId),
      manifest = path.join(
        instanceDirectory(db.config),
        CONSUMER_FIXTURE_PRIVATE_NAME,
      );
    expect(
      fixture.prepared &&
        !fixture.finished &&
        !fixture.completed &&
        fixture.parent?.snapshot.target.revision === 1,
    ).toBe(true);
    expect((await lstat(manifest)).mode & 0o777).toBe(0o600);
    expect(fixture.blobs.length).toBe(5);
    const session = await loginVersionFixtureAccount(db, fixture.operator),
      credentials = {
        sessionToken: session.raw,
        csrfToken: session.dto.csrfToken,
        requestId: randomUUID(),
      };
    const request = async <T>(
      work: (
        owner: ReturnType<typeof createConsumerRequestOwner>,
      ) => Promise<T>,
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
    const binding = {
      schemaVersion: "quizforge.internal-play-create.v1" as const,
      operationKey: randomUUID(),
      parent: {
        productId: fixture.productId,
        versionId: fixture.parent!.version.id,
        snapshotSha256: fixture.parent!.version.snapshotSha256,
      },
      renderer: fixture.consumerRenderer!,
    };
    const created = await request((o) =>
      createInternalPlayService(o).create(
        credentials,
        fixture.productId,
        binding,
      ),
    );
    expect(created.created).toBe(true);
    const again = await request((o) =>
      createInternalPlayService(o).create(
        credentials,
        fixture.productId,
        binding,
      ),
    );
    expect(!again.created && again.play.id === created.play.id).toBe(true);
    const resolvedPlay = await request((o) =>
      createInternalPlayService(o).resolve(
        session.raw,
        fixture.productId,
        binding,
      ),
    );
    expect(resolvedPlay.kind).toBe("applied");
    expect(
      (
        await request((o) =>
          createInternalPlayService(o).list(session.raw, fixture.productId),
        )
      ).versions.length,
    ).toBe(1);
    await expect(
      request((o) =>
        createInternalPlayService(o).create(credentials, fixture.productId, {
          ...binding,
          operationKey: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const keyBinding = {
      schemaVersion: "quizforge.access-key-issue.v1" as const,
      operationKey: randomUUID(),
      keyId: randomUUID(),
      play: {
        productId: fixture.productId,
        playVersionId: created.play.id,
        playSnapshotSha256: created.play.snapshotSha256,
      },
      credentialDigest: (await digestConsumerToken(
        `qfk_p4_${randomBytes(32).toString("base64url")}`,
        "access-key",
      ))!,
      validForSeconds: 3600,
    };
    const key = await request((o) =>
      createAccessKeyService(o).issue(
        credentials,
        fixture.productId,
        keyBinding,
      ),
    );
    expect(key.created).toBe(true);
    const repeatedKey = await request((o) =>
      createAccessKeyService(o).issue(
        credentials,
        fixture.productId,
        keyBinding,
      ),
    );
    expect(
      !repeatedKey.created &&
        repeatedKey.key.issue.binding.keyId === keyBinding.keyId,
    ).toBe(true);
    const resolvedIssue = await request((o) =>
      createAccessKeyService(o).resolveIssue(
        session.raw,
        fixture.productId,
        keyBinding,
      ),
    );
    expect(resolvedIssue.kind).toBe("applied");
    expect(
      (
        await request((o) =>
          createAccessKeyService(o).list(session.raw, fixture.productId, null),
        )
      ).keys.length,
    ).toBe(1);
    const voidBinding = {
      schemaVersion: "quizforge.access-key-void-unused.v1" as const,
      productId: fixture.productId,
      operationKey: randomUUID(),
      keyId: keyBinding.keyId,
      issueBindingSha256: key.key.issue.bindingSha256,
    };
    await request((o) =>
      createAccessKeyService(o).voidUnused(
        credentials,
        fixture.productId,
        keyBinding.keyId,
        voidBinding,
      ),
    );
    const latest = await request((o) =>
      createAccessKeyService(o).read(
        session.raw,
        fixture.productId,
        keyBinding.keyId,
      ),
    );
    expect(latest.current.voidReceipt !== null).toBe(true);
    const resolvedVoid = await request((o) =>
      createAccessKeyService(o).resolveVoid(
        session.raw,
        fixture.productId,
        voidBinding,
      ),
    );
    expect(resolvedVoid.kind).toBe("applied");
    const readOnlySession = await loginVersionFixtureAccount(
        db,
        fixture.readOnly,
      ),
      readOnlyCredentials = {
        sessionToken: readOnlySession.raw,
        csrfToken: readOnlySession.dto.csrfToken,
        requestId: randomUUID(),
      };
    expect(
      (
        await request((o) =>
          createInternalPlayService(o).read(
            readOnlySession.raw,
            fixture.productId,
            created.play.id,
          ),
        )
      ).play.id === created.play.id,
    ).toBe(true);
    await expect(
      request((o) =>
        createInternalPlayService(o).create(
          readOnlyCredentials,
          fixture.productId,
          binding,
        ),
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
    await expect(
      request((o) =>
        createAccessKeyService(o).issue(
          readOnlyCredentials,
          fixture.productId,
          keyBinding,
        ),
      ),
    ).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
    const observations: ConsumerFixtureObservations = {
      schemaVersion: "quizforge.consumer-fixture-observations.v1",
      instanceId: db.config.instanceId,
      runId,
      productId: fixture.productId,
      mode: "operator-services",
      suiteCompletion: null,
      plays: [created.play],
      keys: [latest],
      states: [],
      reports: [],
      grants: [],
    };
    const before = await readFile(manifest);
    await expect(
      finishConsumerFixture(db, runId, {
        ...observations,
        plays: [],
        keys: [],
      }),
    ).rejects.toThrow("CONSUMER_FIXTURE_UNKNOWN_PRESERVED");
    await expect(
      finishConsumerFixture(db, runId, {
        ...observations,
        plays: [{ ...created.play, createdBy: fixture.readOnly.identifier }],
      }),
    ).rejects.toThrow("CONSUMER_FIXTURE_UNKNOWN_PRESERVED");
    await expect(
      finishConsumerFixture(db, runId, {
        ...observations,
        keys: [
          {
            ...latest,
            issue: { ...latest.issue, issuedBy: fixture.readOnly.identifier },
          },
        ],
      }),
    ).rejects.toThrow("CONSUMER_FIXTURE_UNKNOWN_PRESERVED");
    await expect(
      finishConsumerFixture(db, runId, {
        ...observations,
        keys: [
          {
            ...latest,
            issue: { ...latest.issue, bindingSha256: "f".repeat(64) },
          },
        ],
      }),
    ).rejects.toThrow();
    await expect(
      finishConsumerFixture(db, runId, { ...observations, plays: [] }),
    ).rejects.toThrow();
    expect((await readFile(manifest)).equals(before)).toBe(true);
    await writeFile(
      path.join(
        instanceDirectory(db.config),
        CONSUMER_OBSERVATIONS_PRIVATE_NAME,
      ),
      JSON.stringify(observations),
      { mode: 0o600, flag: "wx" },
    );
    await cli("finish", runId);
    const sealed = await readConsumerFixture(db, runId);
    expect(
      sealed.finished &&
        !sealed.completed &&
        sealed.rows.some((r) => r.table === "access_key"),
    ).toBe(true);
    const pixel = blobPath(db.config, sealed.blobs[0]!.sha256),
      bytes = await readFile(pixel);
    await expect(
      cleanupConsumerFixture(db, runId, {} as ServerExitProof),
    ).rejects.toThrow("PREVIEW_SERVER_EXIT_UNPROVEN");
    expect((await readFile(pixel)).equals(bytes)).toBe(true);
    const owner = await launchOwnedPreviewNodeProcess(
        {
          cwd: process.cwd(),
          instanceId: db.config.instanceId,
          runId,
          port: await freePort(),
          runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
        },
        ["-e", "setInterval(()=>{},1000)"],
      ),
      proof = await stopAndProveServerExit(owner);
    const [audit] = await db.admin.sql<
      { id: string }[]
    >`INSERT INTO qf.audit_event(id,action,outcome,actor_id,request_id) VALUES(${randomUUID()},'operator_disabled','success',${fixture.operator.identifier},${randomUUID()}) RETURNING id`;
    await expect(cleanupConsumerFixture(db, runId, proof)).rejects.toThrow(
      "CONSUMER_FIXTURE_UNKNOWN_PRESERVED",
    );
    expect((await readFile(pixel)).equals(bytes)).toBe(true);
    // Remove only this test's explicit rejected extra row; never resnapshot/adopt it.
    await db.admin
      .sql`DELETE FROM qf.audit_event WHERE id=${audit!.id} AND actor_id=${fixture.operator.identifier}`;
    await cleanupConsumerFixture(db, runId, proof);
    await expect(lstat(manifest)).rejects.toMatchObject({ code: "ENOENT" });
    const [left] = await db.admin.sql<
      { present: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id=${fixture.productId}) OR EXISTS(SELECT 1 FROM qf.internal_play_version WHERE product_id=${fixture.productId}) AS present`;
    expect(left?.present).toBe(false);
  } finally {
    await db.close();
  }
}, 120000);
