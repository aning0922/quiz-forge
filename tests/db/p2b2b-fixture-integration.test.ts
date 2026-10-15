import { randomUUID } from "node:crypto";
import { lstat, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { openTestDatabase, safeTestOperation as safe } from "./p2a-fixture";
import {
  cleanupTestValidationFixture,
  prepareTestValidationFixture,
  readTestValidationFixture,
} from "./p2b2b-e2e-fixture";
import { ownerAbsent } from "./p2b2b-fixture-contract";
import {
  importDirectory,
  validationDirectory,
} from "@/features/quizpack/import/storage";
import type { ImportRow } from "@/features/quizpack/import/repository";
import { domainFixture, resetDomainDatabase } from "./p2b2b-domain-fixture";
import {
  runTestValidationRequest,
  testValidationRequestEnded,
} from "./p2b2b-request-fixture";
import { fixtureValidationOwnersEnded } from "./p2b2b-maintenance";
import { createPreauth, login } from "@/lib/auth/service";
import { configureImports } from "@/features/quizpack/import/config-management";
import { currentConfig } from "@/features/quizpack/import/service";
import { validationTransactions as transactions } from "@/features/quizpack/validation/transactions";
import {
  validationKey,
  parseValidationAttempts,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import { ArchiveOperation } from "@/features/quizpack/validation/operation";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  writeValidationStopped,
  validationFileStopPublication,
} from "@/features/quizpack/validation/receipt";

async function syntheticControlDirectory() {
  // Empty fixture directory only: no decoder runs and no sealed runtime is claimed.
  const role =
    process.platform === "darwin" && process.arch === "arm64"
      ? "darwin-arm64"
      : process.platform === "linux" && process.arch === "x64"
        ? "linux-x64"
        : null;
  if (!role) throw new Error("TEST_PLATFORM_REQUIRED");
  await mkdir(
    path.join(
      process.cwd(),
      ".cache",
      "quizpack-media-runtime",
      role,
      "control",
    ),
    { recursive: true, mode: 0o700 },
  );
}

it("real received files survive foreign-audit refusal, then exact fixture cleanup removes only its owned rows and files", async () => {
  const initial = await openTestDatabase();
  const instanceId = initial.config.instanceId;
  await initial.close();
  await configureImports(instanceId, true);
  const database = await openTestDatabase();
  try {
    await syntheticControlDirectory();
    const fixture = await safe(() =>
      prepareTestValidationFixture(database, randomUUID()),
    );
    expect(database.config.imports.enabled).toBe(true);
    expect((await currentConfig(database.app)).imports.enabled).toBe(false);
    const actual = await readTestValidationFixture(database, fixture.runId);
    const fixtureMatches = canonicalP1Json(actual) === canonicalP1Json(fixture);
    expect(fixtureMatches).toBe(true);
    const imports = await safe(
      () =>
        database.admin.sql<
          ImportRow[]
        >`SELECT * FROM qf.quizpack_import WHERE product_id=${fixture.productId} ORDER BY id`,
    );
    expect(imports).toHaveLength(3);
    for (const row of imports) {
      expect(row.status).toBe("received");
      expect(row.attempts.length).toBeGreaterThan(0);
      for (const attempt of row.attempts) {
        expect(attempt.disposition).toBe("released");
        expect(ownerAbsent(attempt.ownerPid)).toBe(true);
      }
    }
    const archive = path.join(
      importDirectory(database.config, imports[0]!.id),
      "archive.quizpack",
    );
    const before = await lstat(archive);
    await expect(
      cleanupTestValidationFixture(database, {
        ...fixture,
        productId: "e2e-validations-00000000",
      }),
    ).rejects.toThrow("TEST_VALIDATION_FIXTURE_MISMATCH");
    const [session] = await safe(
      () =>
        database.admin.sql<
          { id: string }[]
        >`SELECT id FROM qf.operator_session WHERE operator_id=${fixture.operator.identifier} ORDER BY id LIMIT 1`,
    );
    if (!session) throw new Error("TEST_SESSION_REQUIRED");
    const auditId = randomUUID();
    await safe(
      () =>
        database.admin
          .sql`INSERT INTO qf.audit_event(id,occurred_at,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision) VALUES(${auditId},clock_timestamp(),'product_created','success',${fixture.operator.identifier},${session.id},${randomUUID()},'product','foreign-synthetic-product',1)`,
    );
    await expect(
      safe(() => cleanupTestValidationFixture(database, fixture)),
    ).rejects.toThrow();
    const after = await lstat(archive);
    expect([after.dev, after.ino, after.size]).toEqual([
      before.dev,
      before.ino,
      before.size,
    ]);
    const [remaining] = await safe(
      () =>
        database.admin.sql<
          { imports: number; audit: number }[]
        >`SELECT (SELECT count(*)::int FROM qf.quizpack_import WHERE product_id=${fixture.productId}) imports,(SELECT count(*)::int FROM qf.audit_event WHERE id=${auditId}) audit`,
    );
    expect(remaining).toEqual({ imports: 3, audit: 1 });
    // This probe owns exactly this synthetic row; removing it restores the valid fixture namespace.
    await safe(
      () => database.admin.sql`DELETE FROM qf.audit_event WHERE id=${auditId}`,
    );
    await safe(() => cleanupTestValidationFixture(database, fixture));
    await expect(lstat(archive)).rejects.toMatchObject({ code: "ENOENT" });
    const [clean] = await safe(
      () =>
        database.admin.sql<
          { products: number; imports: number; operators: number }[]
        >`SELECT (SELECT count(*)::int FROM qf.product WHERE id=${fixture.productId}) products,(SELECT count(*)::int FROM qf.quizpack_import WHERE product_id=${fixture.productId}) imports,(SELECT count(*)::int FROM qf.operator WHERE id=ANY(${database.admin.sql.array([fixture.operator.identifier, fixture.readOnly.identifier])}::uuid[])) operators`,
    );
    expect(clean).toEqual({ products: 0, imports: 0, operators: 0 });
  } finally {
    await database.close();
  }
}, 120_000);

it("a real pre-candidate request publishes its actual file, commits ACK and drains before same-process cleanup; cross-process mode still refuses the live PID", async () => {
  const database = await openTestDatabase();
  try {
    await syntheticControlDirectory();
    // Domain identity is only a valid SQL tuple, never a claim that a decoder or P1 validation executed.
    const domain = await domainFixture(database);
    const fixture = await safe(() =>
      prepareTestValidationFixture(database, randomUUID()),
    );
    const preauth = await createPreauth(database.app, null, randomUUID());
    const session = await login(
      database.app,
      preauth.raw,
      preauth.dto.csrfToken,
      fixture.operator.secret,
      randomUUID(),
    );
    const credentials = {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    };
    const original = fixture.imports[0]!;
    const scope = { productId: fixture.productId, importId: original.importId };
    const binding = {
      ...domain.binding,
      validationKey: validationKey({
        ...scope,
        archiveSha256: original.archiveSha256,
        archiveBytes: original.archiveBytes,
        identitySha256: domain.binding.identitySha256,
        archivePolicyVersion: domain.binding.archivePolicyVersion,
        archivePolicySha256: domain.binding.archivePolicySha256,
      }),
    };
    const row = await safe(() =>
      runTestValidationRequest(database, async (db, context) => {
        const op = new ArchiveOperation(db, context);
        const lock = await op.fileTask(() =>
          StorageLock.acquire(db.config, context),
        );
        op.attachLock(lock);
        const authority = (r: ValidationRow) => ({
          validationId: r.id,
          expectedStateRevision: r.state_revision,
          fence: r.fence,
          attemptId: r.current_attempt_id,
        });
        try {
          op.enterClaimBoundary();
          let current = (
            await op.databaseAwait("write", () =>
              transactions.claimValidation(db, credentials, scope, {
                expectedImportStateRevision:
                  original.expectedImportStateRevision,
                expectedValidationKey: binding.validationKey,
                binding,
                owner: { ownerPid: process.pid, ownerNonce: "b".repeat(43) },
              }),
            )
          ).row;
          op.confirmClaim();
          const attempt = parseValidationAttempts(current.attempts_text)[0]!;
          // Stop the test request before entering the candidate boundary. No archive/decoder work is issued.
          op.closeNonDbGate();
          await op.settle();
          expect(
            await writeValidationStopped(op, db.config, current.id, attempt),
          ).toBe(true);
          const publication = validationFileStopPublication(
            op,
            current.id,
            attempt,
          );
          expect(publication.proof.mediaStopped).toBe("not-started");
          current = await op.acknowledgeDatabaseOnce(
            publication.qualification,
            () =>
              transactions.acknowledgeValidationFileStop(
                db,
                credentials,
                scope,
                {
                  authority: authority(current),
                  proof: publication.proof,
                },
              ),
          );
          current = await op.finalizeDatabaseOnce(() =>
            transactions.interruptValidation(db, credentials, scope, {
              authority: authority(current),
              settledAttempts: [
                {
                  attemptId: attempt.attemptId,
                  mediaStop: "not-started",
                  fileStopProof: publication.proof,
                },
              ],
              accountedBytes: publication.bytes,
              storageCondition: "clean",
              errorCode: "STUDIO_UNAVAILABLE",
            }),
          );
          return current;
        } finally {
          await op.closeStorageLock();
          await op.settle();
        }
      }),
    );
    expect(testValidationRequestEnded(database, row)).toBe(true);
    expect(fixtureValidationOwnersEnded(database, row, "same-process")).toBe(
      true,
    );
    expect(fixtureValidationOwnersEnded(database, row, "cross-process")).toBe(
      false,
    );
    expect(
      parseValidationAttempts(row.attempts_text)[0]!.fileStopProof,
    ).not.toBeNull();
    expect(Number(row.reserved_bytes)).toBe(0);
    expect(database.config.imports.enabled).toBe(false);
    await configureImports(database.config.instanceId, true);
    const refusedLiveEnabled = await cleanupTestValidationFixture(
      database,
      fixture,
    ).then(
      () => false,
      (error: unknown) =>
        error instanceof Error &&
        error.message === "TEST_VALIDATION_IMPORTS_ENABLED",
    );
    expect(refusedLiveEnabled).toBe(true);
    await expect(
      lstat(
        path.join(
          importDirectory(database.config, original.importId),
          "archive.quizpack",
        ),
      ),
    ).resolves.toBeDefined();
    await configureImports(database.config.instanceId, false);
    const receipt = path.join(
      validationDirectory(database.config, row.id),
      `stopped-${row.current_attempt_id}.json`,
    );
    const heldReceipt = path.join(
      process.cwd(),
      ".cache",
      `fixture-receipt-${randomUUID()}.json`,
    );
    await rename(receipt, heldReceipt);
    try {
      // In-memory observation and committed ACK cannot replace the actual candidate file.
      expect(testValidationRequestEnded(database, row)).toBe(true);
      await expect(
        safe(() => cleanupTestValidationFixture(database, fixture)),
      ).rejects.toThrow();
      await expect(
        lstat(
          path.join(
            importDirectory(database.config, original.importId),
            "archive.quizpack",
          ),
        ),
      ).resolves.toBeDefined();
    } finally {
      await rename(heldReceipt, receipt);
    }
    await safe(() => cleanupTestValidationFixture(database, fixture));
    // The separate SQL-only domain fixture remains until its own no-file cleanup.
    const [outside] = await safe(
      () =>
        database.admin.sql<
          { id: string }[]
        >`SELECT id FROM qf.product WHERE id=${domain.scope.productId}`,
    );
    expect(outside?.id).toBe(domain.scope.productId);
    await resetDomainDatabase(database);
  } finally {
    await database.close();
  }
}, 120_000);
