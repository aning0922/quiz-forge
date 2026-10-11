import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";

export type PgCommandRunner = (
  program: string,
  args: string[],
) => Promise<string>;
export class PgCommandError extends Error {
  constructor(
    readonly spawned: boolean,
    readonly exitCode: number | null = null,
  ) {
    super("PG_COMMAND_FAILED");
  }
}

export const runPg: PgCommandRunner = async (program, args) => {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join("/opt/homebrew/bin", program), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PGPASSWORD: undefined,
        PGHOST: undefined,
        PGPORT: undefined,
        PGDATABASE: undefined,
        PGUSER: undefined,
      },
    });
    let output = "",
      spawned = false;
    child.once("spawn", () => {
      spawned = true;
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stderr.resume();
    child.once("error", () => reject(new PgCommandError(spawned)));
    child.once("exit", (code) =>
      code === 0 ? resolve(output) : reject(new PgCommandError(spawned, code)),
    );
  });
};
