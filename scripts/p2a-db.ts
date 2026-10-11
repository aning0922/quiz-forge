import {
  initLocalInstance,
  manageLocalInstance,
  ManagementError,
} from "../src/lib/db/management";
import { parseArguments, printSafeError } from "./p2a-db-cli";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "init") {
    const options = parseArguments(args, ["port", "origin", "purpose"]);
    if (
      !/^[1-9][0-9]{3,4}$/.test(options.port!) ||
      !["test", "demo"].includes(options.purpose!)
    )
      throw new ManagementError("CLI_ARGUMENTS_INVALID");
    const manifest = await initLocalInstance({
      port: Number(options.port),
      origin: options.origin!,
      purpose: options.purpose as "test" | "demo",
    });
    process.stdout.write(
      JSON.stringify({
        instanceId: manifest.instanceId,
        runtimeConfigPath: manifest.runtimeConfigPath,
        adminConfigPath: manifest.adminConfigPath,
        status: "running",
      }) + "\n",
    );
  } else if (
    command === "start" ||
    command === "status" ||
    command === "migrate" ||
    command === "stop"
  ) {
    const options = parseArguments(args, ["instance"]);
    process.stdout.write(
      JSON.stringify(await manageLocalInstance(command, options.instance!)) +
        "\n",
    );
  } else throw new ManagementError("CLI_ARGUMENTS_INVALID");
}
main().catch(printSafeError);
