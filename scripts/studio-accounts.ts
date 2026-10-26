import {
  executeLocalAccountOperation,
  inspectLocalAccountOperation,
} from "../src/lib/auth/accounts/management";
import { localAccountBindingSchema } from "../src/lib/auth/accounts/local-contracts";
import { parseArguments, printSafeError } from "./p2a-db-cli";
import { ManagementError } from "../src/lib/db/management";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "inspect-operation") {
    const options = parseArguments(args, ["instance", "operation-file"]);
    const result = await inspectLocalAccountOperation(
      options.instance!,
      options["operation-file"]!,
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    if (result.status !== "found") process.exitCode = 1;
    return;
  }
  if (
    !["bootstrap-admin", "recover-admin", "disable", "restore"].includes(
      command ?? "",
    )
  )
    throw new ManagementError("CLI_ARGUMENTS_INVALID");
  const options = parseArguments(args, [
    "instance",
    "operator-id",
    "operation-id",
    "operation-file",
    ...(command === "bootstrap-admin"
      ? ["login-name", "display-name"]
      : ["expected-revision"]),
  ]);
  const binding = localAccountBindingSchema.parse({
    action: command === "recover-admin" ? "admin-recovery" : command,
    operationId: options["operation-id"],
    targetId: options["operator-id"],
    ...(command === "bootstrap-admin"
      ? {
          loginName: options["login-name"],
          displayName: options["display-name"],
        }
      : {
          expectedRevision: /^[1-9][0-9]{0,9}$/.test(
            options["expected-revision"] ?? "",
          )
            ? Number(options["expected-revision"])
            : NaN,
        }),
  });
  const result = await executeLocalAccountOperation(
    options.instance!,
    binding,
    options["operation-file"]!,
  );
  process.stdout.write(JSON.stringify(result) + "\n");
  if (result.receipt.operation.status === "rejected") process.exitCode = 1;
}
main().catch(printSafeError);
