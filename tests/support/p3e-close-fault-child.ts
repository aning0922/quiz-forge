import assert from "node:assert/strict";
import fs, { type FileHandle } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { loginVersionFixtureAccount } from "../db/version-account-fixture";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import { createStudioRequestBudget } from "@/lib/http-security/request-budget";
import { createInternalVersionOwner } from "@/features/product/internal-versions/lifecycle";
import type { ProductInternalVersionService } from "@/features/product/internal-versions/service-contract";
import type {
  RecordBaselineInput,
  SealInternalVersionInput,
} from "@/features/product/internal-versions/contracts";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import {
  instanceDirectory,
  blobPath,
} from "@/features/quizpack/import/storage";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import { openTestDatabase } from "../db/p2a-fixture";

export type CloseFaultEvidence = {
  status: "passed" | "failed";
  mode: "fd" | "db";
  runId: string;
  instanceId: string;
  step: string;
  error?: string;
  pid: number;
  codes: string[];
  closeCalls: number;
  liveFileHandles: number;
  retainedBackendPids: number[];
  sharedGuards: number;
  maintenanceCode: string;
  elapsedPastLastDeadlineMs: number;
  observationMs: number;
  busyBefore: string;
  busyAfter: string;
  originalReviewReplay: boolean;
  originalVersionReplay: boolean;
  reviewResolution: string;
  versionResolution: string;
  newVersionResolution: string;
};

// This executable is ONLY launched by the owned-child PG test. No production import or hook.
const [modeValue, runId] = process.argv.slice(2);
assert(modeValue === "fd" || modeValue === "db");
assert(runId && /^[a-f0-9-]{36}$/.test(runId));
const mode = modeValue;
const db = await openTestDatabase();
const evidenceFile = path.join(
  instanceDirectory(db.config),
  `p3e-close-fault-${runId}.json`,
);
const evidence: CloseFaultEvidence = {
  status: "failed",
  mode,
  runId,
  instanceId: db.config.instanceId,
  step: "prepare",
  pid: process.pid,
  codes: [],
  closeCalls: 0,
  liveFileHandles: 0,
  retainedBackendPids: [],
  sharedGuards: 0,
  maintenanceCode: "",
  elapsedPastLastDeadlineMs: 0,
  observationMs: PREVIEW_LIMITS.closeObservationMs,
  busyBefore: "",
  busyAfter: "",
  originalReviewReplay: false,
  originalVersionReplay: false,
  reviewResolution: "",
  versionResolution: "",
  newVersionResolution: "",
};
const handles: FileHandle[] = [];
const ownedBlobs = new Set<string>();
let rejectFdClose = false;
if (mode === "fd") {
  // Install BEFORE importing the production reader: its default IO object captures native open.
  // The wrapper itself is inactive during prepare and the original successful seal.
  const nativeOpen = fs.open;
  fs.open = async (...args: Parameters<typeof fs.open>) => {
    const handle = await nativeOpen(...args);
    if (
      rejectFdClose &&
      typeof args[0] === "string" &&
      ownedBlobs.has(args[0])
    ) {
      handles.push(handle);
      handle.close = async () => {
        evidence.closeCalls++;
        throw Error("INJECTED_FD_CLOSE_REJECTION");
      };
    }
    return handle;
  };
  syncBuiltinESMExports();
}
const quarantinedDatabases: P2aDatabase[] = [];
const retainedConnections: Awaited<
  ReturnType<P2aDatabase["sql"]["reserve"]>
>[] = [];
const code = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return "UNEXPECTED_SUCCESS";
  } catch (error) {
    if (error instanceof StudioError) return error.code;
    throw error;
  }
};
try {
  const { createProductInternalVersionService } =
    await import("@/features/product/internal-versions/service");
  const { prepareInternalVersionFixture, finishInternalVersionFixture } =
    await import("../db/p3e-internal-version-fixture");
  const fixture = await prepareInternalVersionFixture(db, runId);
  const session = await loginVersionFixtureAccount(db, fixture.operator);
  const credentials = {
    sessionToken: session.raw,
    csrfToken: session.dto.csrfToken,
    requestId: randomUUID(),
  };
  let lastDeadline = 0;
  let trackingFaultDeadline = false;
  const operation = async <T>(
    work: (
      s: ProductInternalVersionService,
      d: P2aDatabase,
      b: ReturnType<typeof createStudioRequestBudget>["budget"],
    ) => Promise<T>,
    rejectClose = false,
  ): Promise<T> => {
    const clock = createStudioRequestBudget(new AbortController().signal);
    const database = await createDatabase(db.config, clock.budget);
    if (trackingFaultDeadline)
      lastDeadline = Math.max(lastDeadline, clock.budget.deadlineMonotonicMs);
    if (rejectClose) {
      // Actual db.close() still runs its production idempotence/dispose/observation path.
      // Only its actual driver close is refused. No real end or compensating unlock follows.
      database.sql.end = async () => {
        evidence.closeCalls++;
        throw Error("INJECTED_DRIVER_CLOSE_REJECTION");
      };
      quarantinedDatabases.push(database);
    }
    const owner = createInternalVersionOwner(database, clock);
    try {
      return await work(
        createProductInternalVersionService(owner),
        database,
        clock.budget,
      );
    } finally {
      await owner.closeIfNotTransferred();
      if (rejectClose) {
        // Reserve a REAL connection from the refused-to-close pool, so idle_timeout cannot
        // substitute for proof of close. It is test-owned and dies only with this child.
        const connection = await database.sql.reserve();
        retainedConnections.push(connection);
        const [row] = await connection<
          { pid: number }[]
        >`SELECT pg_backend_pid() pid`;
        assert(row);
        evidence.retainedBackendPids.push(row.pid);
      }
    }
  };
  const scope = {
    productId: fixture.productId,
    draftId: fixture.draftId!,
    revision: 1,
  };
  const reviewInput: RecordBaselineInput = {
    schemaVersion: "quizforge.review-record.v1",
    idempotencyKey: randomUUID(),
    target: fixture.target!,
    baseline: fixture.baseline!,
  };
  evidence.step = "record-original-review";
  const review = await operation((s, d, b) =>
    s.recordBaseline(d, credentials, scope, reviewInput, b),
  );
  const sealInput: SealInternalVersionInput = {
    schemaVersion: "quizforge.internal-version-seal.v1",
    idempotencyKey: randomUUID(),
    target: fixture.target!,
    reviewId: review.review.id,
    reviewSha256: review.review.reviewSha256,
    renderer: fixture.renderer!,
    engine: fixture.engine!,
  };
  const seal = (input: SealInternalVersionInput, rejectClose = false) =>
    operation(
      (s, d, b) =>
        s.sealInternalVersion(d, credentials, fixture.productId, input, b),
      rejectClose,
    );
  if (mode === "fd") {
    evidence.step = "seal-original-version";
    assert((await seal(sealInput)).created);
    await finishInternalVersionFixture(db, runId);
    for (const b of fixture.blobs)
      ownedBlobs.add(blobPath(db.config, b.sha256));
    rejectFdClose = true;
  }
  evidence.step = "four-close-rejections";
  trackingFaultDeadline = true;
  for (let i = 0; i < 4; i++) {
    const input =
      mode === "db" && i === 0
        ? sealInput
        : { ...sealInput, idempotencyKey: randomUUID() };
    evidence.codes.push(await code(() => seal(input, mode === "db")));
  }
  trackingFaultDeadline = false;
  assert.deepEqual(
    evidence.codes,
    mode === "fd"
      ? Array(4).fill("PREVIEW_RESOURCE_UNAVAILABLE")
      : ["WRITE_OUTCOME_UNKNOWN", ...Array(3).fill("VERSION_ALREADY_SEALED")],
  );
  assert.equal(evidence.closeCalls, 4);
  if (mode === "fd") {
    assert.equal(handles.length, 4);
    for (const handle of handles) assert((await handle.stat()).isFile());
  }
  const newInput = { ...sealInput, idempotencyKey: randomUUID() };
  evidence.busyBefore = await code(() => seal(newInput));
  assert.equal(evidence.busyBefore, "PREVIEW_BUSY");
  const [guards] = await db.admin.sql<{ count: number }[]>`
    SELECT count(*)::int count FROM pg_locks WHERE locktype='advisory'
    AND classid=72461 AND objid=2 AND objsubid=2 AND mode='ShareLock' AND granted`;
  evidence.sharedGuards = guards!.count;
  assert.equal(evidence.sharedGuards, 4);
  evidence.maintenanceCode = await code(async () => {
    const lock = await StorageLock.acquire(db.config);
    await lock.close();
  });
  assert.equal(evidence.maintenanceCode, "RECEIVE_BUSY");
  evidence.step = "wait-past-all-deadlines-and-observation";
  // Strictly past the LAST original request deadline AND its 5s observation interval.
  await delay(
    Math.max(
      0,
      lastDeadline +
        PREVIEW_LIMITS.closeObservationMs +
        150 -
        performance.now(),
    ),
  );
  evidence.elapsedPastLastDeadlineMs = performance.now() - lastDeadline;
  assert(
    evidence.elapsedPastLastDeadlineMs > PREVIEW_LIMITS.closeObservationMs,
  );
  evidence.step = "full-quota-original-key-and-readonly-resolve";
  evidence.busyAfter = await code(() => seal(newInput));
  assert.equal(evidence.busyAfter, "PREVIEW_BUSY");
  evidence.originalReviewReplay = !(
    await operation((s, d, b) =>
      s.recordBaseline(d, credentials, scope, reviewInput, b),
    )
  ).created;
  evidence.originalVersionReplay = !(await seal(sealInput)).created;
  evidence.reviewResolution = (
    await operation((s, d) =>
      s.resolveReview(d, session.raw, {
        productId: fixture.productId,
        ...reviewInput,
      }),
    )
  ).kind;
  evidence.versionResolution = (
    await operation((s, d) =>
      s.resolveVersion(d, session.raw, {
        productId: fixture.productId,
        ...sealInput,
      }),
    )
  ).kind;
  evidence.newVersionResolution = (
    await operation((s, d) =>
      s.resolveVersion(d, session.raw, {
        productId: fixture.productId,
        ...newInput,
      }),
    )
  ).kind;
  assert(evidence.originalReviewReplay && evidence.originalVersionReplay);
  assert.equal(evidence.reviewResolution, "recorded");
  assert.equal(evidence.versionResolution, "sealed");
  assert.equal(evidence.newVersionResolution, "not-sealed-target-used");
  // No original-key/resolve request opened another pixel or retried a rejected close.
  assert.equal(evidence.closeCalls, 4);
  for (const handle of handles) assert((await handle.stat()).isFile());
  evidence.liveFileHandles = handles.length;
  for (let i = 0; i < retainedConnections.length; i++) {
    const [row] = await retainedConnections[i]!<
      { pid: number }[]
    >`SELECT pg_backend_pid() pid`;
    assert.equal(row?.pid, evidence.retainedBackendPids[i]);
  }
  await finishInternalVersionFixture(db, runId);
  await db.close();
  evidence.step = "actual-work-ended-quarantine-retained-until-child-exit";
  evidence.status = "passed";
} catch (error) {
  // Never serialize credentials, SQL text, driver details, stacks or raw errors.
  evidence.error =
    error instanceof StudioError ? error.code : "CLOSE_FAULT_ASSERTION_FAILED";
}
const temporary = `${evidenceFile}.tmp`;
await fs.writeFile(temporary, JSON.stringify(evidence), {
  flag: "wx",
  mode: 0o600,
});
await fs.rename(temporary, evidenceFile);
// Keep strong references to actual rejected resources. Only the owned process exit closes them.
setInterval(() => {
  void [handles, quarantinedDatabases, retainedConnections];
}, 1000);
