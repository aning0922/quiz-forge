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
import {
  accountCall,
  issuePasswordToken,
  passwordTokenDigest,
} from "./service";
import { displayName, loginName } from "./input";
import type { AccountOperationDto } from "@/features/studio/accounts/contracts";
export async function prepareLocalAccount(
  instanceId: string,
  action: "bootstrap-admin" | "admin-recovery",
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
          url:
            db.config.origin +
            "/studio/set-password#token=" +
            token.raw +
            "&tokenId=" +
            token.id,
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

/** Owner-only reconciliation of the original issuance. This function never issues or mutates anything. */
export async function inspectLocalAccountOperation(
  instanceId: string,
  action: "bootstrap-admin" | "admin-recovery",
  options: { operatorId: string; operationId: string; setupFile: string },
) {
  const targetId = z.uuid().parse(options.operatorId),
    operationId = z.uuid().parse(options.operationId);
  const resultBinding = { operationId, targetId, action };
  const folder = instancePaths(instanceId).directory;
  if (
    !path.isAbsolute(options.setupFile) ||
    path.dirname(options.setupFile) !== folder ||
    !/^account-setup-[a-z0-9-]+\.json$/.test(path.basename(options.setupFile))
  )
    throw new ManagementError("ACCOUNT_SETUP_PATH_INVALID");
  let evidence: {
    instanceId: string;
    action: "bootstrap-admin" | "admin-recovery";
    targetId: string;
    operationId: string;
    loginName?: string | undefined;
    displayName?: string | undefined;
    url: string;
  };
  try {
    const file = await open(
      options.setupFile,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        (info.mode & 0o077) !== 0 ||
        info.uid !== process.getuid?.() ||
        info.size > 4096
      )
        throw Error("PRIVATE_FILE_REQUIRED");
      const bytes = Buffer.alloc(4097),
        read = await file.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > 4096) throw Error("FILE_TOO_LARGE");
      evidence = z
        .strictObject({
          instanceId: z.string().regex(/^[a-f0-9]{32}$/),
          action: z.enum(["bootstrap-admin", "admin-recovery"]),
          targetId: z.uuid(),
          operationId: z.uuid(),
          loginName: loginName.optional(),
          displayName: displayName.optional(),
          url: z.string().max(1024),
        })
        .parse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              bytes.subarray(0, read.bytesRead),
            ),
          ),
        );
    } finally {
      await file.close();
    }
  } catch {
    throw new ManagementError("ACCOUNT_SETUP_FILE_INVALID");
  }
  if (
    evidence.instanceId !== instanceId ||
    evidence.action !== action ||
    evidence.targetId !== targetId ||
    evidence.operationId !== operationId ||
    (action === "bootstrap-admin" &&
      (!evidence.loginName || !evidence.displayName)) ||
    (action === "admin-recovery" &&
      (evidence.loginName !== undefined || evidence.displayName !== undefined))
  )
    return {
      status: "binding-mismatch" as const,
      ...resultBinding,
      binding: "original-file" as const,
    };
  const db = await openManagedDatabase(instanceId);
  try {
    let tokenId: string, tokenDigest: string;
    try {
      const url = new URL(evidence.url),
        params = new URLSearchParams(url.hash.slice(1));
      if (
        url.origin !== db.config.origin ||
        url.pathname !== "/studio/set-password" ||
        url.search ||
        url.username ||
        url.password ||
        [...params.keys()].length !== 2 ||
        params.getAll("token").length !== 1 ||
        params.getAll("tokenId").length !== 1
      )
        throw Error("LINK_BINDING_INVALID");
      tokenId = z.uuid().parse(params.get("tokenId"));
      tokenDigest = passwordTokenDigest(params.get("token") ?? "");
    } catch {
      throw new ManagementError("ACCOUNT_SETUP_FILE_INVALID");
    }
    const binding = {
      action,
      targetId,
      operationId,
      ...(action === "bootstrap-admin"
        ? { loginName: evidence.loginName, displayName: evidence.displayName }
        : {}),
    };
    return await db.sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SET LOCAL statement_timeout='5s'`;
      const [row] = await tx<
        {
          operation: AccountOperationDto;
          receipt_matches: boolean;
          token_matches: boolean;
          token_id: string | null;
          expires_at: string | null;
          token_state: string;
        }[]
      >`
        SELECT qf.account_operation_dto(r) AS operation,
          (r.actor_id IS NULL AND r.target_id=${targetId}::uuid AND r.action=${action} AND r.binding=${JSON.stringify(binding)}::text::jsonb) AS receipt_matches,
          coalesce(t.id=${tokenId}::uuid AND t.token_digest=${tokenDigest} AND t.operator_id=${targetId}::uuid AND t.purpose=${action} AND t.issued_by IS NULL,false) AS token_matches,
          t.id AS token_id,qf.consumer_moment(t.expires_at) AS expires_at,
          CASE WHEN t.id IS NULL THEN 'missing' WHEN t.consumed_at IS NOT NULL THEN 'consumed' WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END AS token_state
        FROM qf.operator_account_operation r LEFT JOIN qf.operator_password_token t ON t.operation_id=r.operation_id
        WHERE r.operation_id=${operationId}::uuid`;
      if (!row) return { status: "unknown" as const, ...resultBinding };
      if (!row.receipt_matches || !row.token_matches)
        return {
          status: "binding-mismatch" as const,
          ...resultBinding,
          binding: "database" as const,
        };
      return {
        status: "found" as const,
        binding: "matched" as const,
        operation: row.operation,
        passwordSetup: {
          tokenId: row.token_id,
          purpose: action,
          expiresAt: row.expires_at,
          state: row.token_state,
        },
      };
    });
  } finally {
    await db.close();
  }
}
