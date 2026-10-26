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
import {
  localAccountBindingSchema,
  localAccountReceiptSchema,
  type LocalAccountBinding,
} from "./local-contracts";
export type {
  LocalAccountBinding,
  LocalAccountReceipt,
} from "./local-contracts";

const fileSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.local-account-operation.v1"),
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    binding: localAccountBindingSchema,
    passwordSetup: z
      .strictObject({
        tokenId: z.uuid(),
        tokenDigest: z.string().regex(/^[a-f0-9]{64}$/),
        url: z.string().max(1024),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.binding.action === "bootstrap-admin" ||
        value.binding.action === "admin-recovery") !== !!value.passwordSetup
    )
      ctx.addIssue({ code: "custom", message: "Invalid local operation file" });
  });
function checkPath(instanceId: string, file: string) {
  const folder = instancePaths(instanceId).directory;
  if (
    !path.isAbsolute(file) ||
    path.dirname(file) !== folder ||
    !/^account-operation-[a-z0-9-]+\.json$/.test(path.basename(file))
  )
    throw new ManagementError("ACCOUNT_OPERATION_PATH_INVALID");
}
async function readOperation(instanceId: string, file: string) {
  checkPath(instanceId, file);
  try {
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (
        !info.isFile() ||
        (info.mode & 0o777) !== 0o600 ||
        info.uid !== process.getuid?.() ||
        info.size > 4096
      )
        throw Error("PRIVATE_FILE_REQUIRED");
      const bytes = Buffer.alloc(4097);
      let total = 0;
      while (total < bytes.length) {
        const part = await handle.read(
          bytes,
          total,
          bytes.length - total,
          total,
        );
        if (!part.bytesRead) break;
        total += part.bytesRead;
      }
      if (total !== info.size) throw Error("FILE_CHANGED");
      return fileSchema.parse(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, total),
          ),
        ),
      );
    } finally {
      await handle.close();
    }
  } catch {
    throw new ManagementError("ACCOUNT_OPERATION_FILE_INVALID");
  }
}
async function closeManaged(
  db: Awaited<ReturnType<typeof openManagedDatabase>>,
) {
  try {
    await db.close();
  } catch {
    throw new ManagementError(
      "ACCOUNT_OPERATION_CLOSE_UNCONFIRMED_FILE_PRESERVED",
    );
  }
}
function requestFromFile(value: z.infer<typeof fileSchema>) {
  return {
    ...value.binding,
    ...(value.passwordSetup
      ? {
          tokenId: value.passwordSetup.tokenId,
          tokenDigest: value.passwordSetup.tokenDigest,
        }
      : {}),
  };
}
function checkLink(value: z.infer<typeof fileSchema>, origin: string) {
  if (!value.passwordSetup) return;
  const link = value.passwordSetup;
  const url = new URL(link.url),
    params = new URLSearchParams(url.hash.slice(1));
  if (
    url.origin !== origin ||
    url.pathname !== "/studio/set-password" ||
    url.search ||
    url.username ||
    url.password ||
    [...params.keys()].length !== 2 ||
    params.getAll("token").length !== 1 ||
    params.getAll("tokenId").length !== 1 ||
    params.get("tokenId") !== link.tokenId ||
    passwordTokenDigest(params.get("token") ?? "") !== link.tokenDigest
  )
    throw new ManagementError("ACCOUNT_OPERATION_FILE_INVALID");
}

/** One explicit owner write. Existing files are never overwritten or automatically replayed. */
export async function executeLocalAccountOperation(
  instanceId: string,
  input: LocalAccountBinding,
  operationFile: string,
) {
  const binding = localAccountBindingSchema.parse(input);
  checkPath(instanceId, operationFile);
  const db = await openManagedDatabase(instanceId);
  let fileCreated = false;
  try {
    const prior =
      await db.sql`SELECT operation_id FROM qf.operator_account_operation WHERE operation_id=${binding.operationId}`;
    if (prior.length)
      throw new ManagementError(
        "ACCOUNT_OPERATION_ALREADY_RECORDED_INSPECT_ORIGINAL",
      );
    const token =
      binding.action === "bootstrap-admin" ||
      binding.action === "admin-recovery"
        ? issuePasswordToken()
        : undefined;
    const original = fileSchema.parse({
      schemaVersion: "quizforge.local-account-operation.v1",
      instanceId,
      binding,
      ...(token
        ? {
            passwordSetup: {
              tokenId: token.id,
              tokenDigest: token.digest,
              url:
                db.config.origin +
                "/studio/set-password#token=" +
                token.raw +
                "&tokenId=" +
                token.id,
            },
          }
        : {}),
    });
    const file = await open(
      operationFile,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    fileCreated = true;
    try {
      await file.writeFile(JSON.stringify(original) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(
      path.dirname(operationFile),
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    const value = await accountCall<{ first: boolean; receipt: unknown }>(
      db as unknown as P2aDatabase,
      "account_local",
      "",
      null,
      requestFromFile(original),
      true,
    );
    const receipt = localAccountReceiptSchema.parse(value.receipt);
    if (JSON.stringify(receipt.binding) !== JSON.stringify(binding))
      throw Error("LOCAL_RECEIPT_BINDING_MISMATCH");
    return { receipt, operationFile };
  } catch (error) {
    if (fileCreated)
      throw new ManagementError(
        "ACCOUNT_OPERATION_REQUIRES_INSPECTION_FILE_PRESERVED",
      );
    if (error instanceof ManagementError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new ManagementError(
        "ACCOUNT_OPERATION_FILE_EXISTS_INSPECT_ORIGINAL",
      );
    throw new ManagementError("ACCOUNT_OPERATION_NOT_SENT");
  } finally {
    await closeManaged(db);
  }
}

/** Repeatable owner-only inspection. No token issuance, mutation, or inferred nonexecution. */
export async function inspectLocalAccountOperation(
  instanceId: string,
  operationFile: string,
) {
  const original = await readOperation(instanceId, operationFile);
  const { binding } = original;
  if (original.instanceId !== instanceId)
    return {
      status: "binding-mismatch" as const,
      binding: "original-file" as const,
    };
  const db = await openManagedDatabase(instanceId);
  try {
    checkLink(original, db.config.origin);
    return await db.sql.begin(async (tx) => {
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
      await tx`SET LOCAL statement_timeout='5s'`;
      const [row] = await tx<
        {
          receipt: unknown;
          matches: boolean;
          token_matches: boolean;
          token_state: string;
          expires_at: string | null;
        }[]
      >`
        SELECT jsonb_build_object('operation',qf.account_operation_dto(r),'binding',r.binding-ARRAY['tokenId','tokenDigest'],'result',r.local_result) receipt,
          (r.actor_id IS NULL AND r.target_id=${binding.targetId}::uuid AND r.action=${binding.action} AND r.binding=${JSON.stringify(requestFromFile(original))}::text::jsonb) matches,
          CASE WHEN r.status='rejected' OR ${!original.passwordSetup} THEN t.id IS NULL ELSE
            coalesce(t.id=${original.passwordSetup?.tokenId ?? null}::uuid AND r.token_id=t.id AND t.token_digest=${original.passwordSetup?.tokenDigest ?? null}
              AND t.operator_id=r.target_id AND t.purpose=r.action AND t.issued_by IS NULL,false) END token_matches,
          CASE WHEN t.id IS NULL THEN 'missing' WHEN t.consumed_at IS NOT NULL THEN 'consumed' WHEN t.revoked_at IS NOT NULL THEN 'revoked' WHEN t.expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END token_state,
          qf.consumer_moment(date_trunc('milliseconds',t.expires_at)) expires_at
        FROM qf.operator_account_operation r LEFT JOIN qf.operator_password_token t ON t.operation_id=r.operation_id
        WHERE r.operation_id=${binding.operationId}::uuid`;
      if (!row)
        return { status: "unknown" as const, operationId: binding.operationId };
      if (!row.matches || !row.token_matches)
        return {
          status: "binding-mismatch" as const,
          binding: "database" as const,
        };
      return {
        status: "found" as const,
        receipt: localAccountReceiptSchema.parse(row.receipt),
        ...(original.passwordSetup && row.token_state !== "missing"
          ? {
              passwordSetup: {
                tokenId: original.passwordSetup.tokenId,
                purpose: binding.action,
                expiresAt: row.expires_at,
                state: row.token_state,
              },
            }
          : {}),
      };
    });
  } finally {
    await closeManaged(db);
  }
}
