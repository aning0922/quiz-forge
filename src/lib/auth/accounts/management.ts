import "server-only";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  openManagedDatabase,
  instancePaths,
  ManagementError,
} from "@/lib/db/management";
import type { P2aDatabase } from "@/lib/db/client";
import { accountCall, issuePasswordToken } from "./service";
import { displayName, loginName } from "./input";
export async function prepareLocalAccount(
  instanceId: string,
  action: "bootstrap-admin" | "enroll" | "admin-recovery",
  options: {
    operatorId: string;
    operationId: string;
    setupFile: string;
    loginName?: string;
    displayName?: string;
  },
) {
  const targetId = z.uuid().parse(options.operatorId),
    operationId = z.uuid().parse(options.operationId);
  const folder = instancePaths(instanceId).directory;
  if (
    !path.isAbsolute(options.setupFile) ||
    path.dirname(options.setupFile) !== folder ||
    !/^account-setup-[a-z0-9-]+\.json$/.test(path.basename(options.setupFile))
  )
    throw new ManagementError("ACCOUNT_SETUP_PATH_INVALID");
  const token = issuePasswordToken(),
    binding = {
      action,
      targetId,
      operationId,
      ...(action === "admin-recovery"
        ? {}
        : {
            loginName: loginName.parse(options.loginName),
            displayName: displayName.parse(options.displayName),
          }),
    };
  const db = await openManagedDatabase(instanceId);
  let fileCreated = false;
  try {
    const prior =
      await db.sql`SELECT operation_id FROM qf.operator_account_operation WHERE operation_id=${operationId}`;
    if (prior.length)
      throw new ManagementError("ACCOUNT_OPERATION_ALREADY_RECORDED");
    const file = await open(
      options.setupFile,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    fileCreated = true;
    try {
      await file.writeFile(
        JSON.stringify({
          instanceId,
          ...binding,
          url: db.config.origin + "/studio/set-password#token=" + token.raw,
        }) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
    const result = await accountCall<{ first: boolean }>(
      db as unknown as P2aDatabase,
      "account_local",
      "",
      null,
      { ...binding, tokenId: token.id, tokenDigest: token.digest },
      true,
    );
    if (!result.first)
      throw new ManagementError("ACCOUNT_OPERATION_ALREADY_RECORDED");
    return { id: targetId, operationId, setupFile: options.setupFile };
  } catch (e) {
    if (fileCreated && !(e instanceof ManagementError))
      throw new ManagementError(
        "ACCOUNT_SETUP_OUTCOME_REQUIRES_RECHECK_FILE_PRESERVED",
      );
    throw e;
  } finally {
    await db.close();
  }
}
