import { spawn } from "node:child_process";
import { loadManagedInstance } from "../src/lib/db/management";

const scenarios = [
  "terminate-query",
  "terminate-commit",
  "terminate-rollback",
  "terminate-savepoint",
  "terminate-nested-commit",
  "terminate-nested-rollback",
  "queued",
  "reserve",
  "client-end",
  "timeout-active",
  "timeout-idle",
  "cursor",
  "socket-write",
  "graceful-end",
  "compatibility",
  "destroy-transaction",
  "destroy-reserve",
  "inject-reset",
  "inject-no-code",
  "inject-frozen",
  "inject-fatal",
  "inject-primitive",
  "inject-reserve",
] as const;

async function main() {
  const instance = process.env.QF_DRIVER_TEST_INSTANCE;
  if (!instance || !/^[a-f0-9]{32}$/.test(instance))
    throw new Error("DRIVER_TEST_CONFIG_REQUIRED");
  const { config } = await loadManagedInstance(instance);
  if (config.purpose !== "test" && config.purpose !== "ci")
    throw new Error("DRIVER_TEST_INSTANCE_REQUIRED");
  for (const entry of ["esm", "cjs"]) {
    for (const scenario of scenarios) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "tests/driver/postgres-disconnect-child.ts",
            entry,
            scenario,
          ],
          {
            cwd: process.cwd(),
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        let output = "";
        let stderr = false;
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        // Do not forward raw driver errors, credentials, query text, or parameters.
        child.stderr.on("data", () => {
          stderr = true;
        });
        const timer = setTimeout(() => child.kill("SIGKILL"), 12_000);
        child.once("error", () => {
          clearTimeout(timer);
          reject(new Error("DRIVER_CHILD_START_FAILED"));
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          if (code === 0 && !stderr && output === "DRIVER_CASE_OK\n") {
            process.stdout.write(`DRIVER_PASS ${entry} ${scenario}\n`);
            resolve();
          } else {
            process.stderr.write(`DRIVER_FAIL ${entry} ${scenario}\n`);
            reject(new Error("DRIVER_CHILD_FAILED"));
          }
        });
      });
    }
  }
}
main().catch((error: unknown) => {
  const code =
    error instanceof Error &&
    ["DRIVER_TEST_CONFIG_REQUIRED", "DRIVER_TEST_INSTANCE_REQUIRED"].includes(
      error.message,
    )
      ? error.message
      : "DRIVER_SUITE_FAILED";
  process.stderr.write(code + "\n");
  process.exitCode = 1;
});
