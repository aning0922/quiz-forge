import {
  prepareLocalAccount,
  inspectLocalAccountOperation,
} from "../src/lib/auth/accounts/management";
import { parseArguments, printSafeError } from "./p2a-db-cli";
import { ManagementError } from "../src/lib/db/management";
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "inspect-operation") {
    const options = parseArguments(args, [
      "instance",
      "operation-id",
      "operator-id",
      "action",
      "setup-file",
    ]);
    if (
      options.action !== "bootstrap-admin" &&
      options.action !== "admin-recovery"
    )
      throw new ManagementError("CLI_ARGUMENTS_INVALID");
    const result = await inspectLocalAccountOperation(
      options.instance!,
      options.action,
      {
        operatorId: options["operator-id"]!,
        operationId: options["operation-id"]!,
        setupFile: options["setup-file"]!,
      },
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }
  if (!["bootstrap-admin", "recover-admin"].includes(command ?? ""))
    throw new ManagementError("CLI_ARGUMENTS_INVALID");
  const action =
    command === "recover-admin"
      ? "admin-recovery"
      : (command as "bootstrap-admin");
  const options = parseArguments(args, [
    "instance",
    "operator-id",
    "operation-id",
    "setup-file",
    ...(action === "admin-recovery" ? [] : ["login-name", "display-name"]),
  ]);
  const result = await prepareLocalAccount(options.instance!, action, {
    operatorId: options["operator-id"]!,
    operationId: options["operation-id"]!,
    setupFile: options["setup-file"]!,
    ...(action === "admin-recovery"
      ? {}
      : {
          loginName: options["login-name"]!,
          displayName: options["display-name"]!,
        }),
  });
  process.stdout.write(JSON.stringify(result) + "\n");
}
main().catch(printSafeError);
