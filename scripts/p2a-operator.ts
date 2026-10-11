import {
  createOperator,
  disableOperator,
  ManagementError,
} from "../src/lib/db/management";
import { parseArguments, printSafeError } from "./p2a-db-cli";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "create") {
    const options = parseArguments(args, [
      "instance",
      "label",
      "role",
      "credential-file",
    ]);
    if (options.role !== "operator" && options.role !== "read-only")
      throw new ManagementError("CLI_ARGUMENTS_INVALID");
    process.stdout.write(
      JSON.stringify(
        await createOperator(options.instance!, {
          label: options.label!,
          role: options.role,
          credentialFile: options["credential-file"]!,
        }),
      ) + "\n",
    );
  } else if (command === "disable") {
    const options = parseArguments(args, ["instance", "id"]);
    process.stdout.write(
      JSON.stringify(await disableOperator(options.instance!, options.id!)) +
        "\n",
    );
  } else throw new ManagementError("CLI_ARGUMENTS_INVALID");
}
main().catch(printSafeError);
