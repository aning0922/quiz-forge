import { spawn } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";
import { loadRuntimeConfig } from "@/lib/db/runtime";
import { openManagedDatabase } from "@/lib/db/management";

it("proves actual observed driver opens/closes and bounded fault quarantine in isolated processes", async () => {
  const config = await loadRuntimeConfig();
  if (!["test", "ci"].includes(config.purpose))
    throw Error("P4_SQL_OWNER_TEST_REQUIRED");
  const admin = await openManagedDatabase(config.instanceId);
  try {
    for (const scenario of [
      "normal",
      "late-close",
      "early-failure",
      "rejected-close",
    ]) {
      const result = await new Promise<boolean>((resolve) => {
        const child = spawn(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "tests/driver/p4-sql-owner-child.ts",
            scenario,
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              TSX_TSCONFIG_PATH: path.resolve("tsconfig.json"),
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "",
          badOutput = false;
        const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
        child.stdout.on("data", (chunk: Buffer) => {
          if (output.length + chunk.length > 1024) {
            badOutput = true;
            child.kill("SIGKILL");
          } else output += chunk.toString();
        });
        child.stderr.on("data", () => {
          badOutput = true;
        });
        child.once("error", () => {
          clearTimeout(timer);
          resolve(false);
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          resolve(
            code === 0 && !badOutput && output === "P4_SQL_OWNER_CHILD_OK\n",
          );
        });
      });
      // A response/timeout/child kill is not backend-exit proof. Observe this own role's actual backends.
      let stopped = false;
      for (let i = 0; i < 200; i++) {
        const [row] = await admin.sql<
          { n: number }[]
        >`SELECT count(*)::integer n FROM pg_stat_activity WHERE datname=current_database() AND usename=${config.database.user}`;
        if (row?.n === 0) {
          stopped = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(stopped, `${scenario}: actual app backends stopped`).toBe(true);
      expect(result, `${scenario}: child close and finite output`).toBe(true);
    }
  } finally {
    await admin.close();
  }
}, 60000);
