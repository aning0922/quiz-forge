import assert from "node:assert/strict";
import { loadRuntimeConfig } from "../../src/lib/db/runtime";
import { openManagedDatabase } from "../../src/lib/db/management";
import { createStudioRequestBudget } from "../../src/lib/http-security/request-budget";
import { createConsumerRequestOwner } from "../../src/features/fulfillment/consumer-flow/request-owner";

async function main() {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_IO_CHILD_TEST_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  const actualEnds: (() => Promise<void>)[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const owner = createConsumerRequestOwner(
        config,
        createStudioRequestBudget(new AbortController().signal),
      );
      try {
        await assert.rejects(
          owner.run("complete", async (c) => {
            await c.sql(async (db) => {
              await db.sql`SELECT 1`;
            });
            return c.io(async (io) => {
              await io.guard.check();
              const nativeEnd = io.db.sql.end.bind(io.db.sql);
              let actual: Promise<void> | undefined;
              actualEnds.push(() => (actual ??= nativeEnd({ timeout: 0 })));
              // Reject the observable close on a real allocated pool, without ending its backend.
              io.db.sql.end = () =>
                Promise.reject(new Error("P4_IO_INJECTED_CLOSE_REJECTION"));
              return 1;
            });
          }),
        );
      } finally {
        await owner.closeIfNotTransferred();
      }
    }
    const heldGuards = async () => {
      const [r] = await admin.sql<
        { n: number }[]
      >`SELECT count(*)::integer n FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.datname=current_database() AND a.usename=${config.database.user} AND l.locktype='advisory' AND l.classid=72461 AND l.objid=2 AND l.objsubid=2 AND l.mode='ShareLock' AND l.granted`;
      return r?.n;
    };
    assert.equal(await heldGuards(), 4);
    await Promise.all(actualEnds.map((end) => end()));
    assert.equal(await heldGuards(), 4);
    // Resource close rejection remains quarantined even after a later native cleanup succeeds.
    const fifth = createConsumerRequestOwner(
      config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      await assert.rejects(
        fifth.run("read-resource", async (c) => {
          await c.sql(async () => 0);
          return c.io(async () => 0);
        }),
        /PREVIEW_BUSY/,
      );
    } finally {
      await fifth.closeIfNotTransferred();
    }
    const sqlOnly = createConsumerRequestOwner(
      config,
      createStudioRequestBudget(new AbortController().signal),
    );
    try {
      assert.equal(
        await sqlOnly.run("read-session", (c) =>
          c.sql(async (db) => {
            const [r] = await db.sql`SELECT 42 n`;
            return r?.n;
          }),
        ),
        42,
      );
    } finally {
      await sqlOnly.closeIfNotTransferred();
    }
    assert.equal(await heldGuards(), 4);
  } finally {
    await Promise.all(actualEnds.map((end) => end()));
    await admin.close();
  }
  await new Promise<void>((resolve) =>
    process.stdout.write("P4_IO_OWNER_QUARANTINE_OK\n", () => resolve()),
  );
  // This isolated process really exits with its still-quarantined guards; no live registry is cleared.
  process.kill(process.pid, "SIGTERM");
}
main().catch(() => {
  process.stderr.write("P4_IO_OWNER_CHILD_FAILED\n");
  process.exitCode = 1;
});
