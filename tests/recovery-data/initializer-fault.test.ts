import { expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { initEmptyRecoveryInstance } from "@/lib/db/management";
import {
  checkRecoveryBudget,
  withRecoveryFile,
} from "@/features/runtime-recovery/files";
import { recoveryPgRunner } from "@/features/runtime-recovery/database-process";

// Real PostgreSQL, newly owned synthetic instances only. Failed directories remain pending.
it("stops its actual just-started PG after abort and after a file-close admission latch", async () => {
  for (const fault of ["abort", "close-ack"] as const) {
    const id = randomBytes(16).toString("hex");
    const controller = new AbortController();
    const budget = {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + 60000,
    };
    const commands = recoveryPgRunner(budget);
    const directory = path.join(process.cwd(), ".cache/p2a", id);
    let actualStarted = false,
      actualStopped = false;
    await expect(
      initEmptyRecoveryInstance(
        {
          instanceId: id,
          port: 55425,
          origin: "http://127.0.0.1:3197",
          purpose: "test",
        },
        async (program, args) => {
          const output = await commands(program, args);
          if (program === "pg_ctl" && args.includes("stop"))
            actualStopped = true;
          if (program === "pg_ctl" && args.includes("start")) {
            actualStarted = true;
            expect(
              (
                await lstat(path.join(directory, "pgdata/postmaster.pid"))
              ).isFile(),
            ).toBe(true);
            if (fault === "abort") controller.abort();
            else {
              const file = path.join(directory, "synthetic-close-ack");
              await writeFile(file, "synthetic", { mode: 0o600, flag: "wx" });
              await expect(
                withRecoveryFile(file, budget, 100, async (handle) => {
                  const close = handle.close.bind(handle);
                  handle.close = async () => {
                    await close();
                    throw Error("synthetic lost close ack");
                  };
                }),
              ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
            }
            checkRecoveryBudget(budget);
          }
          return output;
        },
      ),
    ).rejects.toThrow("INIT_FAILED_INSTANCE_PRESERVED");
    expect(actualStarted).toBe(true);
    expect(actualStopped).toBe(true);
    await expect(
      lstat(path.join(directory, "pgdata/postmaster.pid")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await lstat(path.join(directory, "recovery-pending.json"))).isFile(),
    ).toBe(true);
    if (fault === "close-ack") {
      await expect(commands("pg_restore", ["--version"])).rejects.toThrow(
        "RECOVERY_CLOSE_UNPROVEN",
      );
    }
  }
});
