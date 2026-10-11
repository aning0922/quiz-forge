import { appendFile, lstat } from "node:fs/promises";
import { initCiInstance, ManagementError } from "../src/lib/db/management";
import { printSafeError } from "./p2a-db-cli";

async function main() {
  if (process.argv.length !== 2)
    throw new ManagementError("CLI_ARGUMENTS_INVALID");
  const env = process.env;
  const port = env.QUIZFORGE_P2A_CI_PORT;
  if (!port || !/^[1-9][0-9]{3,4}$/.test(port))
    throw new ManagementError("CI_SERVICE_ARGUMENTS_INVALID");
  const manifest = await initCiInstance({
    host: env.QUIZFORGE_P2A_CI_HOST ?? "",
    port: Number(port),
    user: env.QUIZFORGE_P2A_CI_USER ?? "",
    password: env.QUIZFORGE_P2A_CI_PASSWORD ?? "",
    database: env.QUIZFORGE_P2A_CI_DATABASE ?? "",
  });
  if (env.GITHUB_ENV) {
    const stat = await lstat(env.GITHUB_ENV);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      /[\r\n]/.test(manifest.runtimeConfigPath)
    )
      throw new ManagementError("CI_ENV_OUTPUT_INVALID");
    await appendFile(
      env.GITHUB_ENV,
      `QUIZFORGE_P2A_CONFIG=${manifest.runtimeConfigPath}\n`,
      "utf8",
    );
  }
  process.stdout.write(
    JSON.stringify({
      instanceId: manifest.instanceId,
      runtimeConfigPath: manifest.runtimeConfigPath,
      adminConfigPath: manifest.adminConfigPath,
    }) + "\n",
  );
}
main().catch(printSafeError);
