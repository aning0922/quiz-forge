import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  instanceDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
import { openTestDatabase } from "./p2a-fixture";
import { configureImports } from "@/features/quizpack/import/config-management";
import {
  readConsumerFixture,
  finishConsumerFixture,
  cleanupConsumerFixture,
} from "./p4-consumer-fixture";
import { CONSUMER_FIXTURE_PRIVATE_NAME } from "./p4-consumer-fixture-contract";
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
it("real foreign app connection and unknown manifest close block cleanup before first DELETE across retries/reload", async () => {
  let db = await openTestDatabase();
  const runId = randomUUID(),
    options = {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: path.join(process.cwd(), "tsconfig.json"),
      },
      timeout: 90000,
      maxBuffer: 8192,
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
      options,
    );
    const fixture = await readConsumerFixture(db, runId);
    await finishConsumerFixture(db, runId, {
      schemaVersion: "quizforge.consumer-fixture-observations.v1",
      instanceId: db.config.instanceId,
      runId,
      productId: fixture.productId,
      mode: "operator-services",
      suiteCompletion: null,
      plays: [],
      keys: [],
      states: [],
      reports: [],
      grants: [],
    });
    const manifest = path.join(
        instanceDirectory(db.config),
        CONSUMER_FIXTURE_PRIVATE_NAME,
      ),
      before = await readFile(manifest),
      pixels = await Promise.all(
        fixture.blobs.map((b) => readFile(blobPath(db.config, b.sha256))),
      );
    // Leave only the child's maintenance connections plus its deliberately held foreign app PID.
    // A visible parent owner connection would mask the original backend_type=NULL bug.
    await db.close();
    const result = await exec(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "tests/support/p4-fixture-close-child.ts",
        runId,
      ],
      options,
    );
    db = await openTestDatabase();
    expect(JSON.parse(result.stdout)).toEqual({
      passed: true,
      foreignBackendBlocked: true,
      actualFdRejected: true,
      opens: 1,
      deletes: 0,
      lateCloseStillBlocked: true,
      moduleReloadStillBlocked: true,
    });
    expect((await readFile(manifest)).equals(before)).toBe(true);
    const current = await readConsumerFixture(db, runId);
    expect(
      current.rows.length === JSON.parse(before.toString()).rows.length,
    ).toBe(true);
    for (let n = 0; n < fixture.blobs.length; n++)
      expect(
        (await readFile(blobPath(db.config, fixture.blobs[n]!.sha256))).equals(
          pixels[n]!,
        ),
      ).toBe(true);
    // The quarantined child actually exited; this independent parent verifies the unchanged full graph again.
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
    await db.close();
  }
}, 120000);
