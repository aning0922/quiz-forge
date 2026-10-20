import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { lstat, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { expect, it } from "vitest";
import {
  instanceDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { configureImports } from "@/features/quizpack/import/config-management";
import { openTestDatabase } from "./p2a-fixture";
import { resetDomainDatabase } from "./p2b2b-domain-fixture";
import {
  readInternalVersionFixture,
  cleanupInternalVersionFixture,
} from "./p3e-internal-version-fixture";
import {
  launchOwnedPreviewNodeProcess,
  stopAndProveServerExit,
  assertPreviewServerRunning,
} from "../support/p3c-server-owner";
import type { CloseFaultEvidence } from "../support/p3e-close-fault-child";
import { observeP3eBackendExit } from "../support/p3e-backend-exit";

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(Error("PORT_REQUIRED"));
      server.close((e) => (e ? reject(e) : resolve(address.port)));
    });
  });
}
async function waitEvidence(file: string) {
  const deadline = performance.now() + 55_000;
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(file, "utf8")) as CloseFaultEvidence;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await delay(100);
  }
  throw Error("CLOSE_FAULT_EVIDENCE_TIMEOUT_PRESERVED");
}
let previousScopeClean = true;
for (const mode of ["fd", "db"] as const) {
  it(`quarantines actual ${mode} close rejections past deadlines until owned child exit, while old keys and resolve still work`, async () => {
    // A failed scenario is preserved, never erased by the next test/reset.
    expect(previousScopeClean).toBe(true);
    previousScopeClean = false;
    const db = await openTestDatabase();
    let child:
      Awaited<ReturnType<typeof launchOwnedPreviewNodeProcess>> | undefined;
    try {
      await resetDomainDatabase(db);
      // Do this before launching/quarantining resources: the formal switch itself
      // needs the exclusive storage lock. Never rely on a fresh instance default.
      await configureImports(db.config.instanceId, false);
      const runId = randomUUID();
      const evidenceFile = path.join(
        instanceDirectory(db.config),
        `p3e-close-fault-${runId}.json`,
      );
      child = await launchOwnedPreviewNodeProcess(
        {
          cwd: process.cwd(),
          instanceId: db.config.instanceId,
          runId,
          port: await freePort(),
          runtimeConfigPath: process.env.QUIZFORGE_P2A_CONFIG!,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.join(process.cwd(), "tsconfig.json"),
          },
        },
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/support/p3e-close-fault-child.ts",
          mode,
          runId,
        ],
      );
      const evidence = await waitEvidence(evidenceFile);
      expect(
        evidence,
        "safe child evidence; failed scene must be preserved",
      ).toMatchObject({
        status: "passed",
        mode,
        runId,
        instanceId: db.config.instanceId,
        closeCalls: 4,
        liveFileHandles: mode === "fd" ? 4 : 0,
        sharedGuards: 4,
        maintenanceCode: "RECEIVE_BUSY",
        busyBefore: "PREVIEW_BUSY",
        busyAfter: "PREVIEW_BUSY",
        originalReviewReplay: true,
        originalVersionReplay: true,
        reviewResolution: "recorded",
        versionResolution: "sealed",
        newVersionResolution: "not-sealed-target-used",
      });
      expect(evidence.elapsedPastLastDeadlineMs).toBeGreaterThan(
        evidence.observationMs,
      );
      expect(evidence.codes).toEqual(
        mode === "fd"
          ? Array(4).fill("PREVIEW_RESOURCE_UNAVAILABLE")
          : [
              "WRITE_OUTCOME_UNKNOWN",
              ...Array(3).fill("VERSION_ALREADY_SEALED"),
            ],
      );
      expect(evidence.retainedBackendPids).toHaveLength(mode === "db" ? 4 : 0);
      expect((await lstat(evidenceFile)).mode & 0o777).toBe(0o600);
      assertPreviewServerRunning(child);
      const fixture = await readInternalVersionFixture(db, runId);
      expect(fixture.writerPid).toBe(evidence.pid);
      expect(fixture.completed).toBe(true);
      expect(fixture.review).not.toBeNull();
      expect(fixture.versionDetail).not.toBeNull();
      for (const blob of fixture.blobs)
        expect((await readFile(blobPath(db.config, blob.sha256))).length).toBe(
          blob.bytes,
        );
      if (mode === "db") {
        const rows = await db.admin.sql<
          { pid: number }[]
        >`SELECT pid FROM pg_stat_activity WHERE pid=ANY(${evidence.retainedBackendPids})`;
        expect(rows.map((r) => r.pid).sort()).toEqual(
          [...evidence.retainedBackendPids].sort(),
        );
      }
      const [before] = await db.admin.sql<
        { reviews: number; versions: number; audits: number }[]
      >`
        SELECT (SELECT count(*)::int FROM qf.draft_review) reviews,
        (SELECT count(*)::int FROM qf.product_version) versions,
        (SELECT count(*)::int FROM qf.audit_event WHERE action::text IN ('draft_baseline_recorded','internal_version_sealed')) audits`;
      expect(before).toEqual({ reviews: 1, versions: 1, audits: 2 });
      // No TTL cleanup/unlock or retained resource close. First obtain REAL close + absent process group.
      const proof = await stopAndProveServerExit(child);
      // Observe the server side separately after REAL child exit. Its last
      // backend can still be visible while PostgreSQL processes socket closure.
      const afterExit = await observeP3eBackendExit(
        proof,
        { cwd: process.cwd(), instanceId: db.config.instanceId, runId },
        async () => {
          const [row] = await db.admin.sql<
            { connections: number; guards: number }[]
          >`
        SELECT (SELECT count(*)::int FROM pg_stat_activity WHERE pid=ANY(${evidence.retainedBackendPids})) connections,
        (SELECT count(*)::int FROM pg_locks WHERE locktype='advisory' AND classid=72461 AND objid=2 AND objsubid=2 AND granted) guards`;
          return row;
        },
      );
      expect(afterExit).toEqual({ connections: 0, guards: 0 });
      const maintenance = await StorageLock.acquire(db.config);
      expect(await maintenance.close()).toBe(true);
      await cleanupInternalVersionFixture(db, runId, proof);
      const [removed] = await db.admin.sql<
        { present: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM qf.product WHERE id=${fixture.productId}) present`;
      expect(removed?.present).toBe(false);
      for (const blob of fixture.blobs)
        await expect(
          lstat(blobPath(db.config, blob.sha256)),
        ).rejects.toMatchObject({ code: "ENOENT" });
      // Keep the safe evidence in ignored cache for review; private fixture was removed by exact cleanup.
      await expect(readInternalVersionFixture(db, runId)).rejects.toThrow();
      previousScopeClean = true;
    } finally {
      if (child) await stopAndProveServerExit(child);
      await db.close();
    }
  }, 65_000);
}
