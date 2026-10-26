import path from "node:path";
import { randomUUID } from "node:crypto";
import { instancePaths, loadManagedInstance } from "@/lib/db/management";
import { executeLocalAccountOperation } from "@/lib/auth/accounts/management";

/** One explicit test operation; its private file survives failed/unknown outcomes. */
export async function disableTestAccount(instanceId: string, targetId: string, expectedRevision: number) {
  const managed = await loadManagedInstance(instanceId);
  if (!["test", "ci"].includes(managed.config.purpose)) throw Error("TEST_INSTANCE_REQUIRED");
  const operationId = randomUUID();
  const result = await executeLocalAccountOperation(instanceId,
    { action: "disable", targetId, expectedRevision, operationId },
    path.join(instancePaths(instanceId).directory, `account-operation-${operationId}.json`));
  if (result.receipt.operation.status !== "completed") throw Error("TEST_DISABLE_REJECTED");
  return result.receipt.result;
}
