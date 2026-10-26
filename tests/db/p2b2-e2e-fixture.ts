import { seedVersionFixtureAccount } from "./version-account-fixture";
import { constants } from "node:fs";
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  openTestDatabase,
  resetTestDatabase,
  authenticateTestOperator,
} from "./p2a-fixture";
import { createProduct } from "@/features/product/workspace/service";

import { readPrivateJson } from "@/lib/db/runtime";
import { idempotencyKeySchema } from "@/features/quizpack/import/contracts";
import {
  createImportReceiveService,
  importReceiveService,
} from "@/features/quizpack/import/service";
import { createReceiveContext } from "@/features/quizpack/import/context";
import { StudioError } from "@/lib/http-security/errors";

// Only fixed safe flags leave this process. No credentials/SQL exceptions are printed.
async function run() {
  const mode = process.argv[2];
  const runId = process.argv[3];
  if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error();
  const fixture = await openTestDatabase();
  const file = path.join(
    process.cwd(),
    ".cache",
    "p2a",
    fixture.config.instanceId,
    "imports-e2e-fixture.json",
  );
  let created = false;
  try {
    if (mode !== "prepare") {
      const stored = await readPrivateJson(file);
      if (
        !stored ||
        typeof stored !== "object" ||
        !("runId" in stored) ||
        stored.runId !== runId
      )
        throw new Error();
    }
    if (mode === "observe-intent") {
      const key = idempotencyKeySchema.parse(process.argv[4]);
      // An independent owner connection must observe the committed real row.
      const rows = await fixture.admin.sql<
        { id: string }[]
      >`SELECT id FROM qf.quizpack_import WHERE product_id='e2e-imports' AND idempotency_key=${key}`;
      if (rows.length !== 1) throw new Error();
      return;
    }
    if (mode === "enable" || mode === "disable") {
      await promisify(execFile)(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "scripts/p2a-db.ts",
          "imports",
          "--instance",
          fixture.config.instanceId,
          "--enabled",
          mode === "enable" ? "true" : "false",
        ],
        {
          cwd: process.cwd(),
          env: process.env,
          timeout: 30000,
          maxBuffer: 4096,
        },
      );
      return;
    }
    if (mode === "seed-recovery") {
      const author = await authenticateTestOperator(fixture);
      const bytes = Buffer.from("synthetic recover original bytes");
      const intent = await importReceiveService.createIntent(
        fixture.app,
        author.credentials,
        "e2e-imports",
        randomUUID(),
        {
          expectedArchiveBytes: bytes.length,
          expectedArchiveSha256: createHash("sha256")
            .update(bytes)
            .digest("hex"),
          target: { kind: "new-draft" },
        },
      );
      const { context, dispose } = createReceiveContext(
        new AbortController().signal,
      );
      let reads = 0;
      const real = createImportReceiveService({
        afterCommit: async (kind) => {
          if (kind === "claim") throw new StudioError("WRITE_OUTCOME_UNKNOWN");
        },
      });
      try {
        await real.receiveArchive(
          fixture.app,
          author.credentials,
          "e2e-imports",
          intent.import.id,
          {
            chunks: {
              async *[Symbol.asyncIterator]() {
                reads += 1;
                yield bytes;
              },
            },
            cancel: async () => undefined,
          },
          context,
        );
        throw new Error();
      } catch (error) {
        if (
          !(error instanceof StudioError) ||
          error.code !== "WRITE_OUTCOME_UNKNOWN"
        )
          throw new Error();
      } finally {
        dispose();
      }
      const rows = await fixture.admin.sql<
        { status: string }[]
      >`SELECT status FROM qf.quizpack_import WHERE id=${intent.import.id}`;
      if (reads !== 0 || rows.length !== 1 || rows[0]?.status !== "receiving")
        throw new Error();
      // No stream/file work began; on normal helper exit its recorded PID is dead.
      // Browser recovery must prove that fact itself, never trust this safe flag.
      return;
    }
    if (mode === "cleanup") {
      // The A-owned reset must account for imports and safely clean known test files.
      await resetTestDatabase(fixture);
      await unlink(file);
      return;
    }
    if (mode !== "prepare") throw new Error();
    const operator = randomBytes(32).toString("base64url");
    const readOnly = randomBytes(32).toString("base64url");
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    try {
      await handle.writeFile(
        JSON.stringify({
          version: 1,
          runId,
          operator: operator,
          readOnly: readOnly,
        }),
      );
    } finally {
      await handle.close();
    }
    await resetTestDatabase(fixture);
    const author = await authenticateTestOperator(fixture);
    await createProduct(fixture.app, author.credentials, {
      id: "e2e-imports",
      slug: "e2e-imports",
      title: "合成原包接收工作区",
      primaryCategoryId: null,
      tagIds: [],
    });
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: operator },
      "Synthetic imports-e2e operator",
      "operator",
      "imports-e2e-operator",
    );
    await seedVersionFixtureAccount(
      fixture,
      { identifier: randomUUID(), secret: readOnly },
      "Synthetic imports-e2e reader",
      "read-only",
      "imports-e2e-read-only",
    );
  } catch {
    if (created) await unlink(file).catch(() => undefined);
    throw new Error();
  } finally {
    await fixture.close();
  }
}
run()
  .then(() => {
    process.stdout.write("IMPORTS_E2E_FIXTURE_READY\n");
  })
  .catch(() => {
    process.stderr.write("IMPORTS_E2E_FIXTURE_FAILED\n");
    process.exitCode = 1;
  });
