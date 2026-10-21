import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  initLocalInstance,
  loadManagedInstance,
  manageLocalInstance,
  openManagedDatabase,
} from "@/lib/db/management";
import { ensureStorage } from "@/features/quizpack/import/storage";
import { computeRecoveryCodeIdentity } from "@/features/runtime-recovery/code-identity";
import {
  createRecoveryBackup,
  verifyRecoveryBundle,
  closeVerifiedRecoveryBundle,
} from "@/features/runtime-recovery/artifact";
import { withQuiescentRecoverySnapshot } from "@/features/runtime-recovery/source";
import { restoreManagedRecoveryData } from "@/features/runtime-recovery/restore";
import { artifactFixture, freshBudget } from "../recovery/artifact-fixture";

let id: string, codeSha256: string;
const budget = () => freshBudget(60000);
beforeAll(async () => {
  const source = await initLocalInstance({
    port: 55421,
    origin: "http://127.0.0.1:3198",
    purpose: "test",
  });
  id = source.instanceId;
  await ensureStorage((await loadManagedInstance(id)).config);
  codeSha256 = (await computeRecoveryCodeIdentity(process.cwd(), budget()))
    .codeSha256;
});
afterAll(async () => {
  if (id) await manageLocalInstance("stop", id);
});

it("rejects metadata functions, third schemas and extra TOC comments before sealing", async () => {
  for (const [add, remove] of [
    [
      "CREATE FUNCTION qf_meta.synthetic_extra() RETURNS integer LANGUAGE sql AS 'SELECT 1'",
      "DROP FUNCTION qf_meta.synthetic_extra()",
    ],
    ["CREATE SCHEMA synthetic_extra", "DROP SCHEMA synthetic_extra"],
    [
      "COMMENT ON TABLE qf_meta.schema_migrations IS 'synthetic-extra'",
      "COMMENT ON TABLE qf_meta.schema_migrations IS NULL",
    ],
  ]) {
    const db = await openManagedDatabase(id);
    try {
      await db.sql.unsafe(add!);
    } finally {
      await db.close();
    }
    await delay(50);
    const directory = path.join(
      process.cwd(),
      ".cache",
      `recovery-reject-${randomUUID()}`,
    );
    try {
      await expect(
        createRecoveryBackup(
          {
            ...budget(),
            instanceId: id,
            codeSha256,
            directory,
            assertCodeIdentity: async () => {},
          },
          withQuiescentRecoverySnapshot,
        ),
      ).rejects.toThrow(/RECOVERY_(INTEGRITY_FAILED|FORMAT_INVALID)/);
      await expect(
        lstat(path.join(directory, "seal.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const check = await openManagedDatabase(id);
      try {
        const [history] =
          await check.sql`SELECT count(*)::int n FROM qf_meta.schema_migrations`;
        expect(history?.n).toBe(18);
      } finally {
        await check.close();
      }
    } finally {
      const cleanup = await openManagedDatabase(id);
      try {
        await cleanup.sql.unsafe(remove!);
      } finally {
        await cleanup.close();
      }
      await delay(50);
    }
  }
});

it("closes real accepted TCP clients and seals only after the actual finite dump TOC check", async () => {
  const directory = path.join(
    process.cwd(),
    ".cache",
    `recovery-source-${randomUUID()}`,
  );
  let closed = false;
  const receipt = await createRecoveryBackup(
    {
      ...budget(),
      instanceId: id,
      codeSha256,
      directory,
      assertCodeIdentity: async () => {},
    },
    async (input, work) =>
      withQuiescentRecoverySnapshot(input, async (lease) => {
        await new Promise<void>((resolve, reject) => {
          const client = connect(3198, "127.0.0.1");
          client.once("error", reject);
          client.once("close", () => {
            closed = true;
            resolve();
          });
        });
        expect(Object.isFrozen(lease.database.tables[0])).toBe(true);
        return work(lease);
      }),
  );
  expect(closed).toBe(true);
  expect(
    JSON.parse(await readFile(path.join(directory, "seal.json"), "utf8"))
      .manifestSha256,
  ).toBe(receipt.manifestSha256);
});

it("rejects both ancestor directions using genuine B-issued bundle capabilities before target IO", async () => {
  for (const direction of ["ancestor", "descendant"]) {
    const fixture = await artifactFixture();
    const receipt = await createRecoveryBackup(fixture.input, fixture.snapshot);
    const bundle = await verifyRecoveryBundle({
      ...budget(),
      directory: fixture.directory,
      expectedManifestSha256: receipt.manifestSha256,
    });
    const targetRoot =
      direction === "ancestor"
        ? path.dirname(fixture.source.root)
        : path.join(fixture.source.root, "nested");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(targetRoot);
    try {
      const destination = path.join(
        process.cwd(),
        ".cache/p2a",
        fixture.source.instanceId,
      );
      await expect(lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        restoreManagedRecoveryData({
          ...budget(),
          bundle,
          pgPort: 55424,
          origin: "http://127.0.0.1:3199",
          codeSha256: fixture.source.codeSha256,
        }),
      ).rejects.toThrow("RECOVERY_DESTINATION_EXISTS");
      await expect(lstat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      cwd.mockRestore();
      await closeVerifiedRecoveryBundle(bundle);
    }
  }
});
